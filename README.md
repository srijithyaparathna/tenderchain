# TenderChain — Frontend

A demo/admin web frontend for a Substrate/Polkadot public tender & procurement pallet.
Built with React + TypeScript + Tailwind (v4), using mock chain data behind a clean
service interface so a real `@polkadot/api` integration can be dropped in later
without restructuring the UI.

## Running

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production build in dist/
```

The simulated chain clock advances ~1 block every 4 seconds so gate countdowns,
auto state-transitions (e.g. Published → Submission at `questionsCloseAt`) and
the header's live block indicator are visibly dynamic during a demo. The
"⏩ +50 blocks" button in the header fast-forwards the clock to skip ahead
through gates for demoing.

There's no wallet — use the account/role switcher in the header to simulate
connecting as a different account. Every gated action shows a disabled-state
tooltip explaining exactly why it's unavailable for the connected account.

## Architecture

```
src/
  types/            Domain types mirroring what a real pallet would expose
                     (Tender, Criterion, BidCommitment, RevealedBid, Challenge, …)
  data/seed.ts       Seed accounts + tenders covering every lifecycle state
  services/
    chainApi.ts      The ChainApi interface — the ONLY seam the UI talks to.
                      Swap `mockChainApi.ts` for a real @polkadot/api-backed
                      implementation (subscribe to storage, submit extrinsics,
                      decode events) without touching any component.
    mockChainApi.ts  In-memory implementation: block clock, auto state
                      transitions, all mutating actions (commit/reveal,
                      scoring, award, challenges, …).
  state/AppContext.tsx  Demo wallet (account/role switcher), live block number,
                         chain constants — provided via React context.
  hooks/useTenders.ts   Live-subscribed tender list / single tender.
  lib/               Small pure helpers: block→duration formatting, gate math,
                      score ranking/variance, permission checks, a mock
                      blake2_256 stand-in for commitment hashing, and the
                      localStorage-backed sealed-bid salt store.
  components/
    common/          StatusBadge, HashTag (truncate+copy+explain tooltip),
                      Stepper (lifecycle progress), Countdown, RoleGatedButton,
                      Card.
    layout/Header.tsx  Nav + live block indicator + account switcher.
    tender/           One focused panel per concern (criteria, gates, Q&A,
                      bidders, evaluators, scoring, award, challenges, bid
                      commit/reveal flow) — composed together on the detail
                      page and reused nowhere else, so each stays simple.
  pages/
    TenderListPage.tsx      Public marketplace, filterable.
    TenderDetailPage.tsx    Full lifecycle view + role-contextual actions.
    CreateTenderWizard.tsx  Multi-step tender creation with live constants
                             check and gate-ordering validation.
    EvaluatorDashboardPage.tsx  An evaluator's assigned tenders + status.
    PublicAuditPage.tsx     Read-only trail reconstruction, no wallet needed.
```

## Wiring up a real chain

1. Implement `ChainApi` (see `src/services/chainApi.ts`) against `@polkadot/api`:
   - reads become storage queries / subscriptions
   - actions become signed extrinsics, resolved once included/finalized
   - `getConstants()` reads the pallet's runtime constants
   - `approveAward` / the governance path should dispatch through the
     configured multisig or `sudo`/governed origin, not a plain signed call
2. Replace the `mockHash`-based commitment hashing in `src/lib/hashing.ts`
   with real `blake2AsHex` from `@polkadot/util-crypto`.
3. Swap the `import { chainApi } from './services/mockChainApi'` in
   `AppContext.tsx` / `hooks/useTenders.ts` for the real implementation.
4. Replace the demo account switcher in `Header.tsx` with the injected
   extension accounts (`web3Enable` / `web3Accounts`).

No other file needs to change — every page and component only ever talks to
the `ChainApi` interface and the `useApp()` / `useTenders()` hooks.
