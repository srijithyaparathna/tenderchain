// End-to-end test of the portal's chain layer against a running node.
//
// Drives the *same* `LiveChainApi` every page and panel calls, so a pass here
// means the buttons do what they say. Covers:
//
//   A. delete_tender, and that every refusal comes back as a clear error;
//   B. a sealed RFT start to finish (spec Flow A + Flow C): Q&A, sealed commits,
//      withdraw + re-commit, a reveal mismatch, a recused evaluator, a score
//      variance flag, an award, a challenge that is upheld, a re-award, and
//      execution with every bond returned.
//
//   npx vite-node scripts/e2e.ts
//   VITE_WS_ENDPOINT=ws://127.0.0.1:9955 npx vite-node scripts/e2e.ts
//
// Takes ~17 minutes: MinRevealWindow is 100 blocks and cannot be compressed.

import type { EventRecord } from '@polkadot/types/interfaces';
import { LiveChainApi } from '../src/services/liveChainApi';
import { connect } from '../src/services/chainConnection';
import { devAccounts } from '../src/services/accounts';
import { submit, submitSudo } from '../src/services/chainSigner';
import { explainError } from '../src/lib/errors';
import { randomSalt } from '../src/lib/hashing';
import type { CreateTenderInput } from '../src/services/chainApi';
import type { Tender } from '../src/types';

// --- browser shims ---------------------------------------------------------
const mem = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
};

let passed = 0;
const log = (step: string, detail = '') => console.log(`  ✓ ${step.padEnd(44)} ${detail}`);

function fail(step: string, err: unknown): never {
  const v = explainError(err);
  console.error(`\n  ✗ FAILED at ${step}: ${v.title}${v.code ? ` [${v.code}]` : ''}`);
  if (v.docs) console.error(`    ${v.docs}`);
  process.exit(1);
}

function check(step: string, cond: unknown, detail = '') {
  if (!cond) fail(step, new Error(`assertion failed${detail ? `: ${detail}` : ''}`));
  passed++;
  log(step, detail);
}

async function ok<T>(step: string, fn: () => Promise<T>, detail?: (v: T) => string): Promise<T> {
  try {
    const v = await fn();
    passed++;
    log(step, detail ? detail(v) : '');
    return v;
  } catch (e) {
    fail(step, e);
  }
}

/** The call must be refused with `code`, and the portal must explain it in words. */
async function refused(step: string, fn: () => Promise<unknown>, code: string) {
  try {
    await fn();
  } catch (e) {
    const v = explainError(e);
    if (v.code !== code) fail(step, new Error(`expected ${code}, got ${v.code ?? v.title}`));
    if (!v.title || v.title === code) fail(step, new Error(`${code} has no plain-language explanation`));
    passed++;
    log(step, `refused ${code} → “${v.title}”`);
    return;
  }
  fail(step, new Error(`expected ${code}, but the call succeeded`));
}

async function main() {
  const api = await connect();
  const chain = new LiveChainApi();
  const [alice, bob, charlie, dave, eve, ferdie, aliceStash, bobStash] = await devAccounts(api.registry.chainSS58 ?? 42);

  // Every TenderChain event, so assertions can be made on what the chain said.
  const events: EventRecord[] = [];
  await api.query.system.events((recs: unknown) => {
    for (const r of recs as EventRecord[]) if (r.event.section === 'tenderChain') events.push(r);
  });
  const sawEvent = (method: string, tenderId: string) =>
    events.some((r) => r.event.method === method && r.event.data[0]?.toHex?.() === tenderId);

  const funded = await chain.fundDevAccounts();
  if (funded.length > 0) console.log(`  funded dev accounts: ${funded.join(', ')}`);
  const consts = await chain.getConstants();
  console.log(`\nspec ${api.runtimeVersion.specVersion} · minEvaluators=${consts.minEvaluators} minRevealWindow=${consts.minRevealWindow} varianceThreshold=${consts.scoreVarianceThreshold}\n`);

  await new Promise<void>((r) => {
    const unsub = chain.subscribeBlock(() => (unsub(), r()));
  });
  const waitFor = (block: number, why: string) =>
    new Promise<void>((resolve) => {
      if (chain.getCurrentBlock() >= block) return resolve();
      console.log(`    …waiting for block ${block} (${why}; now ${chain.getCurrentBlock()})`);
      const unsub = chain.subscribeBlock((b) => {
        if (b >= block) {
          unsub();
          resolve();
        }
      });
    });
  const get = async (id: string): Promise<Tender> => {
    const t = await chain.getTender(id);
    if (!t) fail('read tender', new Error(`tender ${id} not found`));
    return t;
  };

  const now = () => chain.getCurrentBlock();
  const baseInput = (over: Partial<CreateTenderInput> = {}): CreateTenderInput => {
    const N = now();
    return {
      title: 'E2E draft',
      summary: 'Automated end-to-end check.',
      entity: 'Dept. of Works',
      officer: alice.address,
      kind: 'RFT',
      bidMode: 'Sealed',
      criteria: [
        { id: 'a', name: 'Technical', description: 'Method statement', weight: 60, maxScore: consts.maxScore },
        { id: 'b', name: 'Price', description: 'Whole-of-life cost', weight: 40, maxScore: consts.maxScore },
      ],
      gates: {
        publishAt: N,
        questionsCloseAt: N + 200,
        submissionCloseAt: N + 400,
        openingAt: N + 400,
        openingEndAt: N + 600,
        standstillPeriod: 10,
      },
      eligibility: { requiredCredentials: [], minReputation: 0 },
      bond: { amount: '0', currency: 'UNIT', forfeitOnWithdrawal: false },
      blindQuestions: false,
      ...over,
    };
  };

  // ======================================================================
  console.log('A. Deleting tenders, and clear refusals\n');

  const d1 = await ok('A1 create draft', () => chain.createTender(baseInput({ title: 'E2E delete me' })), (t) => t.state);
  await ok('A1 delete draft', () => chain.deleteTender(d1.id));
  check('A1 deleted draft is gone from the list', !(await chain.listTenders()).some((t) => t.id === d1.id));
  check('A1 TenderDeleted event emitted', sawEvent('TenderDeleted', d1.id));
  await refused('A1 deleting it again', () => submit(api, api.tx.tenderChain.deleteTender(d1.id), alice.address), 'tenderChain.TenderNotFound');

  const d2 = await ok('A2 create draft', () => chain.createTender(baseInput({ title: 'E2E cancel then delete' })));
  await ok('A2 cancel draft (with reason)', () => chain.cancelTender(d2.id, 'Requirement withdrawn before publication.'));
  check('A2 state is Cancelled', (await get(d2.id)).state === 'Cancelled');
  await ok('A2 delete cancelled draft', () => chain.deleteTender(d2.id));
  check('A2 gone', !(await chain.listTenders()).some((t) => t.id === d2.id));

  const p1 = await ok('A3 create + publish', async () => {
    const t = await chain.createTender(baseInput({ title: 'E2E published — not deletable' }));
    await chain.publishTender(t.id);
    return get(t.id);
  }, (t) => t.state);
  await refused('A3 delete published tender', () => chain.deleteTender(p1.id), 'tenderChain.TenderNotDeletable');
  await refused('A3 non-officer deletes', () => submit(api, api.tx.tenderChain.deleteTender(p1.id), bob.address), 'tenderChain.NotOfficer');
  await refused('A3 non-entity cancels', () => submit(api, api.tx.tenderChain.cancelTender(p1.id, `0x${'11'.repeat(32)}`), bob.address), 'tenderChain.NotEntity');
  await ok('A3 cancel published tender', () => chain.cancelTender(p1.id, 'Superseded by a revised specification.'));
  await refused('A3 delete after cancel (still public record)', () => chain.deleteTender(p1.id), 'tenderChain.TenderNotDeletable');

  await refused('A4 open bid on an RFT', () => chain.createTender(baseInput({ bidMode: 'Open' })), 'tenderChain.OpenBidNotPermitted');
  await refused('A5 weights not summing to 100', () =>
    chain.createTender(baseInput({ criteria: [{ id: 'x', name: 'Only', description: '', weight: 90, maxScore: 100 }] })), 'tenderChain.WeightsInvalid');
  await refused('A6 gates out of order', () =>
    chain.createTender(baseInput({ gates: { ...baseInput().gates, questionsCloseAt: now() + 900 } })), 'tenderChain.GateOrderInvalid');
  await refused('A7 empty title', () => chain.createTender(baseInput({ title: '' })), 'tenderChain.TitleEmpty');

  const d3 = await ok('A8 create draft for refusal checks', () => chain.createTender(baseInput({ title: 'E2E refusals' })));
  await refused('A8 bid on an unpublished draft', () => chain.commitBid(d3.id, bob.address, `0x${'22'.repeat(32)}`), 'tenderChain.TenderNotPublished');
  await refused('A8 publish by a non-officer', () => submit(api, api.tx.tenderChain.publishTender(d3.id), bob.address), 'tenderChain.NotOfficer');
  await refused('A8 award signed by a plain account', () =>
    submit(api, api.tx.tenderChain.award(d3.id, [bob.address], `0x${'33'.repeat(32)}`), alice.address), 'tenderChain.AwardAuthorityRequired');
  await refused('A8 award via sudo on a draft (inner error decoded)', () =>
    submitSudo(api, api.tx.tenderChain.award(d3.id, [bob.address], `0x${'33'.repeat(32)}`)), 'tenderChain.BadState');
  await ok('A8 clean up: delete draft', () => chain.deleteTender(d3.id));

  // ======================================================================
  console.log('\nB. Sealed RFT, Flow A + Flow C\n');

  const N = now();
  const gates = {
    publishAt: N + 1,
    questionsCloseAt: N + 10,
    submissionCloseAt: N + 40,
    openingAt: N + 52,
    openingEndAt: N + 52 + consts.minRevealWindow + 14,
    standstillPeriod: 12,
  };
  const tender = await ok('B1 create sealed RFT (bond 1000)', () =>
    chain.createTender(baseInput({
      title: 'E2E arterial road resurfacing',
      summary: 'Full Flow A + Flow C through the portal API.',
      gates,
      bond: { amount: '1000', currency: 'UNIT', forfeitOnWithdrawal: false },
    })), (t) => `id=${t.id.slice(0, 10)}… state=${t.state}`);
  const id = tender.id;
  const [cTech, cPrice] = tender.criteria;

  await waitFor(gates.publishAt, 'publish gate');
  await ok('B2 publish', () => chain.publishTender(id), () => 'QaWindow');
  check('B2 portal shows Published', (await get(id)).state === 'Published');
  await refused('B2 delete published tender', () => chain.deleteTender(id), 'tenderChain.TenderNotDeletable');

  await ok('B3 Bob asks a question', () => chain.askQuestion(id, bob.address, 'Is existing asphalt to be milled?', false));
  const qid = (await get(id)).qa[0]?.id;
  check('B3 question visible with a hash id', qid?.startsWith('0x') && qid.length === 66);
  await ok('B3 officer answers', () => chain.answerQuestion(id, qid!, 'Yes, 50mm mill and fill.'));
  check('B3 answer published', (await get(id)).qa[0]?.answer === 'Yes, 50mm mill and fill.');
  await waitFor(gates.questionsCloseAt + 1, 'questions close -> Submission');
  await refused('B3 question after Q&A closes', () => chain.askQuestion(id, bob.address, 'Late question', false), 'tenderChain.QuestionsClosed');
  await refused('B3 answer cannot be rewritten', () => chain.answerQuestion(id, qid!, 'Changed answer'), 'tenderChain.AlreadyAnswered');

  // Evaluators are appointed before bidding; separation is enforced both ways.
  for (const ev of [charlie, dave, eve, ferdie]) {
    await ok(`B4 appoint evaluator ${ev.name}`, () => chain.appointEvaluator(id, ev.address));
  }
  await refused('B4 officer cannot evaluate own tender', () => chain.appointEvaluator(id, alice.address), 'tenderChain.OfficerCannotEvaluate');
  await refused('B4 evaluator cannot bid', () => chain.commitBid(id, charlie.address, `0x${'44'.repeat(32)}`), 'tenderChain.EvaluatorIsBidder');

  // Sealed commits — same computation the Bid panel runs live.
  const bids = {
    bob: { who: bob, docs: `0x${'b1'.repeat(32)}`, lines: [{ id: '1', description: 'Mill and fill', qty: 1, unitPrice: 900_000 }], salt: randomSalt() },
    aliceStash: { who: aliceStash, docs: `0x${'a5'.repeat(32)}`, lines: [{ id: '1', description: 'Mill and fill', qty: 1, unitPrice: 950_000 }], salt: randomSalt() },
    bobStash: { who: bobStash, docs: `0x${'b5'.repeat(32)}`, lines: [{ id: '1', description: 'Mill and fill', qty: 1, unitPrice: 700_000 }], salt: randomSalt() },
  };
  for (const [name, b] of Object.entries(bids)) {
    const commitment = chain.buildCommitment(b.who.address, b.docs, b.lines, b.salt);
    await ok(`B5 ${name} commits sealed bid`, () => chain.commitBid(id, b.who.address, commitment));
  }
  check('B5 commitments are hashes only (no prices on chain)', (await get(id)).revealedBids.length === 0 && (await get(id)).commitments.length === 3);
  await refused('B5 second commit from the same bidder', () => chain.commitBid(id, bob.address, `0x${'55'.repeat(32)}`), 'tenderChain.CommitmentExists');

  await ok('B6 aliceStash withdraws', () => chain.withdrawCommitment(id, aliceStash.address));
  check('B6 bond returned on withdrawal', sawEvent('BondReturned', id));
  bids.aliceStash.salt = randomSalt();
  await ok('B6 aliceStash re-commits', () =>
    chain.commitBid(id, aliceStash.address, chain.buildCommitment(aliceStash.address, bids.aliceStash.docs, bids.aliceStash.lines, bids.aliceStash.salt)));

  await waitFor(gates.submissionCloseAt + 1, 'submission close -> Closed');
  check('B7 deadline wheel closed the tender', (await get(id)).state === 'Closed');
  await refused('B7 late bid after close', () => chain.commitBid(id, bobStash.address, `0x${'66'.repeat(32)}`), 'tenderChain.SubmissionClosed');
  await refused('B7 open before the opening block', () => chain.openTender(id), 'tenderChain.OpeningNotReached');
  await refused('B7 reveal before opening', () =>
    chain.revealBid(id, bob.address, { documentsHash: bids.bob.docs, priceLineItems: bids.bob.lines, salt: bids.bob.salt }), 'tenderChain.RevealWindowClosed');

  await waitFor(gates.openingAt, 'opening block');
  await ok('B8 officer opens tender', () => chain.openTender(id), () => 'Opening');
  await ok('B8 Bob reveals', () => chain.revealBid(id, bob.address, { documentsHash: bids.bob.docs, priceLineItems: bids.bob.lines, salt: bids.bob.salt }));
  await ok('B8 aliceStash reveals', () =>
    chain.revealBid(id, aliceStash.address, { documentsHash: bids.aliceStash.docs, priceLineItems: bids.aliceStash.lines, salt: bids.aliceStash.salt }));
  await refused('B8 bobStash reveals with the WRONG salt', () =>
    chain.revealBid(id, bobStash.address, { documentsHash: bids.bobStash.docs, priceLineItems: bids.bobStash.lines, salt: randomSalt() }), 'tenderChain.RevealMismatch');
  const opened = await get(id);
  check('B8 mismatch voids the bid on the public record', opened.revealedBids.find((b) => b.bidder === bobStash.address)?.disqualified === true);
  check('B8 RevealMismatch event emitted', sawEvent('RevealMismatch', id));
  await refused('B8 cannot reveal twice', () =>
    chain.revealBid(id, bob.address, { documentsHash: bids.bob.docs, priceLineItems: bids.bob.lines, salt: bids.bob.salt }), 'tenderChain.AlreadyRevealed');

  for (const ev of [charlie, dave, eve]) {
    await ok(`B9 ${ev.name} declares no conflict (+ activation)`, () => chain.declareConflict(id, ev.address, false, `No conflict — ${ev.name}`));
  }
  await ok('B9 Ferdie declares a conflict', () => chain.declareConflict(id, ferdie.address, true, 'Former employee of a bidder'));
  const panel = await get(id);
  check('B9 three active evaluators', panel.activeEvaluators.length === 3, panel.activeEvaluators.length.toString());
  check('B9 conflicted evaluator is recused (not activated)',
    !panel.activeEvaluators.includes(ferdie.address) && panel.conflictDeclarations.find((c) => c.evaluator === ferdie.address)?.hasConflict === true);

  await waitFor(gates.openingEndAt + 1, 'opening end -> Evaluation');
  check('B10 wheel moved tender to Evaluation', (await get(id)).state === 'Evaluation');
  const bobBid = `${id}:${bob.address}`;
  const aliceStashBid = `${id}:${aliceStash.address}`;
  const sheet = (tech: number, price: number) => [
    { criterionId: cTech.id, score: tech, commentHash: '' },
    { criterionId: cPrice.id, score: price, commentHash: '' },
  ];
  await ok('B10 Charlie scores Bob', () => chain.submitScores({ tenderId: id, evaluator: charlie.address, bidId: bobBid, scores: sheet(85, 80) }));
  await ok('B10 Dave scores Bob (40-point spread)', () => chain.submitScores({ tenderId: id, evaluator: dave.address, bidId: bobBid, scores: sheet(45, 78) }));
  check('B10 ScoreVarianceFlagged emitted for probity review', sawEvent('ScoreVarianceFlagged', id));
  await ok('B10 Eve scores Bob', () => chain.submitScores({ tenderId: id, evaluator: eve.address, bidId: bobBid, scores: sheet(80, 82) }));
  for (const ev of [charlie, dave, eve]) {
    await ok(`B10 ${ev.name} scores aliceStash`, () => chain.submitScores({ tenderId: id, evaluator: ev.address, bidId: aliceStashBid, scores: sheet(70, 70) }));
  }
  await refused('B10 voided bid cannot be scored', () =>
    chain.submitScores({ tenderId: id, evaluator: charlie.address, bidId: `${id}:${bobStash.address}`, scores: sheet(50, 50) }), 'tenderChain.BidNotScoreable');
  await refused('B10 recused evaluator cannot score', () =>
    chain.submitScores({ tenderId: id, evaluator: ferdie.address, bidId: bobBid, scores: sheet(50, 50) }), 'tenderChain.ConflictNotDeclared');
  await refused('B10 score above MaxScore', () =>
    chain.submitScores({ tenderId: id, evaluator: charlie.address, bidId: bobBid, scores: sheet(101, 50) }), 'tenderChain.ScoreOutOfRange');

  await ok('B11 officer proposes Bob', () => chain.proposeAward(id, bobBid, 'Highest weighted score.'));
  check('B11 proposal shown as pending governance', (await get(id)).award?.approvedByGovernance === false);
  await ok('B11 governance approves (sudo award)', () => chain.approveAward(id));
  const awarded = await get(id);
  check('B11 state Standstill, awardee Bob', awarded.state === 'Standstill' && awarded.award?.awardedBidder === bob.address);

  await refused('B12 awardee cannot challenge', () => chain.lodgeChallenge(id, bob.address, 'I object to myself.'), 'tenderChain.AwardeeCannotChallenge');
  await refused('B12 non-bidder cannot challenge', () => chain.lodgeChallenge(id, ferdie.address, 'Outsider objection'), 'tenderChain.NotAParticipant');
  await refused('B12 challenge needs grounds', () => chain.lodgeChallenge(id, aliceStash.address, ''), 'tenderChain.GroundsEmpty');
  await ok('B12 aliceStash lodges challenge', () => chain.lodgeChallenge(id, aliceStash.address, 'Technical score variance not reviewed before award.'));
  await refused('B12 execution suspended while challenge open', () => chain.executeAward!(id, 'Contract'), 'tenderChain.ChallengeOpen');
  const cid = (await get(id)).challenges[0].id;
  await ok('B12 governance upholds challenge', () => chain.resolveChallenge(id, cid, 'Upheld', 'Variance flag was not reviewed; remitted for re-evaluation.'));
  const remitted = await get(id);
  check('B12 remitted to Evaluation with the overturned award cleared', remitted.state === 'Evaluation' && remitted.award === undefined);

  await ok('B13 officer re-proposes aliceStash', () => chain.proposeAward(id, aliceStashBid, 'Re-evaluated after upheld challenge.'));
  await ok('B13 governance approves re-award', () => chain.approveAward(id));
  const reAwarded = await get(id);
  check('B13 Standstill again, awardee aliceStash', reAwarded.state === 'Standstill' && reAwarded.award?.awardedBidder === aliceStash.address);
  await refused('B13 execute during standstill', () => chain.executeAward!(id, 'Contract'), 'tenderChain.StandstillActive');

  const standstillEnd = reAwarded.award!.approvedAtBlock! + gates.standstillPeriod;
  await waitFor(standstillEnd + 1, 'standstill end');
  await ok('B14 execute award', () => chain.executeAward!(id, 'Contract 2026-E2E executed.'));
  const done = await get(id);
  check('B14 state Contracted', done.state === 'Contracted');
  check('B14 ContractExecuted + BondReturned events', sawEvent('ContractExecuted', id) && sawEvent('BondReturned', id));
  await refused('B14 contracted tender cannot be cancelled', () => chain.cancelTender(id, 'Too late'), 'tenderChain.BadState');
  await refused('B14 contracted tender cannot be deleted', () => chain.deleteTender(id), 'tenderChain.TenderNotDeletable');

  console.log(`\nPASS — ${passed} checks. Tender ${id} reached ${done.state}.\n`);
  await api.disconnect();
  process.exit(0);
}

main().catch((e) => fail('unexpected', e));
