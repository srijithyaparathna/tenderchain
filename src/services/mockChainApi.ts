import type { AccountRef, ChainConstants, Challenge, Tender } from '../types';
import { ACCOUNTS, CONSTANTS, SEED_TENDERS, nowBlock, tickBlock } from '../data/seed';
import type { ChainApi, CreateTenderInput, SubmitScoreInput } from './chainApi';

// Deep clone so mutations never touch the seed module.
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

function applyAutoTransitions(t: Tender, block: number): Tender {
  let state = t.state;
  if (state === 'Published' && block >= t.gates.questionsCloseAt) state = 'Submission';
  if (state === 'Submission' && block >= t.gates.submissionCloseAt) state = 'Closed';
  if (state === 'Opening' && block >= t.gates.openingEndAt) state = 'Evaluation';
  if (
    state === 'Standstill' &&
    t.award?.approvedAtBlock !== undefined &&
    block >= t.award.approvedAtBlock + t.gates.standstillPeriod &&
    !t.challenges.some((c) => c.status === 'Open')
  ) {
    state = 'Contracted';
  }
  return state === t.state ? t : { ...t, state };
}

class MockChainApi implements ChainApi {
  private tenders: Tender[] = clone(SEED_TENDERS);
  private blockSubs = new Set<(b: number) => void>();
  private tenderSubs = new Set<(t: Tender[]) => void>();
  constructor() {
    // Simulate ~1 block per 4s so countdowns and gates visibly move during a demo.
    window.setInterval(() => {
      const block = tickBlock();
      this.blockSubs.forEach((cb) => cb(block));
      this.tenders = this.tenders.map((t) => applyAutoTransitions(t, block));
      this.tenderSubs.forEach((cb) => cb(clone(this.tenders)));
    }, 4000);
  }

  async getConstants(): Promise<ChainConstants> {
    return clone(CONSTANTS);
  }

  getCurrentBlock(): number {
    return nowBlock();
  }

  subscribeBlock(cb: (block: number) => void): () => void {
    this.blockSubs.add(cb);
    return () => this.blockSubs.delete(cb);
  }

  listAccounts(): AccountRef[] {
    return clone(ACCOUNTS);
  }

  private snapshot(): Tender[] {
    const block = this.getCurrentBlock();
    this.tenders = this.tenders.map((t) => applyAutoTransitions(t, block));
    return clone(this.tenders);
  }

  async listTenders(): Promise<Tender[]> {
    return this.snapshot();
  }

  async getTender(id: string): Promise<Tender | undefined> {
    return this.snapshot().find((t) => t.id === id);
  }

  subscribeTenders(cb: (tenders: Tender[]) => void): () => void {
    this.tenderSubs.add(cb);
    return () => this.tenderSubs.delete(cb);
  }

  private mutate(id: string, fn: (t: Tender) => void) {
    const t = this.tenders.find((x) => x.id === id);
    if (!t) throw new Error(`Unknown tender ${id}`);
    fn(t);
    this.tenderSubs.forEach((cb) => cb(clone(this.tenders)));
  }

  private notifyAll() {
    this.tenderSubs.forEach((cb) => cb(clone(this.tenders)));
  }

  async createTender(input: CreateTenderInput): Promise<Tender> {
    const id = `T-${1000 + this.tenders.length + Math.floor(Math.random() * 900)}`;
    const t: Tender = {
      id,
      noticeHash:
        '0x' +
        Array.from(id + input.title)
          .reduce((a, c) => (a * 33 + c.charCodeAt(0)) >>> 0, 5381)
          .toString(16)
          .padStart(8, '0')
          .repeat(4)
          .slice(0, 64),
      title: input.title,
      summary: input.summary,
      entity: input.entity,
      officer: input.officer,
      kind: input.kind,
      bidMode: input.bidMode,
      state: 'Draft',
      criteria: input.criteria,
      gates: input.gates,
      eligibility: input.eligibility,
      bond: input.bond,
      documents: [],
      qa: [],
      blindQuestions: input.blindQuestions,
      shortlistFromTenderId: input.shortlistFromTenderId,
      evaluators: [],
      conflictDeclarations: [],
      commitments: [],
      revealedBids: [],
      scores: [],
      challenges: [],
      createdAtBlock: this.getCurrentBlock(),
    };
    this.tenders.unshift(t);
    this.notifyAll();
    return clone(t);
  }

  async publishTender(id: string): Promise<void> {
    this.mutate(id, (t) => {
      if (t.state !== 'Draft') throw new Error('Only draft tenders can be published');
      t.state = 'Published';
    });
  }

  async cancelTender(id: string): Promise<void> {
    this.mutate(id, (t) => {
      t.state = 'Cancelled';
    });
  }

  async answerQuestion(id: string, qaId: string, answer: string): Promise<void> {
    this.mutate(id, (t) => {
      const qa = t.qa.find((q) => q.id === qaId);
      if (!qa) throw new Error('Question not found');
      qa.answer = answer;
      qa.answeredAtBlock = this.getCurrentBlock();
    });
  }

  async appointEvaluator(id: string, evaluator: string): Promise<void> {
    this.mutate(id, (t) => {
      if (!t.evaluators.includes(evaluator)) t.evaluators.push(evaluator);
    });
  }

  async openTender(id: string): Promise<void> {
    this.mutate(id, (t) => {
      if (t.state !== 'Closed') throw new Error('Tender must be Closed before opening');
      if (this.getCurrentBlock() < t.gates.openingAt) throw new Error('Opening block not yet reached');
      t.state = 'Opening';
    });
  }

  async publishShortlist(id: string, bidderAddresses: string[]): Promise<void> {
    this.mutate(id, (t) => {
      t.shortlistedBidders = bidderAddresses;
    });
  }

  async proposeAward(id: string, bidId: string, rationale: string): Promise<void> {
    this.mutate(id, (t) => {
      if (t.state !== 'Evaluation') throw new Error('Tender must be in Evaluation to propose award');
      const bid = t.revealedBids.find((r) => r.id === bidId);
      if (!bid) throw new Error('Bid not found');
      t.award = {
        awardedBidId: bidId,
        awardedBidder: bid.bidder,
        rationale,
        proposedBy: t.officer,
        proposedAtBlock: this.getCurrentBlock(),
        approvedByGovernance: false,
      };
    });
  }

  async askQuestion(id: string, asker: string, question: string, blind: boolean): Promise<void> {
    this.mutate(id, (t) => {
      t.qa.push({
        id: `q${t.qa.length + 1}-${Date.now()}`,
        askedBy: asker,
        question,
        askedAtBlock: this.getCurrentBlock(),
        blind: blind && t.blindQuestions,
      });
    });
  }

  async commitBid(id: string, bidder: string, commitmentHash: string): Promise<void> {
    this.mutate(id, (t) => {
      if (t.state !== 'Submission') throw new Error('Bids can only be committed during the submission window');
      const existing = t.commitments.find((c) => c.bidder === bidder);
      if (existing) {
        existing.commitmentHash = commitmentHash;
        existing.withdrawn = false;
        existing.committedAtBlock = this.getCurrentBlock();
      } else {
        t.commitments.push({
          bidder,
          commitmentHash,
          committedAtBlock: this.getCurrentBlock(),
          withdrawn: false,
          bondPaid: true,
        });
      }
    });
  }

  async withdrawCommitment(id: string, bidder: string): Promise<void> {
    this.mutate(id, (t) => {
      const c = t.commitments.find((x) => x.bidder === bidder);
      if (!c) throw new Error('No commitment found');
      c.withdrawn = true;
    });
  }

  async revealBid(
    id: string,
    bidder: string,
    payload: { documentsHash: string; priceLineItems: { id: string; description: string; qty: number; unitPrice: number }[] },
  ): Promise<void> {
    this.mutate(id, (t) => {
      if (t.state !== 'Opening') throw new Error('Reveal is only possible during the Opening window');
      const commitment = t.commitments.find((c) => c.bidder === bidder && !c.withdrawn);
      if (!commitment) throw new Error('No active commitment for this bidder');
      const totalPrice = payload.priceLineItems.reduce((sum, l) => sum + l.qty * l.unitPrice, 0);
      t.revealedBids.push({
        id: `bid-${t.revealedBids.length + 1}-${Date.now()}`,
        bidder,
        bidderName: ACCOUNTS.find((a) => a.address === bidder)?.name ?? bidder,
        documentsHash: payload.documentsHash,
        priceLineItems: payload.priceLineItems,
        totalPrice,
        revealedAtBlock: this.getCurrentBlock(),
      });
    });
  }

  async submitOpenBid(
    id: string,
    bidder: string,
    payload: { documentsHash: string; priceLineItems: { id: string; description: string; qty: number; unitPrice: number }[] },
  ): Promise<void> {
    this.mutate(id, (t) => {
      if (t.bidMode !== 'Open') throw new Error('This tender uses sealed bidding');
      const totalPrice = payload.priceLineItems.reduce((sum, l) => sum + l.qty * l.unitPrice, 0);
      t.revealedBids = t.revealedBids.filter((b) => b.bidder !== bidder);
      t.revealedBids.push({
        id: `bid-${t.revealedBids.length + 1}-${Date.now()}`,
        bidder,
        bidderName: ACCOUNTS.find((a) => a.address === bidder)?.name ?? bidder,
        documentsHash: payload.documentsHash,
        priceLineItems: payload.priceLineItems,
        totalPrice,
        revealedAtBlock: this.getCurrentBlock(),
      });
    });
  }

  async lodgeChallenge(id: string, lodgedBy: string, grounds: string): Promise<void> {
    this.mutate(id, (t) => {
      if (t.state !== 'Standstill') throw new Error('Challenges can only be lodged during the standstill window');
      t.challenges.push({
        id: `ch-${t.challenges.length + 1}-${Date.now()}`,
        lodgedBy,
        lodgedAtBlock: this.getCurrentBlock(),
        grounds,
        status: 'Open',
      });
    });
  }

  async declareConflict(id: string, evaluator: string, hasConflict: boolean, notes?: string): Promise<void> {
    this.mutate(id, (t) => {
      const existing = t.conflictDeclarations.find((c) => c.evaluator === evaluator);
      if (existing) {
        existing.hasConflict = hasConflict;
        existing.notes = notes;
        existing.declaredAtBlock = this.getCurrentBlock();
      } else {
        t.conflictDeclarations.push({
          evaluator,
          declaredAtBlock: this.getCurrentBlock(),
          hasConflict,
          notes,
        });
      }
    });
  }

  async submitScores(input: SubmitScoreInput): Promise<void> {
    this.mutate(input.tenderId, (t) => {
      const conflict = t.conflictDeclarations.find((c) => c.evaluator === input.evaluator);
      if (conflict?.hasConflict) throw new Error('Evaluator has declared a conflict of interest on this tender');
      t.scores = t.scores.filter((s) => !(s.evaluator === input.evaluator && s.bidId === input.bidId));
      t.scores.push({
        evaluator: input.evaluator,
        bidId: input.bidId,
        scores: input.scores,
        submittedAtBlock: this.getCurrentBlock(),
      });
    });
  }

  async approveAward(id: string): Promise<void> {
    this.mutate(id, (t) => {
      if (!t.award) throw new Error('No award has been proposed');
      t.award.approvedByGovernance = true;
      t.award.approvedAtBlock = this.getCurrentBlock();
      t.state = 'Standstill';
    });
  }

  async resolveChallenge(
    id: string,
    challengeId: string,
    status: Extract<Challenge['status'], 'Upheld' | 'Dismissed'>,
    rationale: string,
  ): Promise<void> {
    this.mutate(id, (t) => {
      const c = t.challenges.find((x) => x.id === challengeId);
      if (!c) throw new Error('Challenge not found');
      c.status = status;
      c.resolvedAtBlock = this.getCurrentBlock();
      c.resolutionRationale = rationale;
      c.resolvedBy = t.officer;
    });
  }

  advanceBlocks(n: number): void {
    for (let i = 0; i < n; i++) {
      const block = tickBlock();
      this.blockSubs.forEach((cb) => cb(block));
    }
    this.tenders = this.tenders.map((t) => applyAutoTransitions(t, this.getCurrentBlock()));
    this.notifyAll();
  }
}

export const chainApi: ChainApi = new MockChainApi();
