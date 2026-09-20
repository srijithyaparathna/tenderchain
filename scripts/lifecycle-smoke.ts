// Drives the whole tender lifecycle through the *same* `LiveChainApi` the UI
// uses, against a running node. If this passes, the portal's buttons do what
// the Polkadot.js Apps walkthrough does.
//
//   npx vite-node scripts/lifecycle-smoke.ts
//   VITE_WS_ENDPOINT=ws://127.0.0.1:9955 npx vite-node scripts/lifecycle-smoke.ts
//
// Takes ~15 minutes: MinRevealWindow is 100 blocks, so the gap between
// `opening_at` and `opening_end_at` cannot be compressed.

import { LiveChainApi } from '../src/services/liveChainApi';
import { connect } from '../src/services/chainConnection';
import { devAccounts } from '../src/services/accounts';

// --- browser shims ---------------------------------------------------------
const mem = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
};

const log = (step: string, detail = '') => console.log(`  ${step.padEnd(28)} ${detail}`);

function fail(step: string, err: unknown): never {
  const e = err as { message?: string; docs?: string };
  console.error(`\n  FAILED at ${step}: ${e.message ?? String(err)}`);
  if (e.docs) console.error(`  ${e.docs}`);
  process.exit(1);
}

async function main() {
  const api = await connect();
  const chain = new LiveChainApi();
  const accounts = await devAccounts(api.registry.chainSS58 ?? 42);
  const [alice, bob, charlie, dave, eve] = accounts;

  const funded = await chain.fundDevAccounts();
  if (funded.length > 0) console.log(`  funded dev accounts: ${funded.join(', ')}`);

  const consts = await chain.getConstants();
  console.log(
    `\nminEvaluators=${consts.minEvaluators} minRevealWindow=${consts.minRevealWindow} maxScore=${consts.maxScore}\n`,
  );

  const waitFor = (block: number, why: string) =>
    new Promise<void>((resolve) => {
      if (chain.getCurrentBlock() >= block) return resolve();
      console.log(`  …waiting for block ${block} (${why})`);
      const unsub = chain.subscribeBlock((b) => {
        if (b >= block) {
          unsub();
          resolve();
        }
      });
    });

  // Wait for the head subscription to deliver a first block.
  await new Promise<void>((r) => {
    const unsub = chain.subscribeBlock(() => {
      unsub();
      r();
    });
  });

  const N = chain.getCurrentBlock();
  const gates = {
    publishAt: N + 2,
    questionsCloseAt: N + 8,
    submissionCloseAt: N + 16,
    openingAt: N + 16,
    // openTender needs >= MinRevealWindow blocks left, with margin for the call.
    openingEndAt: N + 16 + consts.minRevealWindow + 12,
    standstillPeriod: 2,
  };
  console.log(`current block ${N}; gates ${JSON.stringify(gates)}\n`);

  // 1 — create (Alice, officer)
  let tender;
  try {
    tender = await chain.createTender({
      title: 'Smoke test — resurfacing works',
      summary: 'Automated lifecycle check driven through LiveChainApi.',
      entity: 'Dept. of Works',
      officer: alice.address,
      kind: 'RFQ',
      bidMode: 'Open',
      criteria: [
        { id: '0', name: 'Price', description: 'Total cost', weight: 60, maxScore: consts.maxScore },
        { id: '1', name: 'Capability', description: 'Delivery record', weight: 40, maxScore: consts.maxScore },
      ],
      gates,
      eligibility: { requiredCredentials: [], minReputation: 0 },
      bond: { amount: '0', currency: 'UNIT', forfeitOnWithdrawal: false },
      blindQuestions: false,
    });
    log('1 createTender', `id=${tender.id} state=${tender.state}`);
  } catch (e) {
    fail('createTender', e);
  }

  const id = tender.id;

  // 2 — publish (Alice)
  try {
    await chain.publishTender(id);
    log('2 publishTender', `state=${(await chain.getTender(id))?.state}`);
  } catch (e) {
    fail('publishTender', e);
  }

  // 2b — a question during the Q&A window (Bob)
  try {
    await chain.askQuestion(id, bob.address, 'Is the existing surface to be removed?', false);
    await chain.answerQuestion(id, '0', 'Yes, full depth removal is in scope.');
    log('2b ask/answerQuestion', `qa=${(await chain.getTender(id))?.qa.length}`);
  } catch (e) {
    fail('ask/answerQuestion', e);
  }

  // 3 — open-mode bid (Bob), during Submission
  await waitFor(gates.questionsCloseAt, 'questions close -> Submission');
  try {
    await chain.submitOpenBid(id, bob.address, {
      documentsHash: `0x${'03'.repeat(32)}`,
      priceLineItems: [{ id: '0', description: 'Lump sum', qty: 1, unitPrice: 10_000_000_000 }],
    });
    const t = await chain.getTender(id);
    log('3 submitOpenBid', `revealedBids=${t?.revealedBids.length} valid=${!t?.revealedBids[0]?.disqualified}`);
  } catch (e) {
    fail('submitOpenBid', e);
  }

  // 4 — open (Alice), after the wheel has closed submissions
  await waitFor(gates.openingAt + 1, 'submission close -> Closed, then openingAt');
  try {
    await chain.openTender(id);
    log('4 openTender', `state=${(await chain.getTender(id))?.state}`);
  } catch (e) {
    fail('openTender', e);
  }

  // 5-7 — three evaluators appointed, declared, activated
  for (const ev of [charlie, dave, eve]) {
    try {
      await chain.appointEvaluator(id, ev.address);
      // declareConflict also activates (officer's call) inside the adapter.
      await chain.declareConflict(id, ev.address, false, `No conflict — ${ev.name}`);
      log('5-7 evaluator ready', ev.name);
    } catch (e) {
      fail(`evaluator ${ev.name}`, e);
    }
  }
  const activeCount = await api.query.tenderChain.activeEvaluatorCount(Number(id));
  log('   activeEvaluatorCount', activeCount.toString());

  // 8 — scores, once the wheel has moved the tender to Evaluation
  await waitFor(gates.openingEndAt, 'opening end -> Evaluation');
  const bidId = (await chain.getTender(id))!.revealedBids[0].id;
  for (const ev of [charlie, dave, eve]) {
    try {
      await chain.submitScores({
        tenderId: id,
        evaluator: ev.address,
        bidId,
        scores: [
          { criterionId: '0', score: 80, commentHash: '' },
          { criterionId: '1', score: 75, commentHash: '' },
        ],
      });
      log('8 submitScores', ev.name);
    } catch (e) {
      fail(`submitScores ${ev.name}`, e);
    }
  }

  // 9 — award through sudo (AwardOrigin = Root)
  try {
    await chain.proposeAward(id, bidId, 'Highest weighted score, price within estimate.');
    await chain.approveAward(id);
    const t = await chain.getTender(id);
    log('9 award (sudo)', `state=${t?.state} awardee=${t?.award?.awardedBidder.slice(0, 8)}…`);
  } catch (e) {
    fail('award', e);
  }

  // 10 — execute after standstill
  const outcome = await api.query.tenderChain.outcomes(Number(id));
  const standstillEnd = Number((outcome as never as { unwrap(): { standstillEnd: unknown } }).unwrap().standstillEnd.toString());
  await waitFor(standstillEnd + 1, 'standstill end');
  try {
    await chain.executeAward(id, 'Contract 2026-001 executed.');
    log('10 executeAward', `state=${(await chain.getTender(id))?.state}`);
  } catch (e) {
    fail('executeAward', e);
  }

  const final = await chain.getTender(id);
  console.log(`\nPASS — tender ${id} reached ${final?.state}\n`);
  await api.disconnect();
  process.exit(0);
}

main().catch((e) => fail('unexpected', e));
