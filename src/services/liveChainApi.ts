// The real implementation of `ChainApi`, backed by `api.query.tenderChain.*`
// for reads and `api.tx.tenderChain.*` for writes.
//
// The pallet stores hashes, not content, so every human-readable string in the
// view model is resolved through `contentStore` and falls back to a short hash
// when this browser has never seen the text. See
// `blockchain/docs/tenderchain-integration.md` for the event and encoding
// contract this file implements.

import type { ApiPromise } from '@polkadot/api';
import type { SubmittableExtrinsic } from '@polkadot/api/types';
import type {
  AccountRef,
  BidCommitment,
  Challenge,
  ChainConstants,
  ConflictDeclaration,
  Criterion,
  EvaluatorScoreSet,
  QAItem,
  RevealedBid,
  Tender,
} from '../types';
import type { ChainApi, CreateTenderInput, SubmitScoreInput } from './chainApi';
import { connect } from './chainConnection';
import { getDevPair, loadAccounts, type AccountSource } from './accounts';
import { ChainCallError, findEvent, submit, submitSudo } from './chainSigner';
import {
  bidModeFromChain,
  computeCommitment,
  kindFromChain,
  kindToChain,
  randomSalt32,
  stateFromChain,
  toChainPriceLines,
  ZERO_HASH,
} from './chainCodec';
import { getJson, hashOf, putJson, putText, shortHash, textOr } from './contentStore';
import { asHash32 } from '../lib/hashing';

const NOTICE = 'tenderchain.notice';
const PROPOSALS = 'tenderchain.proposals.v1';

interface NoticeContent {
  title: string;
  summary: string;
  entity: string;
}

interface AwardProposal {
  bidId: string;
  rationale: string;
}

function readProposals(): Record<string, AwardProposal> {
  try {
    return JSON.parse(localStorage.getItem(PROPOSALS) ?? '{}');
  } catch {
    return {};
  }
}

function writeProposal(tenderId: string, proposal: AwardProposal) {
  const all = readProposals();
  all[tenderId] = proposal;
  localStorage.setItem(PROPOSALS, JSON.stringify(all));
}

const num = (v: unknown): number => Number(v?.toString() ?? 0);
const bidIdOf = (tenderId: string, bidder: string) => `${tenderId}:${bidder}`;
const bidderOf = (bidId: string) => bidId.split(':')[1] ?? '';

function readConstants(api: ApiPromise): ChainConstants {
  const c = api.consts.tenderChain;
  if (!c) {
    throw new Error(
      'The connected node exposes no TenderChain pallet. Check that the node was ' +
        'rebuilt after the pallet changed and that /ws points at it.',
    );
  }
  const slotMs = num(api.consts.timestamp?.minimumPeriod) * 2;
  return {
    minEvaluators: num(c.minEvaluators),
    minRevealWindow: num(c.minRevealWindow),
    maxScore: num(c.maxScore),
    // Not a chain constant: standstill is per tender (`standstill_period`).
    minStandstillPeriod: 1,
    avgBlockTimeSeconds: slotMs > 0 ? slotMs / 1000 : 6,
  };
}

export class LiveChainApi implements ChainApi {
  private api: ApiPromise | null = null;
  private block = 0;
  private finalized = 0;
  private accounts: AccountRef[] = [];
  private accountSource: AccountSource | null = null;
  private constants: ChainConstants | null = null;
  private tenders: Tender[] = [];

  private blockSubs = new Set<(b: number) => void>();
  private tenderSubs = new Set<(t: Tender[]) => void>();
  private accountSubs = new Set<(a: AccountRef[]) => void>();
  private ready: Promise<void>;

  constructor() {
    this.ready = this.init();
  }

  private async init(): Promise<void> {
    const api = await connect();
    this.api = api;

    const { accounts, source } = await loadAccounts(api.registry.chainSS58 ?? 42);
    this.accounts = accounts;
    this.accountSource = source;
    this.accountSubs.forEach((cb) => cb(accounts));

    this.constants = readConstants(api);

    await api.rpc.chain.subscribeFinalizedHeads((head) => {
      this.finalized = head.number.toNumber();
    });

    // The deadline wheel moves tenders between states in `on_initialize`, with
    // no extrinsic involved, so state has to be re-read every block rather than
    // only after a call this portal made.
    await api.rpc.chain.subscribeNewHeads(async (head) => {
      this.block = head.number.toNumber();
      this.blockSubs.forEach((cb) => cb(this.block));
      await this.refresh();
    });
  }

  private mustApi(): ApiPromise {
    if (!this.api) throw new ChainCallError('Not connected to a node yet.');
    return this.api;
  }

  private nameFor(address: string): string {
    return this.accounts.find((a) => a.address === address)?.name ?? address;
  }

  private async refresh(): Promise<void> {
    try {
      this.tenders = await this.readAllTenders();
      this.tenderSubs.forEach((cb) => cb(this.tenders));
    } catch {
      /* a transient read failure should not tear down the subscription */
    }
  }

  // --- reads ---------------------------------------------------------------

  private async readAllTenders(): Promise<Tender[]> {
    const api = this.mustApi();
    const q = api.query.tenderChain;
    const entries = await q.tenders.entries();

    return Promise.all(
      entries.map(async ([key, value]) => {
        const id = String(num(key.args[0]));
        const rec = (value as unknown as { unwrap(): Record<string, never> }).unwrap();
        return this.mapTender(id, rec);
      }),
    ).then((list) => list.sort((a, b) => Number(a.id) - Number(b.id)));
  }

  private async mapTender(id: string, rec: Record<string, never>): Promise<Tender> {
    const api = this.mustApi();
    const q = api.query.tenderChain;
    const tid = Number(id);

    const [questions, commitments, reveals, evaluators, scoreSheets, outcome, challengeRows, shortlist, source] =
      await Promise.all([
        q.questions.entries(tid),
        q.bidCommitments.entries(tid),
        q.reveals.entries(tid),
        q.evaluatorSet.entries(tid),
        q.scores.entries(tid),
        q.outcomes(tid),
        q.challenges.entries(tid),
        q.shortlist.entries(tid),
        q.shortlistSource(tid),
      ]);

    const r = rec as unknown as Record<string, { toString(): string; toJSON(): unknown }>;
    const j = (v: unknown) => v as Record<string, never>;
    const raw = rec as unknown as {
      entity: { toString(): string };
      officer: { toString(): string };
      kind: { toString(): string };
      bidMode: { toString(): string };
      noticeHash: { toString(): string };
      criteriaHash: { toString(): string };
      weights: { criterionId: unknown; weightPercent: unknown }[];
      gates: Record<string, unknown>;
      standstillPeriod: unknown;
      eligibility: { requiredCredentials: { toString(): string }[]; minReputation: unknown };
      bond: { amount: unknown; forfeitOnWithdrawal: { isTrue?: boolean; toString(): string } };
      blindQuestions: { toString(): string };
      state: { toString(): string };
      publishedAt: { isSome: boolean; unwrap(): unknown };
    };
    void r;
    void j;

    const noticeHash = raw.noticeHash.toString();
    const criteriaHash = raw.criteriaHash.toString();
    const notice = getJson<NoticeContent>(noticeHash);
    const maxScore = this.constants?.maxScore ?? 100;

    const criteria: Criterion[] =
      getJson<Criterion[]>(criteriaHash) ??
      raw.weights.map((w) => ({
        id: String(num(w.criterionId)),
        name: `Criterion ${num(w.criterionId)}`,
        description: `Locked under ${shortHash(criteriaHash)}`,
        weight: num(w.weightPercent),
        maxScore,
      }));

    const officer = raw.officer.toString();
    const entityAddress = raw.entity.toString();

    const qa: QAItem[] = questions.map(([key, value]) => {
      const rec2 = (value as unknown as { unwrap(): Record<string, never> }).unwrap() as unknown as {
        author: { isOpen: boolean; asOpen: { toString(): string }; asBlinded: { toString(): string } };
        questionHash: { toString(): string };
        askedAt: unknown;
        answerHash: { isSome: boolean; unwrap(): { toString(): string } };
        answeredAt: { isSome: boolean; unwrap(): unknown };
      };
      const qHash = rec2.questionHash.toString();
      const answerHash = rec2.answerHash.isSome ? rec2.answerHash.unwrap().toString() : undefined;
      return {
        id: String(num(key.args[1])),
        askedBy: rec2.author.isOpen
          ? rec2.author.asOpen.toString()
          : `blinded:${shortHash(rec2.author.asBlinded.toString())}`,
        question: textOr(qHash, `Question ${shortHash(qHash)}`),
        askedAtBlock: num(rec2.askedAt),
        answer: answerHash ? textOr(answerHash, `Answer ${shortHash(answerHash)}`) : undefined,
        answeredAtBlock: rec2.answeredAt.isSome ? num(rec2.answeredAt.unwrap()) : undefined,
        blind: !rec2.author.isOpen,
      };
    });

    const bidCommitments: BidCommitment[] = commitments.map(([key, value]) => {
      const rec2 = (value as unknown as { unwrap(): Record<string, never> }).unwrap() as unknown as {
        commitmentHash: { toString(): string };
        committedAt: unknown;
        bondReserved: unknown;
      };
      return {
        bidder: key.args[1].toString(),
        commitmentHash: rec2.commitmentHash.toString(),
        committedAtBlock: num(rec2.committedAt),
        // Withdrawn commitments are removed from storage, so anything still
        // here is live.
        withdrawn: false,
        bondPaid: num(rec2.bondReserved) > 0,
      };
    });

    const revealedBids: RevealedBid[] = reveals.map(([key, value]) => {
      const bidder = key.args[1].toString();
      const rec2 = (value as unknown as { unwrap(): Record<string, never> }).unwrap() as unknown as {
        documentsHash: { toString(): string };
        priceSchedule: { itemId: unknown; amount: unknown }[];
        revealedAt: unknown;
        valid: { isTrue: boolean; toString(): string };
      };
      const lines = rec2.priceSchedule.map((line) => ({
        id: String(num(line.itemId)),
        description: `Item ${num(line.itemId)}`,
        qty: 1,
        unitPrice: num(line.amount),
      }));
      const valid = rec2.valid.toString() === 'true';
      return {
        id: bidIdOf(id, bidder),
        bidder,
        bidderName: this.nameFor(bidder),
        documentsHash: rec2.documentsHash.toString(),
        priceLineItems: lines,
        totalPrice: lines.reduce((s, l) => s + l.qty * l.unitPrice, 0),
        revealedAtBlock: num(rec2.revealedAt),
        disqualified: !valid,
        disqualifyReason: valid ? undefined : 'RevealMismatch — content did not hash to the commitment',
      };
    });

    const conflictDeclarations: ConflictDeclaration[] = [];
    const evaluatorList: string[] = [];
    for (const [key, value] of evaluators) {
      const evaluator = key.args[1].toString();
      evaluatorList.push(evaluator);
      const rec2 = (value as unknown as { unwrap(): Record<string, never> }).unwrap() as unknown as {
        appointedAt: unknown;
        conflictDeclaration: { isSome: boolean; unwrap(): { toString(): string } };
      };
      if (rec2.conflictDeclaration.isSome) {
        const hash = rec2.conflictDeclaration.unwrap().toString();
        conflictDeclarations.push({
          evaluator,
          declaredAtBlock: num(rec2.appointedAt),
          // The pallet stores a declaration hash, not a yes/no: whether a
          // conflict exists is in the off-chain document.
          hasConflict: false,
          notes: textOr(hash, `Declaration ${shortHash(hash)}`),
        });
      }
    }

    const scores: EvaluatorScoreSet[] = scoreSheets.map(([key, value]) => {
      const bidder = key.args[1].toString();
      const evaluator = key.args[2].toString();
      const rec2 = (value as unknown as { unwrap(): Record<string, never> }).unwrap() as unknown as {
        scores: { criterionId: unknown; score: unknown }[];
        commentHash: { toString(): string };
        submittedAt: unknown;
      };
      const commentHash = rec2.commentHash.toString();
      return {
        evaluator,
        bidId: bidIdOf(id, bidder),
        scores: rec2.scores.map((s) => ({
          criterionId: String(num(s.criterionId)),
          score: num(s.score),
          commentHash,
        })),
        submittedAtBlock: num(rec2.submittedAt),
      };
    });

    const challenges: Challenge[] = challengeRows.map(([key, value]) => {
      const rec2 = (value as unknown as { unwrap(): Record<string, never> }).unwrap() as unknown as {
        challenger: { toString(): string };
        groundsHash: { toString(): string };
        lodgedAt: unknown;
        state: { toString(): string };
        resolutionHash: { isSome: boolean; unwrap(): { toString(): string } };
        resolvedAt: { isSome: boolean; unwrap(): unknown };
      };
      const grounds = rec2.groundsHash.toString();
      const resolution = rec2.resolutionHash.isSome ? rec2.resolutionHash.unwrap().toString() : undefined;
      const state = rec2.state.toString();
      return {
        id: String(num(key.args[1])),
        lodgedBy: rec2.challenger.toString(),
        lodgedAtBlock: num(rec2.lodgedAt),
        grounds: textOr(grounds, `Grounds ${shortHash(grounds)}`),
        status: state === 'Upheld' ? 'Upheld' : state === 'Dismissed' ? 'Dismissed' : 'Open',
        resolvedAtBlock: rec2.resolvedAt.isSome ? num(rec2.resolvedAt.unwrap()) : undefined,
        resolutionRationale: resolution ? textOr(resolution, `Resolution ${shortHash(resolution)}`) : undefined,
      };
    });

    const outcomeOpt = outcome as unknown as { isSome: boolean; unwrap(): Record<string, never> };
    let award: Tender['award'];
    if (outcomeOpt.isSome) {
      const o = outcomeOpt.unwrap() as unknown as {
        awardees: { toString(): string }[];
        rationaleHash: { toString(): string };
        awardedAt: unknown;
      };
      const awardee = o.awardees[0]?.toString() ?? '';
      const rationaleHash = o.rationaleHash.toString();
      award = {
        awardedBidId: bidIdOf(id, awardee),
        awardedBidder: awardee,
        rationale: textOr(rationaleHash, `Rationale ${shortHash(rationaleHash)}`),
        proposedBy: officer,
        proposedAtBlock: num(o.awardedAt),
        approvedByGovernance: true,
        approvedAtBlock: num(o.awardedAt),
      };
    }

    const publishedAt = raw.publishedAt.isSome ? num(raw.publishedAt.unwrap()) : 0;
    const gates = raw.gates as unknown as Record<string, unknown>;
    const sourceOpt = source as unknown as { isSome: boolean; unwrap(): unknown };

    return {
      id,
      noticeHash,
      title: notice?.title ?? `Tender #${id}`,
      summary: notice?.summary ?? `Notice anchored at ${shortHash(noticeHash)} — content not held in this browser.`,
      entity: notice?.entity ?? this.nameFor(entityAddress),
      officer,
      kind: kindFromChain(raw.kind.toString()),
      bidMode: bidModeFromChain(raw.bidMode.toString()),
      state: stateFromChain(raw.state.toString()),
      criteria,
      gates: {
        publishAt: num(gates.publishAt),
        questionsCloseAt: num(gates.questionsCloseAt),
        submissionCloseAt: num(gates.submissionCloseAt),
        openingAt: num(gates.openingAt),
        openingEndAt: num(gates.openingEndAt),
        standstillPeriod: num(raw.standstillPeriod),
      },
      eligibility: {
        requiredCredentials: raw.eligibility.requiredCredentials.map((c) => shortHash(c.toString())),
        minReputation: num(raw.eligibility.minReputation),
      },
      bond: {
        amount: String(num(raw.bond.amount)),
        currency: 'UNIT',
        forfeitOnWithdrawal: raw.bond.forfeitOnWithdrawal.toString() === 'true',
      },
      documents: [],
      qa,
      blindQuestions: raw.blindQuestions.toString() === 'true',
      shortlistFromTenderId: sourceOpt.isSome ? String(num(sourceOpt.unwrap())) : undefined,
      shortlistedBidders: shortlist.length > 0 ? shortlist.map(([k]) => k.args[1].toString()) : undefined,
      evaluators: evaluatorList,
      conflictDeclarations,
      commitments: bidCommitments,
      revealedBids,
      scores,
      award,
      challenges,
      createdAtBlock: publishedAt || num(gates.publishAt),
    };
  }

  async getConstants(): Promise<ChainConstants> {
    await this.ready;
    if (!this.constants) throw new ChainCallError('Chain constants unavailable');
    return this.constants;
  }

  getCurrentBlock(): number {
    return this.block;
  }

  getFinalizedBlock(): number {
    return this.finalized;
  }

  subscribeBlock(cb: (block: number) => void): () => void {
    this.blockSubs.add(cb);
    return () => {
      this.blockSubs.delete(cb);
    };
  }

  listAccounts(): AccountRef[] {
    return this.accounts;
  }

  subscribeAccounts(cb: (accounts: AccountRef[]) => void): () => void {
    this.accountSubs.add(cb);
    if (this.accounts.length > 0) cb(this.accounts);
    return () => {
      this.accountSubs.delete(cb);
    };
  }

  getAccountSource(): AccountSource | null {
    return this.accountSource;
  }

  async listTenders(): Promise<Tender[]> {
    await this.ready;
    if (this.tenders.length === 0) await this.refresh();
    return this.tenders;
  }

  async getTender(id: string): Promise<Tender | undefined> {
    return (await this.listTenders()).find((t) => t.id === id);
  }

  subscribeTenders(cb: (tenders: Tender[]) => void): () => void {
    this.tenderSubs.add(cb);
    if (this.tenders.length > 0) cb(this.tenders);
    return () => {
      this.tenderSubs.delete(cb);
    };
  }

  // --- writes --------------------------------------------------------------

  private async send(tx: SubmittableExtrinsic<'promise'>, from: string) {
    const events = await submit(this.mustApi(), tx, from);
    await this.refresh();
    return events;
  }

  private async sendSudo(call: SubmittableExtrinsic<'promise'>, preferred?: string) {
    const events = await submitSudo(this.mustApi(), call, preferred);
    await this.refresh();
    return events;
  }

  async createTender(input: CreateTenderInput): Promise<Tender> {
    await this.ready;
    const api = this.mustApi();

    const noticeHash = putJson({
      title: input.title,
      summary: input.summary,
      entity: input.entity,
    } satisfies NoticeContent);

    // `criterion_id` is a u32 on chain, but the wizard numbers criteria 'c1',
    // 'c2'… Renumber to the index so the stored criteria and the on-chain
    // weights agree — scores are submitted against these ids.
    const criteria = input.criteria.map((c, i) => ({ ...c, id: String(i) }));
    const criteriaHash = putJson(criteria);

    const weights = criteria.map((c) => ({
      criterionId: Number(c.id),
      weightPercent: c.weight,
    }));

    const tx = api.tx.tenderChain.createTender(
      input.officer, // entity — the portal treats the officer's account as the entity
      kindToChain(input.kind),
      input.bidMode,
      noticeHash,
      criteriaHash,
      weights,
      {
        publishAt: input.gates.publishAt,
        questionsCloseAt: input.gates.questionsCloseAt,
        submissionCloseAt: input.gates.submissionCloseAt,
        openingAt: input.gates.openingAt,
        openingEndAt: input.gates.openingEndAt,
      },
      input.gates.standstillPeriod,
      input.eligibility.requiredCredentials.filter(Boolean).map((c) => hashOf(c)),
      input.eligibility.minReputation,
      {
        amount: BigInt(input.bond.amount || '0'),
        forfeitOnNonReveal: false,
        forfeitOnWithdrawal: input.bond.forfeitOnWithdrawal,
      },
      input.blindQuestions,
      input.shortlistFromTenderId ? Number(input.shortlistFromTenderId) : null,
    );

    const events = await this.send(tx, input.officer);
    const created = findEvent(events, 'tenderChain', 'TenderCreated');
    if (!created) throw new ChainCallError('No TenderCreated event was emitted.');
    const id = String(num(created.data[0]));

    const tender = await this.getTender(id);
    if (!tender) throw new ChainCallError(`Tender ${id} was created but could not be read back.`);
    return tender;
  }

  async publishTender(id: string): Promise<void> {
    const t = await this.requireTender(id);
    await this.send(this.mustApi().tx.tenderChain.publishTender(Number(id)), t.officer);
  }

  async cancelTender(id: string, reason: string): Promise<void> {
    const t = await this.requireTender(id);
    await this.send(this.mustApi().tx.tenderChain.cancelTender(Number(id), putText(reason)), t.officer);
  }

  async askQuestion(id: string, asker: string, question: string, blind: boolean): Promise<void> {
    const salt = blind ? randomSalt32() : ZERO_HASH;
    await this.send(
      this.mustApi().tx.tenderChain.askQuestion(Number(id), putText(question), salt),
      asker,
    );
  }

  async answerQuestion(id: string, qaId: string, answer: string): Promise<void> {
    const t = await this.requireTender(id);
    await this.send(
      this.mustApi().tx.tenderChain.answerQuestion(Number(id), Number(qaId), putText(answer)),
      t.officer,
    );
  }

  async appointEvaluator(id: string, evaluator: string): Promise<void> {
    const t = await this.requireTender(id);
    await this.send(
      this.mustApi().tx.tenderChain.appointEvaluator(Number(id), evaluator, hashOf(`credential:${evaluator}`)),
      t.officer,
    );
  }

  async declareConflict(id: string, evaluator: string, hasConflict: boolean, notes?: string): Promise<void> {
    const text = notes?.trim() || (hasConflict ? 'Conflict declared' : 'No conflict declared');
    await this.send(
      this.mustApi().tx.tenderChain.declareConflict(Number(id), putText(text)),
      evaluator,
    );
    // Appointment and activation are both the officer's calls; the portal
    // activates straight after the declaration so scoring rights go live.
    const t = await this.requireTender(id);
    await this.send(this.mustApi().tx.tenderChain.activateEvaluator(Number(id), evaluator), t.officer);
  }

  async openTender(id: string): Promise<void> {
    const t = await this.requireTender(id);
    await this.send(this.mustApi().tx.tenderChain.openTender(Number(id)), t.officer);
  }

  async publishShortlist(id: string, bidderAddresses: string[]): Promise<void> {
    const t = await this.requireTender(id);
    await this.send(this.mustApi().tx.tenderChain.publishShortlist(Number(id), bidderAddresses), t.officer);
  }

  async commitBid(id: string, bidder: string, commitmentHash: string): Promise<void> {
    await this.send(this.mustApi().tx.tenderChain.commitBid(Number(id), commitmentHash), bidder);
  }

  async withdrawCommitment(id: string, bidder: string): Promise<void> {
    await this.send(this.mustApi().tx.tenderChain.withdrawCommitment(Number(id)), bidder);
  }

  async submitOpenBid(
    id: string,
    bidder: string,
    payload: { documentsHash: string; priceLineItems: RevealedBid['priceLineItems'] },
  ): Promise<void> {
    const lines = toChainPriceLines(payload.priceLineItems);
    const documentsHash = asHash32(payload.documentsHash, `documents:${id}:${bidder}`);
    await this.send(
      this.mustApi().tx.tenderChain.submitOpenBid(Number(id), documentsHash, lines),
      bidder,
    );
  }

  async revealBid(
    id: string,
    bidder: string,
    payload: { documentsHash: string; priceLineItems: RevealedBid['priceLineItems']; salt?: string },
  ): Promise<void> {
    const salt = asHash32(payload.salt, `salt:${id}:${bidder}`);
    const lines = toChainPriceLines(payload.priceLineItems);
    const documentsHash = asHash32(payload.documentsHash, `documents:${id}:${bidder}`);
    const events = await this.send(
      this.mustApi().tx.tenderChain.revealBid(Number(id), documentsHash, lines, salt),
      bidder,
    );
    // reveal_bid returns Ok on a hash mismatch; the failure is only an event.
    if (findEvent(events, 'tenderChain', 'RevealMismatch')) {
      throw new ChainCallError(
        'RevealMismatch — the revealed content did not hash to the commitment. The bid is voided but stays on the public record.',
      );
    }
  }

  /** The commitment a bidder must publish before close, per the pallet's preimage. */
  buildCommitment(
    bidder: string,
    documentsHash: string,
    priceLineItems: RevealedBid['priceLineItems'],
    salt: string,
  ): string {
    return computeCommitment(
      this.mustApi(),
      bidder,
      documentsHash,
      toChainPriceLines(priceLineItems),
      salt,
    );
  }

  async submitScores(input: SubmitScoreInput): Promise<void> {
    const bidder = bidderOf(input.bidId);
    const scores = input.scores.map((s) => ({
      criterionId: Number(s.criterionId),
      score: s.score,
    }));
    const commentHash = asHash32(
      input.scores[0]?.commentHash,
      `scores:${input.evaluator}:${input.bidId}`,
    );
    await this.send(
      this.mustApi().tx.tenderChain.submitScores(Number(input.tenderId), bidder, scores, commentHash),
      input.evaluator,
    );
  }

  /**
   * The pallet has one governed `award` call, not a propose/approve pair. The
   * officer's proposal is therefore recorded locally and dispatched when
   * governance approves it.
   */
  async proposeAward(id: string, bidId: string, rationale: string): Promise<void> {
    putText(rationale);
    writeProposal(id, { bidId, rationale });
    await this.refresh();
  }

  async approveAward(id: string): Promise<void> {
    const proposal = readProposals()[id];
    if (!proposal) {
      throw new ChainCallError('No award proposal recorded for this tender — propose an award first.');
    }
    const awardee = bidderOf(proposal.bidId);
    const api = this.mustApi();
    await this.sendSudo(
      api.tx.tenderChain.award(Number(id), [awardee], hashOf(proposal.rationale)),
    );
  }

  async lodgeChallenge(id: string, lodgedBy: string, grounds: string): Promise<void> {
    await this.send(this.mustApi().tx.tenderChain.lodgeChallenge(Number(id), putText(grounds)), lodgedBy);
  }

  async resolveChallenge(
    id: string,
    challengeId: string,
    status: 'Upheld' | 'Dismissed',
    rationale: string,
  ): Promise<void> {
    const api = this.mustApi();
    await this.sendSudo(
      api.tx.tenderChain.resolveChallenge(
        Number(id),
        Number(challengeId),
        status === 'Upheld',
        putText(rationale),
      ),
    );
  }

  /** Post-standstill contract notarisation. */
  async executeAward(id: string, contractText = 'Contract executed'): Promise<void> {
    const t = await this.requireTender(id);
    await this.send(
      this.mustApi().tx.tenderChain.executeAward(Number(id), putText(contractText)),
      t.officer,
    );
  }

  /**
   * `--dev` endows only Alice, Bob and their stashes, but the lifecycle needs
   * five distinct accounts (officer, bidder, three evaluators). Everything else
   * fails with "Inability to pay some fees" until they hold a balance, so this
   * tops them up from the sudo key. Dev chains only — it is a no-op when the
   * accounts came from an extension.
   */
  async fundDevAccounts(): Promise<string[]> {
    await this.ready;
    const api = this.mustApi();
    if (this.accountSource !== 'dev') return [];

    const funder = (await api.query.sudo.key()).toString();
    if (!getDevPair(funder)) throw new ChainCallError('No signing key for the sudo account.');

    const needy: string[] = [];
    for (const account of this.accounts) {
      if (account.address === funder) continue;
      const info = (await api.query.system.account(account.address)) as unknown as {
        data: { free: { toString(): string } };
      };
      if (BigInt(info.data.free.toString()) === 0n) needy.push(account.address);
    }
    if (needy.length === 0) return [];

    // No utility pallet in this runtime, so the transfers go one at a time.
    const amount = 1_000_000_000_000_000n;
    for (const to of needy) {
      await submit(api, api.tx.balances.transferKeepAlive(to, amount), funder);
    }
    return needy.map((a) => this.nameFor(a));
  }

  /** The chain's clock is not ours to wind forward. */
  advanceBlocks(): void {
    /* no-op against a real node */
  }

  private async requireTender(id: string): Promise<Tender> {
    const t = await this.getTender(id);
    if (!t) throw new ChainCallError(`Tender ${id} not found on chain.`);
    return t;
  }
}

export { NOTICE };
