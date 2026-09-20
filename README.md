# TenderChain

Public tender and procurement, end to end, on a Substrate chain — plus the web
portal that drives it.
f

| Half | Where | What it is |
|---|---|---|
| **The pallet** | `../../blockchain/pallets/tender-chain` | `pallet_tender_chain`, "Module 26". 21 extrinsics covering create → publish → bid → open → evaluate → award → challenge → contract. |
| **The portal** | this directory | React + TypeScript + Tailwind v4. A thin skin over `api.tx.tenderChain.*` — every button is one extrinsic. |

This README explains both and how they meet. For a click-by-click test script
against a running node, see **[TESTING.md](./TESTING.md)**. For the same
lifecycle driven from Polkadot.js Apps instead of this portal, see
`../../blockchain/docs/tenderchain-integration.md`.

---

## 1. What problem this solves

Public procurement fails in a small number of well-understood ways: criteria
quietly rewritten after bids are seen, bids leaked before opening, deadlines
that move because an official moved them, evaluation nobody can attribute,
awards with no window to contest them.

The interesting claim of this pallet is not that it records these steps. It is
that **the failures are structurally absent rather than forbidden by policy**:

- **Criteria are locked before any bid exists.** `publish_tender` stamps
  `published_at`, and from that block the criteria hash, the weights and the
  five gates are immutable — *there is no extrinsic that mutates them*.
  Retrofitting criteria to a favoured bidder is not against the rules; it is not
  in the API.
- **Sealed bids are sealed cryptographically, not by convention.** In
  `BidMode::Sealed` the chain holds only
  `blake2_256(bidder ‖ documents_hash ‖ prices ‖ salt)`. There is nothing
  readable to leak before the reveal window. The bidder's own account is inside
  the preimage, so one bidder cannot replay another's commitment as their own.
- **The chain closes the tender, not an official.** Every deadline is an entry
  in a `DeadlineWheel` processed in `on_initialize`. No officer holds the clock.
- **Evaluation is attributed.** Scores are keyed by evaluator, require a lodged
  conflict declaration first, and disagreement beyond a configured threshold
  auto-emits `ScoreVarianceFlagged` for probity review.
- **Awards are contestable.** An award opens a standstill window before it can
  be executed, and any participant can lodge a challenge that suspends
  execution until it is resolved.

Everything below is in service of those five properties.

---

## 2. The lifecycle

```
                    officer                  chain clock (on_initialize)
                       │                                │
   create_tender ──▶ Draft
                       │
   publish_tender ──▶ QaWindow ─────── questionsCloseAt ──▶ Submission
                       │                                        │
              ask/answer_question                    commit_bid / submit_open_bid
                       │                             withdraw_commitment
                       │                                        │
                       │                     submissionCloseAt ──▶ Closed
                       │                                        │
   open_tender ─────────────────────────────────────────────▶ Opening
                       │                                        │
                       │                              reveal_bid (bidders)
                       │                                        │
                       │                        openingEndAt ──▶ Evaluation
                       │                                        │
              appoint_evaluator                        submit_scores (evaluators)
              declare_conflict (evaluator)                       │
              activate_evaluator                                 │
                       │                                        │
   award  ◀── AwardOrigin (Root/governance) ─────────────▶ Awarded
                       │                                        │
              lodge_challenge (participant) ──────────▶ Challenged
              resolve_challenge ◀── ChallengeResolverOrigin
                       │                    upheld → back to Evaluation
                       │                  dismissed → back to Awarded
                       │                                        │
                       │                     standstill end ──▶ (executable)
   execute_award ──────────────────────────────────────────▶ Contracted
   cancel_tender ─────────────────────────────────────────▶ Cancelled
```

**Eleven states** (`types.rs:49`): `Draft`, `QaWindow`, `Submission`, `Closed`,
`Opening`, `Evaluation`, `Awarded`, `Shortlisted` (terminal state of an EOI),
`Challenged`, `Contracted`, `Cancelled`.

**Three of the transitions are nobody's call.** `QaWindow → Submission`,
`Submission → Closed` and `Opening → Evaluation` are fired by the deadline
wheel when the block arrives. In the portal you will see the status badge move
on its own with no button pressed; that is the point, not a bug.

**The five gates** are absolute block numbers set at creation, and validated in
order: `publishAt < questionsCloseAt < submissionCloseAt ≤ openingAt <
openingEndAt`. The last gap is additionally floored at `MinRevealWindow` so
bidders always get a real chance to reveal.

---

## 3. The pallet

### 3.1 Configuration

Bound in `runtime/src/configs/mod.rs`. The values that shape testing:

| Type | This runtime | Why it matters |
|---|---|---|
| `AwardOrigin` | `EnsureRoot` | `award` cannot be called by a signed officer. Stand-in for a Multisig/governance origin until Module 16 lands — the spec forbids a single key, and the pallet cannot enforce that on the runtime's behalf. |
| `ChallengeResolverOrigin` | `EnsureRoot` | Same, for `resolve_challenge`. |
| `Eligibility` | `()` | **No-op.** `is_eligible` returns `true` for everyone, so required credentials and minimum reputation are stored and displayed but never reject a bidder. Wiring Module 15 (Identity) is a one-line change. |
| `Delivery` | `()` | **No-op.** `execute_award` would hand off to Module 25 (Work Task); for now it emits and stops. |
| `Currency` | `Balances` | Bid bonds use `ReservableCurrency` directly instead of Module 8 (Escrow). Reserved at `commit_bid`, released on `execute_award` / `cancel_tender`, forfeited on withdrawal or non-reveal if the tender says so. |
| `MinEvaluators` | `3` | A panel, not a single scorer — ghost evaluation is defeated by attribution. |
| `MinRevealWindow` | `100` blocks (~10 min) | The one gap in the schedule that cannot be compressed. |
| `MaxScore` | `100` | Per-criterion ceiling. |
| `ScoreVarianceThreshold` | `30` | Pairwise spread between two evaluators on one criterion that auto-flags. |

Every collection is bounded (spec forbids unbounded storage): `MaxWeights` 20,
`MaxCredentials` 16, `MaxAddenda` 32, `MaxBidders` 128, `MaxEvaluators` 16,
`MaxQuestions` 256, `MaxChallenges` 32, `MaxPriceLines` 64,
`MaxDeadlinesPerBlock` 64, `MaxTransitionsPerBlock` 16.

### 3.2 Storage

| Item | Shape | Holds |
|---|---|---|
| `Tenders` | `TenderId → Tender` | The whole record: entity, officer, kind, bid mode, `notice_hash`, `criteria_hash`, weights, gates, standstill, eligibility, bond, state |
| `Questions` | `(TenderId, QuestionId) → Question` | Question hash, author (open or blinded), answer hash |
| `Addenda` | `TenderId → BoundedVec<..>` | Published clarifications; may extend the close block, never shorten it |
| `BidCommitments` | `(TenderId, AccountId) → Commitment` | The sealed `blake2_256` hash and the block it landed |
| `Participants` | `TenderId → count` | Participation is public pre-opening; contents are not |
| `Reveals` | `(TenderId, AccountId) → Reveal` | Documents hash, price lines, and a `valid` flag — an invalid reveal is kept, not discarded |
| `EvaluatorSet` | `(TenderId, AccountId) → EvaluatorRecord` | Appointed-at block, credential ref, conflict declaration, `active` flag |
| `ActiveEvaluatorCount` / `AppointedEvaluatorCount` | `TenderId → u32` | So `MinEvaluators` / `MaxEvaluators` are checked without iterating |
| `Scores` | `(TenderId, AccountId, AccountId) → ScoreSheet` | Keyed tender → bidder → **evaluator**. This is what makes evaluation attributed |
| `Outcomes` | `TenderId → Outcome` | Awardee, rationale hash, standstill end, contract hash |
| `Challenges` / `OpenChallengeCount` | `(TenderId, ChallengeId) → Challenge` | Grounds hash, state, resolution hash |
| `Shortlist` / `ShortlistSource` | EOI plumbing | Who an EOI shortlisted, and which EOI gates a follow-on RFT |
| `PanelPool` / `PanelTender` | Framework agreements | Admitted suppliers and the tender that established the panel |
| `DeadlineWheel` | `BlockNumber → BoundedVec<(TenderId, Gate)>` | The chain's own clock |

### 3.3 The 21 extrinsics, in full

Every call takes `origin` first; all are `ensure_signed` except `award` and
`resolve_challenge`, which go through their configured origin. "State" is the
tender state the call requires. Line numbers are into `lib.rs`.

---

#### Setting up a tender

**`create_tender`** · idx 0 · officer · state: *none (creates)* · L576

```rust
create_tender(
  entity: AccountId, kind: TenderKind, bid_mode: BidMode,
  notice_hash: Hash256, criteria_hash: Hash256, weights: Vec<CriterionWeight>,
  gates: TenderGates<BlockNumber>, standstill_period: BlockNumber,
  required_credentials: Vec<Hash256>, min_reputation: u32,
  bond: BondTerms<Balance>, blind_questions: bool,
  shortlist_from: Option<TenderId>,
)
```

The caller becomes the officer. Validates gate ordering (`GateOrderInvalid`),
that weights sum to exactly 100 (`WeightsInvalid`) and fit `MaxWeights`
(`TooManyWeights`), and that `shortlist_from` names a real EOI (`NotAnEoi`).
Lands in `Draft`; **nothing is locked yet**. Emits `TenderCreated`.

> **`BidMode::Open` is only legal on an `Rfq`** (`lib.rs:596`). Open bidding
> removes the pre-opening secrecy guarantee, so the pallet confines it to
> low-value quotes: an `Rft` or `Eoi` must be `Sealed` or `create_tender` fails
> with `OpenBidNotPermitted`. **The wizard does not check this client-side**, so
> the combination is selectable in the UI and only fails on submit.

*Why the hashes:* `notice_hash` and `criteria_hash` are commitments, not
content. The chain stores the proof that a specific notice and a specific set
of criteria existed at this block; the readable text lives off chain.

**`publish_tender`** · idx 1 · officer · state: `Draft` · L654

The hinge of the whole design. Stamps `published_at`, re-validates gate order,
moves to `QaWindow`, and schedules three `DeadlineWheel` entries —
`QuestionsClose`, `SubmissionClose`, `OpeningEnd`. From this block the criteria
hash, weights, gates, eligibility and bond terms are **immutable**: no
extrinsic in the pallet mutates them. Emits `TenderPublished`.

**`publish_addendum`** · idx 4 · officer · L761

`(content_hash: Hash256, extend_close_to: Option<BlockNumber>)`. A published
clarification. If `extend_close_to` is given it must be **later** than the
current close — `CloseCannotShorten` refuses the other direction, so the window
can never be quietly cut short once bidders are relying on it. A new
`SubmissionClose` wheel entry is scheduled; the stale one no-ops when it fires,
because `process_gate` re-checks the block. Bounded by `MaxAddenda`. Emits
`AddendumPublished`.

**`cancel_tender`** · idx 17 · officer · state: any except `Contracted` /
`Cancelled` · L1441

`(reason_hash: Hash256)`. Calls `release_all_bonds` — **cancellation never
forfeits**, because bidders should not be penalised for the entity's own
decision. Terminal. Emits `TenderCancelled`.

---

#### Questions

**`ask_question`** · idx 2 · anyone · state: `QaWindow` · L691

`(question_hash: Hash256, author_salt: Hash256)`. If the tender set
`blind_questions`, the author is stored as `blind_author(asker, salt)` =
`blake2_256(asker ‖ salt)` rather than the account. The asker keeps the salt and
can later reproduce the hash to prove authorship to a probity observer *without
publishing it to everyone* — which is why the salt is a parameter rather than
something the chain generates. Bounded by `MaxQuestions`. Emits `QuestionAsked`.

**`answer_question`** · idx 3 · officer · L736

`(question_id: QuestionId, answer_hash: Hash256)`. Anchors the answer against
the question. Emits `QuestionAnswered`.

---

#### Bidding

Both entry points share **`ensure_can_submit`** (L1568), which is where most of
the real gatekeeping lives:

- state is `QaWindow` **or** `Submission` (`TenderNotPublished`) — note bidding
  is legal during the Q&A window, earlier than the portal's UI allows
- the block is still before `submission_close_at` (`SubmissionClosed`) — belt
  and braces alongside the wheel, so a gate that has not yet been processed
  cannot be exploited
- no existing commitment from this bidder (`CommitmentExists`)
- the bidder is not on the evaluator panel (`EvaluatorIsBidder`)
- if this is a follow-on RFT, the bidder is on the source EOI's shortlist
  (`NotShortlisted`)
- `T::Eligibility::is_eligible(...)` (`NotEligible`) — a no-op on this runtime

Then **`record_submission`** (L1606) registers participation, reserves the bond
via `Currency::reserve`, and stores the commitment.

**`commit_bid`** · idx 5 · bidder · L834

`(commitment_hash: Hash256)`. Sealed mode only (`WrongBidMode`). The chain
stores *only* the hash. Emits `BidCommitted`.

**`submit_open_bid`** · idx 20 · bidder · L857

`(documents_hash: Hash256, price_schedule: Vec<PriceLine<Balance>>)`. Open mode
only (`WrongBidMode`). Content is public immediately — it writes both a
commitment and a valid `Reveal` in one step, so there is nothing to reveal
later. Bounded by `MaxPriceLines`.

**`withdraw_commitment`** · idx 6 · bidder · L900

Before `submission_close_at` (`SubmissionClosed`), requires an existing
commitment (`CommitmentNotFound`). Forfeits the bond if the tender set
`forfeit_on_withdrawal`, otherwise unreserves it. Emits `CommitmentWithdrawn`
and `BondForfeited` / `BondReturned`.

**`open_tender`** · idx 7 · officer · state: `Closed` · L934

Starts the reveal window and moves to `Opening`. Refuses with
`RevealWindowTooShort` if fewer than `MinRevealWindow` blocks remain between now
and `opening_end_at` — the guarantee that bidders always get a real chance to
reveal, and the one gap in the schedule that cannot be compressed. Emits
`OpeningStarted { participants }`.

**`reveal_bid`** · idx 8 · bidder · state: `Opening` · L962

`(documents_hash: Hash256, price_schedule: Vec<PriceLine>, salt: Hash256)`.
Sealed mode only. Requires a commitment (`CommitmentNotFound`), not already
revealed (`AlreadyRevealed`), inside the window (`RevealWindowClosed`).

**This call returns `Ok` even when the hash does not match.** It recomputes
`compute_commitment(bidder, documents_hash, price_schedule, salt)` and stores
the reveal with `valid: false` on a mismatch, emitting `RevealMismatch` instead
of `BidRevealed { valid: true }`. A void bid stays on the public record as
evidence rather than disappearing — which is why the portal shows it as a
disqualified bid and not a failed transaction.

---

#### Evaluation

**`appoint_evaluator`** · idx 9 · officer · L1016

`(evaluator: AccountId, credential_ref: Hash256)`. Refuses an account holding a
bid commitment (`EvaluatorIsBidder`) or the tender's officer/entity
(`OfficerCannotEvaluate`) — spec §1.2 separation, enforced regardless of what
any conflict declaration says. Bounded by `MaxEvaluators`. Re-appointing someone
already on the panel **refreshes their record**: it clears their conflict
declaration, deactivates them and decrements the active count, so they must
declare again. Emits `EvaluatorAppointed`.

Note there is **no state gate** — the pallet will appoint at any point in the
lifecycle. The portal's UI is stricter (TESTING.md §6.1).

**`declare_conflict`** · idx 10 · evaluator · L1075

`(declaration_hash: Hash256)`. Must already be on the panel (`NotEvaluator`).
Records the declaration hash — a declaration of *no* conflict is still a
declaration, and there is no path to scoring without one on record. Emits
`ConflictDeclared`.

**`activate_evaluator`** · idx 11 · officer · L1095

`(evaluator: AccountId)`. Grants scoring rights, refusing without a lodged
declaration (`ConflictNotDeclared`). Increments `ActiveEvaluatorCount`, which is
what `award` checks against `MinEvaluators`. Idempotent. Emits
`EvaluatorActivated`.

**`submit_scores`** · idx 12 · evaluator · state: `Evaluation` · L1126

`(bidder: AccountId, scores: Vec<CriterionScore>, comment_hash: Hash256)`.
Requires the evaluator be `active` (`ConflictNotDeclared`), the target have a
**valid** reveal (`InvalidAwardee`), one score per criterion
(`CriteriaMismatch`), each within `MaxScore` (`ScoreOutOfRange`), and each
`criterion_id` to match a locked weight.

Stored at `Scores[(tender, bidder, evaluator)]` — keyed by evaluator, which is
what makes evaluation attributed rather than anonymous. Re-submitting
overwrites. After writing, it compares against every other evaluator's sheet for
the same bidder and emits `ScoreVarianceFlagged { criterion_id, spread }` for
any pair differing by more than `ScoreVarianceThreshold`. Emits
`ScoresSubmitted`.

---

#### Award, challenge, contract

**`award`** · idx 13 · **`AwardOrigin`** (Root here) · state: `Evaluation` · L1206

`(awardees: Vec<AccountId>, rationale_hash: Hash256)`. Requires at least
`MinEvaluators` *activated* evaluators (`TooFewEvaluators`), at least one valid
bid (`NoValidBids`), and each awardee to hold a valid reveal (`InvalidAwardee`).
Writes the `Outcome` with `standstill_end = now + standstill_period`, schedules
a `StandstillEnd` wheel entry, moves to `Awarded`. Emits `Awarded` and
`StandstillOpened { standstill_end }`.

*Why a governed origin:* an award is the moment public money is committed. The
spec forbids that being a single key; `EnsureRoot` is the stand-in until a
Multisig origin exists.

**`lodge_challenge`** · idx 14 · participant · L1284

`(grounds_hash: Hash256)`. Only an account that actually bid on this tender
(`NotAParticipant`), and only before the standstill ends
(`StandstillExpired`). Moves the tender to `Challenged` and increments
`OpenChallengeCount`, which blocks `execute_award`. Bounded by `MaxChallenges`.
Emits `ChallengeLodged`.

**`resolve_challenge`** · idx 15 · **`ChallengeResolverOrigin`** (Root) · L1341

`(challenge_id: ChallengeId, uphold: bool, resolution_hash: Hash256)`. The
challenge must be `Open` (`ChallengeNotFound`).

- **Upheld** → the tender is remitted to `Evaluation` for re-scoring. The
  `Outcomes` record is **left in place**, so the superseded award is still
  readable until a new one replaces it.
- **Dismissed** → once the last open challenge clears, back to `Awarded`.

Emits `ChallengeResolved { state }`.

**`execute_award`** · idx 16 · officer · state: `Awarded` · L1394

`(contract_hash: Hash256)`. Requires the standstill to have passed
(`StandstillActive`) and no open challenge (`ChallengeOpen`). Notarises the
contract hash, calls `release_all_bonds`, hands off to `T::Delivery` (a no-op
here), and moves to `Contracted`. Emits `ContractExecuted` and
`DeliveryInstantiated`.

---

#### Multi-stage and frameworks

**`publish_shortlist`** · idx 19 · officer · state: `Evaluation` · L1473

`(suppliers: Vec<AccountId>)`. EOI tenders only (`NotAnEoi`). Every supplier
must be a participant (`InvalidShortlistEntry`); bounded by `MaxBidders`. Moves
to `Shortlisted`, the terminal EOI state — a follow-on RFT created with
`shortlist_from: Some(this)` then admits only these accounts. Emits
`ShortlistPublished`.

**`call_off`** · idx 18 · panel tender's officer · L1520

`(panel_id: PanelId, supplier: AccountId, order_hash: Hash256)`. Places an order
against an established framework panel; the supplier must be admitted
(`NotPanelMember`) and the caller must be the officer of the tender that
established the panel (`NotPanelTender`). Emits `CallOffPlaced`.

### 3.3.1 The machinery behind the calls

The parts that are not extrinsics but do most of the structural work:

| Function | L | What it does |
|---|---|---|
| `on_initialize` | 533 | Takes this block's `DeadlineWheel` entries and processes up to `MaxTransitionsPerBlock`. Anything over budget is **deferred to the next block** rather than doing unbounded work — the chain never stalls on a busy deadline. |
| `process_gate` | 1676 | Applies one transition. Returns immediately for a `Cancelled`/`Contracted` tender, and re-checks the block so an entry made stale by an addendum simply no-ops. |
| `schedule` | 1664 | Pushes a `(tender_id, gate)` onto the wheel at a block. `DeadlineWheelFull` if that block is saturated. |
| `compute_commitment` | 1551 | `blake2_256(SCALE(bidder) ‖ documents_hash ‖ SCALE(price_schedule) ‖ salt)`. **`pub`** so a bidder can reproduce it off chain before committing — which is exactly what the portal's `chainCodec.ts` does. Binding the bidder into the preimage is what stops one bidder replaying another's commitment. |
| `blind_author` | 1641 | `blake2_256(asker ‖ salt)`. Also `pub`, so an asker can prove authorship selectively. |
| `ensure_can_submit` | 1568 | The shared bid gate described above. |
| `record_submission` | 1606 | Registers participation, reserves the bond, stores the commitment. |
| `compute_ranking` | 1810 | Weighted ranking over averaged per-criterion scores, best first. **Excludes voided and non-revealed bids.** Works on a `0 ..= MaxScore * 100` scale so percent weights are never divided out and integer division discards no precision. |
| `settle_non_reveals` | 1744 | On the `OpeningEnd` gate, if the tender set `forfeit_on_non_reveal`, forfeits the bond of every bidder who committed but never revealed. |
| `release_all_bonds` | 1767 | Unreserves every bond on the tender. Called by `execute_award` and `cancel_tender`. |
| `forfeit_bond` | 1788 | Slashes a reserved bond and emits `BondForfeited`. |
| `ensure_officer` | 1659 | `NotOfficer` unless the caller created the tender. |
| `ensure_gate_order` | 1648 | `publishAt < questionsCloseAt < submissionCloseAt ≤ openingAt < openingEndAt`, else `GateOrderInvalid`. |

### 3.4 Events and errors

31 events. The ones worth watching: `TenderPublished` (the lock point),
`BidCommitted`, `OpeningStarted`, `BidRevealed { valid }`, `RevealMismatch`,
`ScoresSubmitted`, `ScoreVarianceFlagged { criterion_id, spread }`, `Awarded`,
`StandstillOpened { standstill_end }`, `ChallengeLodged`, `ChallengeResolved`,
`ContractExecuted`, `BondReturned` / `BondForfeited`, `TenderCancelled`.

The audit page reconstructs a full timeline from these alone, with no
privileged access.

47 errors. `TESTING.md` §8 covers the ones you will actually hit; the rest are
bound-exceeded guards (`TooMany…`) and state gates (`BadState`, `NotOfficer`,
`WrongBidMode`, `NotShortlisted`, `NoValidBids`, …).

---

## 4. The portal

### 4.1 Running

```bash
npm install
npm run dev      # http://localhost:5173 — proxies /ws to the node on 9955
npm run build    # production build in dist/
npm run deploy   # build + rsync to /var/www/tenderchain (what nginx serves)
npm run lint     # oxlint
```

You need a node running. See **[TESTING.md](./TESTING.md) §2** for the full
two-terminal setup, ports, and which URL to open.

```bash
cd ../../blockchain
./target/release/solochain-template-node --dev \
  --rpc-port 9955 --port 30343 --rpc-external --rpc-cors all
```

To look at the UI with **no node at all**, `VITE_CHAIN_MODE=mock npm run dev`
runs a fully simulated in-browser chain — nothing you do there touches real
storage.

### 4.2 Architecture

```
src/
  types/index.ts        Domain types + ChainConstants
  services/
    chainApi.ts         The ChainApi interface — the ONLY seam the UI talks to
    api.ts              Picks the implementation. VITE_CHAIN_MODE=mock → MockChainApi,
                         otherwise LiveChainApi. Every page imports `chainApi` from here
                         and never names an implementation.
    liveChainApi.ts     Real node. Reads api.query.tenderChain.*, writes api.tx.tenderChain.*
    mockChainApi.ts     In-browser simulation: block clock, auto transitions, all actions
    chainConnection.ts  One shared socket. Resolves /ws on the page's own origin;
                         VITE_WS_ENDPOINT overrides. Retries, so node-start order is free
    chainSigner.ts      signAndSend; decodes ExtrinsicFailed into a named pallet error,
                         and unwraps sudo.Sudid so a failed inner call is not a false success
    chainCodec.ts       Enum translation + computeCommitment() — the real sealed-bid hash
    contentStore.ts     Off-chain content, keyed by the hash that goes on chain
    accounts.ts         The --dev keyring, or injected polkadot{.js} extension accounts
  lib/
    blocks.ts           block → human duration
    gates.ts            next-gate lookup, weight sum
    scoring.ts          weighted ranking + per-criterion std dev (client-side)
    permissions.ts      Disabled-reason strings for gated buttons
    hashing.ts          blake2-256, 32-byte salts, hash coercion
    localBidStore.ts    Sealed-bid salts — losing these forfeits the bond
    status.ts           Chain state → display status
  state/AppContext.tsx  Selected account + role lens, live block, constants, connection
  hooks/useTenders.ts   Live-subscribed tender list / single tender
  components/
    common/             StatusBadge, HashTag, Stepper, Countdown, RoleGatedButton, Card
    layout/Header.tsx   Nav, block chip, account + role switchers, ⛽ Fund dev accounts
    tender/             One panel per concern — criteria, gates, Q&A, bidders, evaluators,
                         scoring, award, challenges, bid commit/reveal
  pages/
    TenderListPage.tsx          Marketplace, client-side filters
    TenderDetailPage.tsx        Full lifecycle + role-contextual action panels
    CreateTenderWizard.tsx      5-step creation, live constants check, gate validation
    EvaluatorDashboardPage.tsx  An evaluator's assigned tenders
    PublicAuditPage.tsx         Read-only trail reconstruction, no wallet needed
```

### 4.3 The four things to understand before reading the code

**(a) The chain stores hashes, not text.** `create_tender`'s `notice_hash` is a
`[u8;32]` blake2-256 commitment, not the title you typed. `contentStore.ts`
keeps the real text in **this browser's `localStorage`**, keyed by its hash, and
sends only the hash. A page renders text by looking the hash back up locally.

Consequence: open the same tender in a different browser and you get correct
state, correct gates, correct amounts — and *placeholder* text like
`Tender #3` or `Criterion 0`. **That is the pallet working correctly.** The
chain never had the text; it only ever had proof that some specific text
existed. In production this layer is a DNC/IPFS store; for testing it is
`localStorage`. The same applies to Q&A, challenge grounds, resolution
rationale, score comments and award rationale — anything typed `Hash256` in
`types.rs`.

**(b) The commitment is real cryptography.** `chainCodec.ts`'s
`computeCommitment()` reproduces `Pallet::compute_commitment` exactly:
`blake2_256(SCALE(bidder) ‖ documents_hash ‖ SCALE(Vec<PriceLine>) ‖ salt)`.
The bid panel recomputes it live as you type, so the hash on screen before you
click **Commit bid** is the literal value that goes on chain. Lose the salt
(`localBidStore.ts`) and the bid cannot be revealed — and if the tender set
`forfeit_on_non_reveal`, the deadline wheel forfeits your bond when the opening
window closes (`lib.rs:1745`). The warning banner on that screen is not
decorative.

**(c) Governed calls are sudo-wrapped automatically.** `award` and
`resolve_challenge` are `EnsureRoot`. A plain signed call from *any* account —
including Alice, the `--dev` sudo key — fails `BadOrigin`. So **Approve award**,
**Dismiss** and **Uphold** wrap the call in `api.tx.sudo.sudo(...)` themselves,
signed by whoever holds `sudo.key()`, regardless of which account the dropdown
shows. `chainSigner.ts` then inspects the inner `sudo.Sudid` result, so a
wrapped call that fails with e.g. `TooFewEvaluators` surfaces that real error
instead of a false success.

**(d) Roles are a UI lens, not chain state.** The pallet has no role registry.
An account is an officer because it created a tender, an evaluator because it
was appointed. The header's role dropdown only decides which panels render —
and it rewrites only the *currently selected* account, never the shared account
list, which is why the officer's Appoint dropdown is unaffected by it. Action
panels **hide** rather than grey out, so "the button isn't there" almost always
means wrong role or wrong account. See TESTING.md §6.

### 4.4 One action, end to end

Committing a sealed bid, all the way down:

1. `BidActionPanel` collects documents label, price lines and a salt
   (**Generate** → `randomSalt()`), and stores the salt in `localBidStore`.
2. `chainCodec.computeCommitment()` hashes the SCALE-encoded preimage; the
   panel renders the result live.
3. **Commit bid** → `chainApi.commitBid(id, bidder, hash)`.
4. `api.ts` has already resolved `chainApi` to `LiveChainApi`, which calls
   `api.tx.tenderChain.commitBid(Number(id), commitmentHash)`.
5. `chainSigner.submit()` signs with the dev pair or the extension, waits for
   inclusion, and decodes any `ExtrinsicFailed` into a named pallet error.
6. `LiveChainApi.refresh()` re-reads storage and pushes the new tender list to
   every subscriber; `useTenders` re-renders the page.
7. The chain now holds a 32-byte hash and a reserved bond. It has no idea what
   you bid.

---

## 5. Known gaps

Honest list, all verified against the source:

| Gap | Detail |
|---|---|
| `publish_addendum` | No UI and no `ChainApi` method — "addendum" does not appear in `src/` at all. |
| `call_off` | Framework-agreement call-offs are unimplemented in the frontend. |
| `publish_shortlist` | `LiveChainApi.publishShortlist()` exists but **no component calls it**, so there is no button. Drive it from Polkadot.js Apps. |
| Kind/mode validation | The create wizard lets you pick `Open` bid mode on an `Rft` or `Eoi`, which the pallet rejects with `OpenBidNotPermitted`. There is no client-side guard, so it fails on submit rather than on the Basics step. |
| Documents panel | Always empty on a live chain. The pallet has no document-registry storage item; document hashes travel embedded in `notice_hash` / `documents_hash`. The panel is wired for the mock chain's richer `documents[]`. |
| `OfficerCannotEvaluate` | Not reachable from the portal — the Appoint dropdown is built from accounts whose stored role is `Evaluator`, so the officer never appears in it. |
| Eligibility | `type Eligibility = ()` — credentials and reputation are recorded but never enforced. |
| Delivery handoff | `type Delivery = ()` — `execute_award` stops at the contract hash. |
| Variance signal | The portal's ⚠ is a client-side **standard deviation > 15**; the chain's `ScoreVarianceFlagged` is a **pairwise spread > 30** and is not surfaced in the UI. |
| Award authority | `EnsureRoot` is a stand-in. Production requires a Multisig/governance origin — repoint `AwardOrigin` and `ChallengeResolverOrigin`. |

---

## 6. Where to go next

- **[TESTING.md](./TESTING.md)** — running the node and portal, a tour of every
  panel, a role-by-role action reference, and eight worked example tenders from
  a plain RFQ through competitive evaluation, failed reveals and challenges.
- **`../../blockchain/docs/tenderchain-integration.md`** — the same lifecycle
  driven from Polkadot.js Apps, for when you need a call the portal has no
  button for.
- **`../../blockchain/pallets/tender-chain/src/lib.rs`** — the pallet itself.
  The module-level doc comment is the short version of §1 above.
