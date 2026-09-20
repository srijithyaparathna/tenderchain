# Testing the TenderChain frontend against a real node

This is the click-by-click companion to the pallet's own testing guide
(`blockchain/docs/tenderchain-integration.md`), but through this portal
instead of Polkadot.js Apps. Every button below calls the exact same
extrinsic the pallet guide names — the portal is a thin skin over
`api.tx.tenderChain.*`.

**Contents**

1. [How this actually works](#1-how-this-actually-works) — the pieces, and where content vs. hashes live
2. [Running the node and the frontend](#2-running-the-node-and-the-frontend) — terminals, ports, what to check
3. [The golden rules](#3-the-golden-rules-same-ones-the-pallet-guide-gives-still-true-here)
4. [Chain constants](#4-chain-constants-on-this-deployment)
5. [A tour of every page and panel](#5-a-tour-of-every-page-and-panel) — what each one is for, and which pallet call it drives
6. [Role by role](#6-role-by-role--every-action-each-account-can-take) — everything an officer, bidder, evaluator and governance account can do
7. [Eight example tenders, start to finish](#7-eight-example-tenders)
8. [Errors you'll likely see](#8-errors-youll-likely-see-and-what-they-mean-here)
9. [Resetting between test runs](#9-resetting-between-test-runs)

---

## 1. How this actually works

```
 Browser                                          Node (--dev)
┌────────────────────────────────────┐            ┌───────────────────┐
│  React pages/panels                 │            │                    │
│    ↓ calls chainApi.xxx()           │  api.tx    │  pallet_tender_    │
│  services/api.ts  ──────────────────┼───────────▶│  chain             │
│    picks LiveChainApi or            │  api.query │                    │
│    MockChainApi                     │◀───────────┼────────────────────│
│                                      │  /ws (nginx│                    │
│  services/liveChainApi.ts           │  or vite   │  storage:          │
│   - reads: api.query.tenderChain.*  │  dev proxy)│   Tenders, Reveals,│
│   - writes: api.tx.tenderChain.*    │            │   Scores, Outcomes,│
│                                      │            │   Challenges, …    │
│  services/chainCodec.ts             │            │                    │
│   - enum + hash translation         │            └───────────────────┘
│   - the sealed-bid commitment       │
│     (blake2_256, SCALE-encoded)     │
│                                      │
│  services/chainSigner.ts            │
│   - signAndSend, decodes            │
│     ExtrinsicFailed / sudo.Sudid    │
│                                      │
│  services/accounts.ts               │
│   - --dev keyring, or the           │
│     polkadot{.js} extension         │
│                                      │
│  services/contentStore.ts           │
│   - title/summary/question text     │
│     kept in localStorage, anchored  │
│     on chain only by their hash     │
└──────────────────────────────────────┘
```

**Two implementations behind one interface.** Every page talks only to
`chainApi` (from `src/services/api.ts`), which is typed as `ChainApi`
(`src/services/chainApi.ts`). By default that's `LiveChainApi` — real reads
and writes against your node. Set `VITE_CHAIN_MODE=mock` (an env var, or
`.env.local`) to fall back to `MockChainApi`, a fully simulated in-browser
chain with no node required — useful for a quick UI look without any
blockchain running at all, but nothing you do there touches real storage.

**The pallet stores hashes, not text — this is the single most important
thing to understand before testing.** `createTender`'s `notice_hash` is a
`[u8;32]` blake2-256 commitment, not the title/summary you typed. So:

- When you create a tender, the portal (`contentStore.ts`) saves the actual
  title/summary/entity text into **this browser's `localStorage`**, keyed by
  its hash, and sends only the hash on chain.
- When a page displays a tender, it looks the hash up in that same local
  store. If it finds the text, you see it. If it doesn't — because you're on
  a different browser, a different machine, or you cleared storage — you see
  a placeholder like `Tender #3` or `Notice anchored at 0xabc123…def — content
  not held in this browser`, **and that is the pallet working correctly**,
  not a bug. The chain itself never had the text; it only ever had the proof
  that some specific text existed.
- The same applies to Q&A text, challenge grounds, resolution rationale,
  score comments, and award rationale — anything the pallet types as
  `Hash256` in `pallets/tender-chain/src/types.rs`.
- Practical consequence for testing: **do your whole test run in one browser
  tab**, or accept that a second browser will show you real state (correct
  status, correct block gates, correct amounts) with placeholder text where
  the pallet only ever committed a hash.

**The sealed-bid commitment is real cryptography, not a demo stand-in.**
`chainCodec.ts`'s `computeCommitment()` reproduces
`Pallet::compute_commitment` exactly:
`blake2_256(SCALE(bidder) ‖ documents_hash ‖ SCALE(Vec<PriceLine>) ‖ salt)`.
The Bid panel calls this live as you type, so the commitment hash you see
before clicking **Commit bid** is the literal value that goes on chain.

**Governed calls go through `sudo` automatically.** `award` and
`resolveChallenge` are bound to `AwardOrigin`/`ChallengeResolverOrigin` in
`runtime/src/configs/mod.rs`, both `EnsureRoot`. A plain signed call from any
account — even Alice, the `--dev` sudo key — fails `BadOrigin`. The portal's
**Approve award**, **Dismiss challenge** and **Uphold challenge** buttons
wrap the call in `api.tx.sudo.sudo(...)` themselves (`chainSigner.ts`), using
whichever account currently holds `sudo.key()` — so you don't have to
reproduce the pallet guide's separate "Developer → Sudo page" step.
`chainSigner.ts` also checks the *inner* `sudo.Sudid` result, not just
whether the sudo wrapper itself landed — so if the wrapped `award` call fails
with e.g. `TooFewEvaluators`, the portal surfaces that real error rather than
a false "success".

## 2. Running the node and the frontend

Two processes have to be up: the **node**, which is the chain, and something
**serving the frontend**. They are independent — the portal reconnects on its
own, so it does not matter which you start first, and restarting one does not
require restarting the other.

### Terminal 1 — the node

This one stays open. You run it yourself; nothing in the portal starts or stops
the chain.

```bash
cd ~/tenderchain/blockchain
./target/release/solochain-template-node --dev \
  --rpc-port 9955 --port 30343 --rpc-external --rpc-cors all
```

You should see a block sealed every ~6s:

```
✨ Imported #42 (0x7a3c…9f1b)
💤 Idle (0 peers), best: #42 (0x7a3c…9f1b), finalized #39 (0x2e08…4c7d)
```

Leave it running for the whole test session. `Ctrl+C` stops it.

- `--dev` means a **fresh chain on every start** — block height back to 0, all
  tenders gone. There is no `--base-path`, so nothing persists. See §9.
- `--rpc-port 9955` is the port everything else in this guide points at. It is
  deliberately not 9944, which the unrelated FastLane node on this machine uses.
- If `target/release/solochain-template-node` does not exist, build it first
  with `cargo build --release` in `~/tenderchain/blockchain`. That takes a
  while; it is a one-off.

### Terminal 2 — the frontend

Two ways to serve it. They differ in **where you open the portal**, which is the
part worth getting straight before anything else:

| | Command | Open at | Reachable from |
|---|---|---|---|
| **Option A** — vite dev server | `npm run dev` | `http://localhost:5173` | this machine only |
| **Option B** — nginx deploy | `npm run deploy` | `http://136.113.216.174/` | anywhere, incl. your laptop |

---

#### Option A — vite dev server

Use this while you are changing frontend code.

```bash
cd ~/tenderchain/frontend/tenderchain
npm install      # first time only
npm run dev
```

```
  VITE ready in 412 ms
  ➜  Local:   http://localhost:5173/
```

Open **http://localhost:5173** — and note it is **localhost-only**: a browser on
your laptop cannot reach it, because vite binds to the loopback interface. This
terminal stays open, and edits to `src/` hot-reload with no rebuild and no
deploy step.

To reach it from another machine anyway, bind it to all interfaces:

```bash
npm run dev -- --host       # then http://136.113.216.174:5173/
```

That needs TCP 5173 opened in the GCP firewall as well, which is usually more
bother than just using Option B.

#### Option B — nginx deploy

Use this when you just want to click through a tender, or when you are browsing
from your own laptop rather than the instance.

```bash
cd ~/tenderchain/frontend/tenderchain
npm run deploy   # builds, then rsyncs dist/ to /var/www/tenderchain (asks for sudo)
```

Then open, from anywhere:

```
http://136.113.216.174/
```

That is this instance's **external IP**. Plain HTTP on port 80, no port number
in the URL, no `https://` (there is no certificate on this site — if the browser
jumps to HTTPS, type the `http://` prefix explicitly). From the instance itself
`http://localhost/` works just as well, and needs no firewall rule at all.

Reaching it from your laptop assumes TCP 80 is allowed to this instance in the
GCP firewall. If the page times out from outside but `curl http://localhost/` on
the instance returns HTML, that is the firewall, not nginx and not this app.

The nginx site is `listen 80 default_server; server_name _;`, so the raw IP hits
the TenderChain portal — you do not need a hostname. `/ws` on that same origin is
proxied to the node on 9955 by the same server block, so the chain connection
comes along for free.

This command builds, copies and exits, so it does not hold a terminal open: with
Option B you only need Terminal 1.

**If the IP has changed** — it is an ephemeral external address and a stop/start
of the instance reassigns it — read the current one back from the metadata
server:

```bash
curl -s -H "Metadata-Flavor: Google" \
  http://169.254.169.254/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip
```

> **The one trap with Option B.** nginx serves `/var/www/tenderchain`, *not* this
> project's `dist/`. `npm run build` on its own copies nothing and changes
> nothing in the browser — you must run `npm run deploy`. Then hard-reload the
> tab (**Ctrl+Shift+R**), because `/assets/` is served
> `Cache-Control: immutable` for a year.
>
> A stale deploy is the first thing to rule out whenever the portal behaves like
> an older version of itself. Criteria showing as `Criterion 0 / 1 / 2` instead
> of the names you typed, for instance, is exactly what a build from before the
> local content store looks like.
>
> Quick check that what is deployed is what you built — the two hashed filenames
> should match:
>
> ```bash
> ls /var/www/tenderchain/assets/            # what the browser gets
> ls ~/tenderchain/frontend/tenderchain/dist/assets/   # what you last built
> ```

### So do I need two terminals?

| | Terminal 1 | Terminal 2 | You open |
|---|---|---|---|
| **Option A** (`npm run dev`) | node — stays open | vite — stays open | `http://localhost:5173` |
| **Option B** (`npm run deploy`) | node — stays open | not needed; deploy exits | `http://136.113.216.174/` |

Either way the node needs a terminal of its own. Only the dev server needs a
second one.

### Ports, and how the browser reaches the node

The portal never connects to the node's port directly. It asks for `/ws` on
**its own origin**, and whatever is serving the page proxies that through — vite
in Option A (`vite.config.ts`), nginx in Option B
(`/etc/nginx/sites-available/tenderchain`). That is why the node's port is not
baked into the bundle and does not need opening in the firewall.

| Port | What | Bound to |
|---|---|---|
| 80 | nginx serving `/var/www/tenderchain` — **Option B** | all interfaces, so `http://136.113.216.174/` works |
| 5173 | vite dev server — **Option A** | loopback only, so `http://localhost:5173` only |
| 9955 | node RPC / WebSocket — the `/ws` proxy target in both options | never opened to the browser directly |
| 30343 | node p2p | — |

`VITE_WS_ENDPOINT` overrides the `/ws` default if you ever want to point the
portal straight at a node, e.g. `VITE_WS_ENDPOINT=ws://127.0.0.1:9955 npm run dev`.

### Check it's wired up

Open the portal — `http://localhost:5173` for Option A, `http://136.113.216.174/`
for Option B — and look at the header, top-right. A **green dot with a block
number ticking up every ~6s** means both halves are talking.

| What you see | What it means |
|---|---|
| Green dot, number climbing | Both up. Go to §3. |
| **"Node offline"** (red) | The page loaded, so the frontend is fine, but `/ws` did not reach the node. Check Terminal 1 is still running and on `--rpc-port 9955`. |
| Page doesn't load at all | The frontend is not being served. Option A: is `npm run dev` still running? Option B: `systemctl is-active nginx`, and did you ever run `npm run deploy`? |
| Loads, but looks like an older version | Stale Option B deploy — see the trap above. |

No node at all and you just want to look at the UI? `VITE_CHAIN_MODE=mock npm run
dev` runs the fully simulated in-browser chain from §1 — but nothing you do there
touches real storage.

### Shutting down

`Ctrl+C` in each terminal. Nothing needs cleaning up: `--dev` state is in memory
and the deployed files are static.

---

### The rest of the header

- The **account dropdown** picks which address signs. The **role dropdown**
  next to it is a lens you choose — the pallet has no role registry; an
  account is only an "officer" because it created the tender, an "evaluator"
  because it was appointed. Dev accounts default to:

  | Account | Default role | Signs for |
  |---|---|---|
  | Alice | Officer | `createTender`, `publishTender`, `openTender`, `appointEvaluator`, `activateEvaluator`, `executeAward`, `cancelTender`, `answerQuestion` |
  | Bob | Bidder | `commitBid`/`submitOpenBid`, `revealBid`, `withdrawCommitment`, `lodgeChallenge` |
  | Charlie, Dave, Eve | Evaluator | `declareConflict`, `submitScores` |
  | Ferdie | Governance | shown for the propose/approve award UI — the actual dispatch is sudo-wrapped automatically, see below |

  This matches the pallet's own separation rule: an evaluator can't also be
  the officer or a bidder on the same tender.

- **⛽ Fund dev accounts** (only shown once, when connected to a `--dev`
  chain): `--dev` only endows Alice and Bob at genesis. Click this once per
  fresh chain — it tops up Charlie, Dave, Eve and Ferdie from the sudo key so
  they can pay fees. Skip it and every call from those accounts fails with
  `1010: Inability to pay some fees`.

- **award and resolveChallenge are Root-only** (`AwardOrigin` /
  `ChallengeResolverOrigin`). The portal's "Approve award" and challenge
  resolution buttons submit through `sudo.sudo(...)` automatically using the
  chain's sudo key (Alice on `--dev`) — you don't need a separate Sudo page.

## 3. The golden rules (same ones the pallet guide gives, still true here)

1. **Gates are absolute block numbers, not offsets** — but you no longer have
   to do that arithmetic. The wizard's Gates step ships a ~15-minute test
   schedule that **re-derives itself from the live head on every new block**,
   so it is still correct however long you spend on the earlier steps. You
   only need to read the block yourself if you pin your own numbers.
2. **Leave the Gates step alone for a fast run.** The default schedule is
   publish in 2 blocks, Q&A closes in 12, submission closes and opening starts
   at 30, the reveal window is `MinRevealWindow + 5` blocks wide (the one gap
   that can't be compressed), and standstill is 10 — **145 blocks ≈ 14m30s**
   from creation to *Contracted*. The panel shows that total live. Typing in
   any gate field **pins** the schedule to your numbers and stops it tracking;
   a **↺ Back to the 15-minute test gates** button appears to undo that.
3. **Check the account dropdown before every click**, not just the form
   fields. It doesn't reset between actions and doesn't warn you before
   signing with the wrong role — you'll only find out after, as a
   `NotOfficer` or similar error in a red toast/alert.
4. **`MinEvaluators` is 3 on this chain, and you must appoint them early.**
   Appoint and declare-conflict for three separate accounts (Charlie, Dave,
   Eve) — the award will fail with `TooFewEvaluators` after only one or two.
   The Appoint control is only on screen while the tender is in `Draft`,
   `Published` or `Submission`, so do it right after Publish, not later (§6.1).
5. **A "successful" reveal isn't necessarily a valid one.** `revealBid`
   returns `Ok` even on a hash mismatch — the portal shows this as a
   disqualified bid (`RevealMismatch`) rather than a transaction failure.
   Content is stored in *your browser's* localStorage — a tender opened in a
   different browser shows placeholder hashes instead of real text, because
   only the hash is ever on chain.

## 4. Chain constants on this deployment

Visible on the wizard's right-hand panel, read live from `api.consts.tenderChain`:

| Constant | Value |
|---|---|
| MinEvaluators | 3 |
| MinRevealWindow | 100 blocks (~10 min) |
| MaxScore | 100 |
| Avg block time | 6s |

---

## 5. A tour of every page and panel

Where every UI element lives, what it's for, and — for anything that writes
— which `pallet_tender_chain` extrinsic it calls. Use this as a reference
while working through §7, or alongside §6 if you would rather test one role's
actions than run a whole lifecycle.

### Header (every page)

| Element | What it shows / does |
|---|---|
| Block chip (green/amber/red dot) | Live best-block height via `subscribeNewHeads`. Tooltip also shows the finalized height, which trails by a few blocks. Red = node unreachable at `/ws`. |
| ⛽ Fund dev accounts | Only visible on a `--dev` chain. Transfers balance to any account with zero funds, signed by whatever holds `sudo.key()`. |
| Account dropdown | Switches the signing address across the whole app. Addresses are real SS58 (from the `--dev` keyring, or an injected extension). |
| Role dropdown | A UI-only lens (see §1) — doesn't touch the chain, just changes which panels render for the selected account. |

### Tenders (`/`) — `TenderListPage`

The marketplace list. **+ Create tender** opens the wizard. Filters (search
text, Status, Type, Entity) are client-side only, over whatever
`listTenders()` returned — no chain call. Each card links to the tender
detail page. This is the best place to watch a tender's status badge
auto-advance as the deadline wheel fires (`Published` → `Submission` →
`Closed` → …) with zero user action, once you understand no button drives
those transitions.

### Create tender (`/create`) — `CreateTenderWizard`

Drives **`createTender`** on submission of the final step. 5 steps:

1. **Basics** — title, summary, entity, officer account, kind, bid mode,
   blind-Q&A checkbox, optional EOI shortlist source.
   **Watch the kind/mode pair:** `Open` bid mode is only legal on a
   `Request for Quote`. An RFT or EOI must be `Sealed`, or `createTender` fails
   with `OpenBidNotPermitted` — and the wizard does not catch it, so you find
   out on the last step.
2. **Criteria & weights** — add/remove rows; must sum to exactly 100%. Each
   row's name+description is hashed together as `criteria_hash`; the row's
   position becomes its on-chain `criterion_id` (0, 1, 2…) — this is what
   every later scoring/ranking step keys against.
3. **Gates** — the 5 block-number gates and the standstill period, prefilled
   with a ~15-minute test schedule that tracks the live head until you type
   your own numbers in (see §3). The panel shows the total run length and
   whether the schedule is still tracking or pinned; the right-hand "Chain
   constants check" panel validates live against `MinRevealWindow` etc.
   before you can proceed.
4. **Eligibility & bond** — required credentials (comma-separated, each
   hashed individually), min reputation, bond amount/currency/forfeit flag.
5. **Review** — read-only summary, then **Create draft tender**. Lands in
   `Draft` — nothing is locked on chain until you separately click Publish.

### Tender detail (`/tenders/:id`) — every lifecycle action happens here

Left column (read-only display, always present):

| Panel | Shows | Backed by |
|---|---|---|
| Stepper | Current lifecycle position | `tender.state` |
| Criteria | Locked weights | `Tenders(id).weights` |
| Gates | The 5 block gates + countdown to the next one | `Tenders(id).gates` |
| Documents | *(currently always empty on live chain — see note below)* | — |
| Q&A | Questions/answers, blind or open per the tender's flag | `Questions` double-map |
| Bidders | Sealed: participation only, pre-opening. Open/post-opening: full bid table, price-sorted, disqualified bids flagged | `BidCommitments`, `Reveals` |
| Evaluator panel | Appointed evaluators, conflict status, **Appoint** dropdown+button | `EvaluatorSet`, drives **`appointEvaluator`** |
| Evaluation results | Per-criterion averages + weighted ranking (only once scores exist) | computed client-side from `Scores` |
| Award outcome | Proposed awardee, rationale, **Approve award (governed call)** | `Outcomes`, drives **`award`** (via sudo) |
| Challenge log | Lodged challenges, **Dismiss/Uphold** with rationale | `Challenges`, drives **`resolveChallenge`** (via sudo) |

Right column (action panels — only rendered for an account allowed to use
them; everything else stays hidden rather than shown-disabled):

| Panel | Visible to | Buttons → extrinsic |
|---|---|---|
| Officer actions | The tender's officer account only | Publish tender → **`publishTender`** · Open tender (start reveal window) → **`openTender`** · Propose award → records locally, no call yet · Execute award (notarise contract) → **`executeAward`** · Cancel tender → **`cancelTender`** |
| Bid panel | An account with role Bidder | Open mode: Submit/Update bid → **`submitOpenBid`**. Sealed mode: Commit bid → **`commitBid`**, Withdraw commitment → **`withdrawCommitment`**, Reveal bid → **`revealBid`** |
| Evaluator scoring | An account appointed as evaluator on this tender | Declare: no conflict / I have a conflict → **`declareConflict`** (then auto-**`activateEvaluator`** by the officer, chained by the adapter) · Submit scores → **`submitScores`** |
| Eligibility & bond | Everyone (read-only) | — |

QA panel's **Submit question** → **`askQuestion`**; the officer's answer
field (appears inline per-question once you're the officer) → **`answerQuestion`**.
Challenge panel's **Lodge challenge** (bidder-only, shown during Standstill) →
**`lodgeChallenge`**.

> **Known gaps — pallet calls with no button.** Four things the pallet can do
> that you cannot reach from this portal. None of them blocks a lifecycle run;
> drive them from Polkadot.js Apps if you need to exercise them.
>
> | Gap | Status |
> |---|---|
> | `publish_addendum` | No UI and no `ChainApi` method — the word "addendum" does not appear in `src/` at all. |
> | `call_off` | Same: framework-agreement call-offs are unimplemented in the frontend. |
> | `publish_shortlist` | `LiveChainApi.publishShortlist()` exists, but **no component calls it**, so there is no button. This is what stops Tender 4 below completing through the portal. |
> | Documents panel | Always reads empty on a live chain. The pallet has no document-registry storage item — document hashes travel embedded in `notice_hash`/`documents_hash` on other calls, not as a standalone list. The panel is wired for the mock chain's richer `documents[]` array. |

### Evaluator dashboard (`/evaluator`) — `EvaluatorDashboardPage`

Only useful with an Evaluator-role account selected. Lists every tender that
account is appointed to (`tender.evaluators.includes(address)`), with two
status pills per tender: conflict-declaration state, and how many of the
tender's revealed bids you've scored so far. Links straight into the detail
page's scoring panel. Read-only — no buttons that write.

### Public audit (`/audit`) — `PublicAuditPage`

No wallet/account needed — this is the probity-observer view the pallet
guide's "reconstruct from events alone" section is about. Pick any tender
from the dropdown and it reconstructs a full timeline (created → questions →
commits → reveals → scores → award → challenges) purely from what's readable
on chain, sorted by block. Also shows the locked criteria and, once scored,
the weighted ranking. Entirely read-only.

## 6. Role by role — every action each account can take

§5 is organised by *screen*. This one is organised by *who is signing*, which
is how you will actually think about it while testing: pick a role, work down
its table, and you have exercised everything that role can do. Use it to test
one call in isolation instead of running a whole lifecycle.

**Two separate things decide whether a control is on screen:**

1. **The role dropdown in the header** — a UI-only lens. The pallet has no role
   registry; this just decides which panels render. Officer panels need role
   `Officer`, the bid panel needs `Bidder`, the scoring panel needs `Evaluator`.
   Set it wrong and the panel is simply *absent* — panels hide rather than
   grey out, so "the button isn't there" almost always means wrong role or
   wrong account, not a bug.
2. **On-chain facts** — the tender's state, the block height, whether you are
   the tender's officer, whether you are appointed, whether you hold a bid.

> **One asymmetry to know about the role lens.** Changing the role dropdown
> rewrites only the *currently selected* account (`Header.tsx:132`); it never
> edits the shared account list. So the lens decides which **panels** render for
> you, but the officer's **Appoint evaluator** dropdown is built from accounts
> whose stored role is `Evaluator` (`EvaluatorPanel.tsx:16`) and is unaffected.
> Practical upshot: you can relens Charlie to `Bidder` and he really can bid,
> but you can never get Alice or Bob into the appointment dropdown.

### 6.1 Procuring Officer — Alice

Panel appears only when the role dropdown says **Officer** *and* the selected
address equals the tender's officer (`OfficerActionsPanel.tsx:16`).

| Action | Where | On screen when | Extrinsic |
|---|---|---|---|
| Create tender | `/create` wizard, **Create draft tender** | always | **`createTender`** |
| Publish tender | Officer actions | state = `Draft` | **`publishTender`** |
| Answer a question | Q&A panel, inline under each question | you are the officer and a question exists | **`answerQuestion`** |
| **Appoint evaluator** | Evaluator panel (left column) | state ∈ `Draft`/`Published`/`Submission` **and** fewer than `MinEvaluators` appointed | **`appointEvaluator`** |
| Activate evaluator | *no button* | fires automatically right after the evaluator declares | **`activateEvaluator`** |
| Open tender | Officer actions | state = `Closed`, current block ≥ `openingAt` | **`openTender`** |
| Propose award | Officer actions | scores exist | **none** — recorded in this browser only |
| Execute award | Officer actions | state = `Standstill`, past the standstill end, no open challenge | **`executeAward`** |
| Cancel tender | Officer actions | tender not in a terminal state | **`cancelTender`** |

> **Appoint your evaluators early.** The Appoint dropdown is rendered only while
> the tender is in `Draft`, `Published` or `Submission`
> (`EvaluatorPanel.tsx:72`) — once submission closes it is gone, and there is no
> other way to appoint from the portal. The pallet itself has no such state
> limit, but the UI does, so do it right after **Publish tender**. The control
> also disappears once three evaluators are on the panel, which is why you
> cannot appoint a fourth.

> **Propose award writes nothing to the chain.** It records your choice in
> `localStorage` so the Award outcome panel has something to show; the actual
> `award` extrinsic only goes out when someone clicks **Approve award**. Lose
> your browser storage between the two and you have to propose again.

### 6.2 Bidder — Bob

Panel appears when the role dropdown says **Bidder**
(`BidActionPanel.tsx:70`). What it shows depends on the tender's bid mode.

| Action | Where | On screen when | Extrinsic |
|---|---|---|---|
| Ask a question | Q&A panel | state = `Published` (before `questionsCloseAt`) | **`askQuestion`** |
| Submit / update bid | Bid panel | bid mode `Open`, state = `Submission` | **`submitOpenBid`** |
| Commit sealed bid | Bid panel | bid mode `Sealed`, state = `Submission` | **`commitBid`** |
| Withdraw commitment | Bid panel | sealed, you have committed, still `Submission` | **`withdrawCommitment`** |
| Reveal bid | Bid panel | sealed, state = `Opening` | **`revealBid`** |
| Lodge challenge | Challenge panel | state = `Standstill` and you hold a bid on this tender | **`lodgeChallenge`** |

Outside those windows the panel tells you why rather than vanishing, e.g.
*"Bids can only be committed during the submission window (currently: Closed)."*

### 6.3 Evaluator — Charlie, Dave, Eve

Panel appears only when the role dropdown says **Evaluator** *and* the selected
address is already appointed to this tender
(`EvaluatorScoringPanel.tsx:19`). Before the officer appoints you, there is
nothing to see — that is the most common "where is the scoring panel?".

| Action | Where | On screen when | Extrinsic |
|---|---|---|---|
| Declare: no conflict | Scoring panel | appointed, no declaration yet | **`declareConflict`**, then **`activateEvaluator`** automatically |
| Declare: I have a conflict | Scoring panel | appointed, no declaration yet | **`declareConflict`** — the panel then locks you out of scoring |
| Submit scores | Scoring panel | you declared *no* conflict and revealed bids exist | **`submitScores`** |
| See your workload | `/evaluator` dashboard | role `Evaluator` | read-only, no calls |

> **One button, two calls.** `declareConflict` is signed by *you*, but
> `activateEvaluator` is the officer's call — the portal fires it straight
> after, signed by the officer's key, so scoring rights go live without a
> separate step (`liveChainApi.ts:589-599`). On a `--dev` chain the officer's
> key is in the keyring, so this is invisible. It is why the pallet guide's
> separate "activate" step does not appear here.

### 6.4 Governance / Root — any account

`award` and `resolveChallenge` are bound to `EnsureRoot`. These buttons submit
through `sudo.sudo(...)` signed by whatever holds `sudo.key()` (Alice on
`--dev`), **regardless of which account the dropdown shows** — so it does not
matter who clicks them.

| Action | Where | On screen when | Extrinsic |
|---|---|---|---|
| Approve award | Award outcome panel | an award has been proposed | **`award`**, sudo-wrapped |
| Dismiss challenge | Challenge log | a challenge is open | **`resolveChallenge`**, sudo-wrapped |
| Uphold challenge | Challenge log | a challenge is open | **`resolveChallenge`**, sudo-wrapped — remits to `Evaluation` |

### 6.5 Separation rules the pallet enforces

Worth provoking deliberately at least once; all three are chain-side, so no UI
change can talk you past them.

| Rule | Error | How to trigger it |
|---|---|---|
| An evaluator cannot be a bidder on the same tender | `EvaluatorIsBidder` | Relens an evaluator account to `Bidder`, have it bid, then try to appoint it — §7 Tender 8 step 4 |
| The officer (or entity) cannot evaluate their own tender | `OfficerCannotEvaluate` | **Not reachable from the portal** — the Appoint dropdown never lists Alice. Send `appointEvaluator` from Polkadot.js Apps |
| Three *activated* evaluators before an award | `TooFewEvaluators` | Approve award with only two declared — §7 Tender 8 step 5 |

Re-appointing someone already on the panel is not an error: it refreshes their
record, clears their conflict declaration and deactivates them, so they must
declare again.

---

## 7. Eight example tenders

Each one exercises a different path. Do them in order — later ones assume
you've already clicked **⛽ Fund dev accounts** once.

Every wizard run: **Tenders → + Create tender**, walk the 5 steps
(**Basics → Criteria & weights → Gates → Eligibility & bond → Review**),
click **Create draft tender** on the last step.

**What each one covers**, so you can pick rather than work through all eight:

| # | Tender | What it is the only one to cover |
|---|---|---|
| 1 | RFQ, open bids | The fastest path to `Contracted`. Start here. |
| 2 | RFT, sealed bids | `commitBid` → `revealBid`, blind Q&A, a bond |
| 3 | Tight gates | `RevealWindowTooShort` / `GateOrderInvalid` validation |
| 4 | EOI → shortlist → RFT | `shortlistFrom` chaining *(needs Polkadot.js — see below)* |
| 5 | Challenge | `lodgeChallenge`, dismiss **and** uphold-then-rescore |
| 6 | **Three competing bidders** | Real ranking, a winner who is not the cheapest, evaluator disagreement |
| 7 | **Bids that go wrong** | `withdrawCommitment`, `RevealMismatch`, a bidder who never reveals |
| 8 | **Negative tests + cancellation** | `EvaluatorIsBidder`, `TooFewEvaluators`, a declared conflict, `cancelTender` |

Tenders 1–5 all have exactly one bidder, which is enough to walk the lifecycle
but tests none of the competitive machinery. **Tender 6 is the one that
actually evaluates anything.** If you only have time for two, do 1 and 6.

**Extra bidder accounts.** The account dropdown ships two more accounts with the
`Bidder` role already set — **Alice (stash)** and **Bob (stash)**, which are
`//Alice//stash` and `//Bob//stash`, distinct keys from Alice and Bob
(`accounts.ts:23-32`). Tenders 6 and 7 use them. They are endowed at genesis
like Alice and Bob, so they need no funding.

> **Eligibility is not enforced on this runtime.** The runtime binds
> `type Eligibility = ()` (`configs/mod.rs:209`), whose `is_eligible` returns
> `true` for everyone. Required credentials and minimum reputation are hashed,
> stored on chain and displayed — but no bidder is ever rejected for them. Do
> not spend time trying to get a bid refused that way; it cannot happen until
> the Identity module lands.

---

### Tender 1 — RFQ, Open bid mode (fastest full run)

The quickest path to a `Contracted` tender: no salt to keep, no sealed
reveal, bid content is public the moment it's submitted.

**Step 1 — Basics**
| Field | Value |
|---|---|
| Title | `Resurfacing of Galle Road, Section 4` |
| Summary | `Milling and resurfacing of 2.1km carriageway including line marking and signage renewal.` |
| Procuring entity | `Department of Works` |
| Officer account | **Alice** |
| Tender kind | `Request for Quote` |
| Bid mode | `Open` |
| Allow bidders to ask questions anonymously | unchecked |
| Shortlist from EOI | `None — open to all eligible bidders` |

**Step 2 — Criteria & weights**
| Name | Description | Weight |
|---|---|---|
| Price | Total cost | `60` |
| Capability | Delivery track record | `40` |

Delete the third default row if present. Total must read **100%**.

**Step 3 — Gates** → nothing to do. The prefilled ~15-minute schedule
(standstill already `10`) is what you want; just check the panel says it is
still tracking the head, and click **Next**.

**Step 4 — Eligibility & bond**
| Field | Value |
|---|---|
| Required credentials | *(leave blank)* |
| Minimum reputation score | `0` |
| Bond amount | `0` |
| Currency | `LKR` |
| Forfeit on withdrawal | unchecked |

**Step 5 — Review** → **Create draft tender**.

**Now on the tender detail page, in order:**

1. **Officer actions → Publish tender** (as **Alice**). State moves to
   *Published — Q&A*.
2. **Evaluator panel** (still as **Alice**): pick **Charlie** from the dropdown
   → **Appoint**. Repeat for **Dave**, then **Eve**. **Do this now** — the
   Appoint control only renders while the tender is in `Draft`, `Published` or
   `Submission`, and there is no other way to appoint from the portal once
   submission closes. See §6.1.
3. Switch the account dropdown to **Charlie** and the role dropdown to
   **Evaluator**. **Scoring panel → Conflict of interest declaration** →
   **Declare: no conflict**. Repeat as **Dave**, then **Eve**. (Declaring also
   activates scoring rights — the officer's `activateEvaluator` call happens
   automatically behind this button.)
4. *(optional)* **Q&A panel**: as **Bob**, type a question, e.g.
   `Is milling depth specified separately?` → **Submit question**. Switch to
   **Alice**, type an answer, click **Answer**.
5. Wait for the block chip to pass `questionsCloseAt` (state flips to
   *Submission open* on its own — no button).
6. **Bid panel** (as **Bob**, role **Bidder**): Documents field →
   `resurfacing-proposal-v1.pdf`. Price schedule → one line, unit price
   `10000000000`, qty `1`. Click **Submit bid**.
7. Wait for the block chip to pass `submissionCloseAt` (state auto-flips to
   *Closed*).
8. **Officer actions → Open tender (start reveal window)** (as **Alice**).
   Disabled until the current block reaches `openingAt` — the button's
   tooltip tells you the block it's waiting for.
9. Wait for the block chip to pass `openingEndAt` (state auto-flips to
   *Evaluation*).
10. As **Charlie**: **Scoring panel** → Bid dropdown → select Bob's bid →
    score each criterion (e.g. Price `85`, Capability `78`) → optional
    comment text → **Submit scores**. Repeat as **Dave**, then **Eve**, with
    your own scores.
11. **Officer actions → Propose award** (as **Alice**): pick Bob's bid,
    rationale → `Highest weighted score, price within engineer's estimate.`
    → **Propose award**.
12. **Award outcome panel → Approve award (governed call)**. Any connected
    account can click this — the portal dispatches it through `sudo` using
    the chain's own sudo key, not whichever account is selected. State moves
    to *Standstill*.
13. Wait for the block chip to pass the standstill end shown in the Award
    outcome panel.
14. **Officer actions → Execute award (notarise contract)** (as **Alice**).
    State moves to *Contracted* — done.

---

### Tender 2 — RFT, Sealed bid mode (commit → reveal)

Same lifecycle, but exercises the cryptographic commitment path the pallet
guide's Section 3 walks through by hand — here the portal computes the hash
for you.

**Basics**
| Field | Value |
|---|---|
| Title | `Construction of Kandy District Community Hospital — Phase 1` |
| Summary | `Structural works, MEP rough-in and building envelope for a 120-bed regional hospital.` |
| Procuring entity | `Ministry of Health` |
| Officer account | **Alice** |
| Tender kind | `Request for Tender` |
| Bid mode | `Sealed (commit → reveal)` |
| Blind Q&A | checked |
| Shortlist from EOI | `None` |

**Criteria & weights**
| Name | Weight |
|---|---|
| Technical capability | `40` |
| Price | `40` |
| Past performance | `20` |

**Gates** → leave the prefilled ~15-minute schedule as it is.

**Eligibility & bond**
| Field | Value |
|---|---|
| Required credentials | `ICTAD-Grade-C1, Tax-Compliance-Cert` |
| Minimum reputation score | `0` |
| Bond amount | `5000000000` |
| Currency | `LKR` |
| Forfeit on withdrawal | checked |

**Create draft tender**, then:

1. **Publish tender** (Alice).
2. **Appoint Charlie, Dave and Eve now** (Alice, Evaluator panel), then declare
   no conflict as each of them — same reason as Tender 1 step 2: the Appoint
   control disappears once submission closes.
3. **Ask a question blind**: as **Bob**, the Q&A form has no name attached to
   what you type — that's the `blind_questions` flag from step 1 at work.
4. Wait past `questionsCloseAt`.
5. **Bid panel → "Commit your sealed bid"** (as **Bob**):
   - Documents label → `hospital-tender-vol1.pdf`
   - Price schedule → add 2–3 lines with realistic quantities/unit prices
   - Salt → click **Generate** (do **not** clear your browser storage before
     revealing — the warning banner on this screen is not decorative; losing
     the salt forfeits the bond)
   - Note the **Commitment hash** shown — this is
     `blake2_256(bidder ‖ documents_hash ‖ SCALE(price_schedule) ‖ salt)`,
     computed to match the pallet's `compute_commitment` exactly
   - Click **Commit bid**
6. Wait past `submissionCloseAt` → **Open tender** (Alice).
7. **Bid panel → "Reveal your bid"** (as **Bob**): the form pre-fills from
   what was saved locally at commit time — just click **Reveal bid**. (If you
   want to see a deliberate `RevealMismatch`, edit one price line before
   revealing — the bid is voided but stays on the public record, exactly as
   the pallet guide's negative-test note describes.)
8. Wait past `openingEndAt` → score as each evaluator → **Propose award**
   (Alice) → **Approve award** → wait past standstill → **Execute award**
   (Alice).

---

### Tender 3 — Low-value RFQ with a tight buffer (watch a gate error happen)

This one is deliberately built to demonstrate `GateOrderInvalid` and
`RevealWindowTooShort`, then fixed — useful for seeing the guardrails work
before you rely on them.

**Basics**
| Field | Value |
|---|---|
| Title | `Office stationery supply — Q1` |
| Summary | `Quarterly stationery and consumables supply, single delivery.` |
| Procuring entity | `Dept. of Works` |
| Officer account | **Alice** |
| Tender kind | `Request for Quote` |
| Bid mode | `Open` |

**Criteria**: `Price` — weight `100`.

**Gates** — this time, type the values by hand (which pins the schedule and
stops it tracking the head), to see the validation panel react:
1. Note the current block (top-right), call it `N`.
2. Enter `publishAt = N+2`, `questionsCloseAt = N+4`, `submissionCloseAt =
   N+6`, `openingAt = N+6`, `openingEndAt = N+20`.
3. The red validation box appears: *"Reveal window (openingEndAt −
   openingAt) must be at least MinRevealWindow = 100 blocks."* — this is the
   client-side check catching what would otherwise fail on-chain as
   `RevealWindowTooShort` at `openTender`.
4. Fix it: set `openingEndAt = N+6+115` (100 + margin). The box clears and
   **Next** becomes enabled.

**Eligibility & bond**: all defaults (`0`, `0`, no credentials).

**Create draft tender**, then just **Publish tender** and stop there — this
one is for observing the gate math, not for running to completion. If you
want to see `GateOrderInvalid` fire for real, try creating a second tender
with `questionsCloseAt` typed *before* `publishAt` — the wizard's own
validation will block **Next** with the same rule the pallet enforces.

---

### Tender 4 — EOI → shortlist → follow-on RFT (multi-stage)

Exercises `publishShortlist` and the `shortlistFrom` chaining the single-run
walkthroughs skip.

> **Read this before starting Tender 4.** It is the one walkthrough here that
> **cannot be completed through the portal**. There is no Publish shortlist
> button: `LiveChainApi.publishShortlist()` exists but no component calls it
> (§5, Known gaps). To get past the shortlist step you have to send
> `tenderChain.publishShortlist(tenderId, [bidderAddress])` from Polkadot.js
> Apps as Alice. Everything either side of that step works normally.

**Tender 4a (the EOI)**
| Field | Value |
|---|---|
| Title | `Panel of Structural Engineering Consultants 2026` |
| Summary | `Expression of interest to join a standing panel of pre-qualified structural consultants.` |
| Procuring entity | `Ministry of Health` |
| Officer account | **Alice** |
| Tender kind | `Expression of Interest` |
| Bid mode | `Sealed (commit → reveal)` — **an EOI cannot be `Open`** |

Criteria: `Qualifications` — weight `100`. Gates: leave the prefilled
~15-minute schedule.

**Create draft tender → Publish tender.** Have **Bob** submit a bid (any
documents/price — EOI bids are just expressions of interest here). Once past
`submissionCloseAt`:

- **Publish the shortlist** — the portal has no button for this. In Polkadot.js
  Apps, **Developer → Extrinsics**, signed by **Alice**:
  `tenderChain.publishShortlist(tenderId = <4a's id>, bidders = [Bob])`.
  Back in the portal the state becomes *Awarded* in its mapping (the pallet's
  terminal EOI state is `Shortlisted`).

**Tender 4b (the follow-on RFT)** — create a second tender:
| Field | Value |
|---|---|
| Title | `Design Services — Kandy Hospital Phase 1 (from panel)` |
| Tender kind | `Request for Tender` |
| Bid mode | `Sealed (commit → reveal)` — **an RFT cannot be `Open`** |
| Shortlist from EOI | select **Tender 4a** from the dropdown (only appears once kind = RFT) |

Everything else as Tender 1, except that the sealed mode adds a commit→reveal
step for the bidder as in Tender 2. Only **Bob** (shortlisted in 4a) is eligible to
bid on this one — the pallet checks `shortlistFrom` at `commit_bid`/
`submit_open_bid` time. Run it to completion the same way as Tender 1.

---

### Tender 5 — Challenge path (lodge → resolve)

Same as Tender 1 up through **Propose award → Approve award**, then instead
of waiting out the standstill quietly:

| Field | Value |
|---|---|
| Title | `Storm-water Drainage Upgrade — Ward 12` |
| Summary | `Replacement of undersized drainage culverts along Ward 12 arterial roads.` |
| Procuring entity | `City Council` |
| Officer account | **Alice** |
| Tender kind | `Request for Quote` |
| Bid mode | `Open` |

Run through **Propose award → Approve award** exactly as in Tender 1. Then,
while state reads *Standstill*, **before** the standstill-end block:

1. **Challenge panel** (as **Bob** — only an account that actually holds a
   revealed bid on this tender can do this, checked as `NotAParticipant`
   otherwise): Grounds → `Evaluation criteria were not applied as published — request review.`
   → **Lodge challenge**. State stays *Standstill*; **Execute award** on the
   officer panel is now disabled (a lodged challenge suspends execution).
2. **Resolve it** — a governed call too, submitted through sudo regardless of
   which account is selected. Two branches; do them on two separate tenders if
   you want both, because each is terminal for that run.

   **Branch A — dismiss.** Type a resolution rationale, e.g.
   `Criteria were applied as published; scoring record reviewed and upheld.`
   → **Dismiss challenge**. Execution unblocks → **Execute award** (Alice) →
   *Contracted*.

   **Branch B — uphold, then re-run the evaluation.** This is the longer path
   and the only one that loops backwards through the lifecycle:

   1. Rationale → `Scoring record incomplete; remitted for re-evaluation.` →
      **Uphold challenge**. The pallet sets the tender back to `Evaluation`.
   2. **Execute award** disappears from the officer panel — it renders only in
      `Standstill` (`OfficerActionsPanel.tsx:95`) and the state is now
      `Evaluation`. The Award outcome panel itself stays on screen: the pallet
      leaves the `Outcomes` record in place when it remits, so you are looking
      at the *superseded* award until a new one replaces it. Don't read that as
      the uphold having failed.
   3. **Re-score**: as each of Charlie, Dave and Eve, submit a fresh scoresheet
      for the bid. `submit_scores` requires state `Evaluation`, which you are
      back in, and re-submitting overwrites your earlier sheet for that bidder
      (`Scores::insert`, `lib.rs:1186`) rather than erroring.
   4. **Propose award** again (Alice) with a new rationale, **Approve award**
      again. A *new* standstill window opens from the block of this second
      approval — check the Award outcome panel for the new end block rather
      than reusing the first one.
   5. Wait it out, then **Execute award** → *Contracted*.

---

### Tender 6 — Three competing bidders (the one that actually evaluates)

Every tender above has a single bidder, so the ranking table has nothing to
rank and the award is a foregone conclusion. This one puts three bids in,
scores them differently, and awards the bid that is **not** the cheapest —
which is the entire point of weighted criteria.

**Basics**
| Field | Value |
|---|---|
| Title | `Supply and Installation of Solar PV — 14 Rural Clinics` |
| Summary | `Design, supply, install and commission 25 kWp rooftop PV with battery backup at fourteen clinic sites.` |
| Procuring entity | `Ministry of Health` |
| Officer account | **Alice** |
| Tender kind | `Request for Quote` — **`Open` mode is only legal on an RFQ** |
| Bid mode | `Open` |
| Blind Q&A | unchecked |

**Criteria & weights** — deliberately price-light, so the cheapest bid can lose:
| Name | Description | Weight |
|---|---|---|
| Price | Total installed cost | `30` |
| Technical capability | Equipment spec and commissioning plan | `45` |
| Past performance | Comparable clinic installations delivered | `25` |

**Gates** → leave the prefilled ~15-minute schedule. **Eligibility & bond** →
all defaults.

**Run it:**

1. **Publish tender** (Alice), then **appoint Charlie, Dave and Eve**
   immediately (§6.1) and declare no conflict as each.
2. Wait past `questionsCloseAt`.
3. **Submit three bids.** For each, switch the *account* dropdown (the role is
   already `Bidder` on all three) and use the Bid panel:

   | Account | Documents | Unit price | Qty |
   |---|---|---|---|
   | **Bob** | `solar-pv-bob.pdf` | `42000000000` | `1` |
   | **Bob (stash)** | `solar-pv-helios.pdf` | `51000000000` | `1` |
   | **Alice (stash)** | `solar-pv-suncoast.pdf` | `47500000000` | `1` |

4. Check the **Bidders panel** now lists three bids sorted by price, Bob
   cheapest. Nothing is ranked yet — there are no scores.
5. Wait past `submissionCloseAt` → **Open tender** (Alice) → wait past
   `openingEndAt`.
6. **Score all three bids as all three evaluators** — nine scoresheets. Use
   these numbers; they are chosen to make the cheapest bid lose and to trip the
   variance flag on one criterion:

   | Bid | Criterion | Charlie | Dave | Eve |
   |---|---|---|---|---|
   | Bob | Price | `95` | `95` | `92` |
   | Bob | Technical capability | `55` | `50` | `48` |
   | Bob | Past performance | `40` | `80` | `45` |
   | Bob (stash) | Price | `70` | `68` | `70` |
   | Bob (stash) | Technical capability | `92` | `90` | `94` |
   | Bob (stash) | Past performance | `88` | `85` | `90` |
   | Alice (stash) | Price | `82` | `80` | `83` |
   | Alice (stash) | Technical capability | `74` | `72` | `70` |
   | Alice (stash) | Past performance | `65` | `68` | `66` |

7. **Read the Evaluation results panel.** Weighted scores land at roughly
   **Bob (stash) 84.1, Alice (stash) 73.5, Bob 64.9** — so the *most expensive* bid
   wins on a 30/45/25 split. That is the result to check: if Bob wins, the
   weights did not get through, and the Criteria panel is where to look.
8. Note the **⚠ variance flag** on Bob's *Past performance* row: Dave scored
   `80` against Charlie's `40` and Eve's `45` — a standard deviation of ~17.8
   and a pairwise spread of 40. It is the only row that trips it; every other
   row is within a few points. See the note below on what that flag is and
   is not.
9. **Propose award** (Alice) → pick **Bob (stash)**, rationale →
   `Highest weighted score; technical capability and delivery record outweigh the price differential.`
   → **Approve award** → wait out standstill → **Execute award**.

> **The ⚠ in the UI is not the chain's variance signal.** The portal flags a
> criterion when the *standard deviation* of its scores exceeds 15
> (`scoring.ts:24`, `TenderDetailPage.tsx:145`) — computed in your browser from
> `Scores`. The pallet separately emits `ScoreVarianceFlagged` when any *pair*
> of evaluators differs by more than `ScoreVarianceThreshold = 30` on one
> criterion. Different statistic, different threshold, and the pallet's event is
> not surfaced anywhere in the portal — read it in Polkadot.js Apps' event log
> if you want to see it. The Bob / Past performance row above trips both.

---

### Tender 7 — Sealed bids that go wrong (withdraw, mismatch, no-show)

Tender 2 walks the happy sealed-bid path. This one runs three bidders into the
three ways a sealed bid fails to become a valid bid, and checks that only the
good one reaches evaluation.

**Basics** — as Tender 2 but:
| Field | Value |
|---|---|
| Title | `Medical Oxygen Plant — Batticaloa Base Hospital` |
| Procuring entity | `Ministry of Health` |
| Tender kind | `Request for Tender` |
| Bid mode | `Sealed (commit → reveal)` |
| Blind Q&A | unchecked |

**Criteria**: `Price` `50`, `Technical capability` `50`.
**Gates**: prefilled. **Bond**: amount `5000000000`, **Forfeit on withdrawal**
**checked**.

**Run it:**

1. **Publish**, appoint **Charlie/Dave/Eve**, declare no conflict as each.
2. Past `questionsCloseAt`, commit **three** sealed bids — for each, switch
   account, fill the Bid panel, click **Generate** for the salt, then
   **Commit bid**:

   | Account | Documents | Unit price | Then |
   |---|---|---|---|
   | **Bob** | `oxygen-bob.pdf` | `88000000000` | reveals correctly |
   | **Bob (stash)** | `oxygen-helios.pdf` | `91000000000` | withdraws |
   | **Alice (stash)** | `oxygen-suncoast.pdf` | `85000000000` | reveals with a tampered price |

3. **The withdrawal.** Still as **Bob (stash)**, still inside the submission
   window, click **Withdraw commitment** → **`withdrawCommitment`**. The
   Bidders panel drops from three participants to two. The bond was configured
   to forfeit on withdrawal, which is what that flag on the wizard's step 4
   does.
4. Wait past `submissionCloseAt` → **Open tender** (Alice).
5. **The clean reveal.** As **Bob**: the Reveal form pre-fills from what was
   saved at commit time — click **Reveal bid**. The bid appears in the table
   with its price.
6. **The mismatch.** As **Alice (stash)**: before clicking **Reveal bid**,
   **edit the unit price** to `84000000000`. Submit it. The transaction
   **succeeds** — `revealBid` returns `Ok` — but the commitment no longer
   matches, so the bid shows as **disqualified (`RevealMismatch`)** and stays
   on the public record. A failed reveal is evidence, not an error (golden
   rule 5).
7. **The no-show.** Nobody else reveals. Wait past `openingEndAt`.
8. **Check the evaluation pool**: only **Bob's** bid is scoreable. One
   withdrew, one is disqualified. Score it as all three evaluators, propose,
   approve, execute.

> Worth doing at least once because it is the only walkthrough where the
> tender still completes despite two of the three bids being void — and where
> you can see that the portal keeps failed bids visible rather than hiding
> them.

---

### Tender 8 — Negative tests and cancellation

Short, and mostly about things that are *supposed* to fail. Section 6.5 lists
the separation rules; this is where you provoke them. Nothing here reaches
`Contracted` — it ends in `Cancelled` on purpose.

**Basics**
| Field | Value |
|---|---|
| Title | `Fleet Maintenance Services — Northern Province` |
| Summary | `Scheduled and breakdown maintenance for a 60-vehicle provincial fleet.` |
| Procuring entity | `Department of Works` |
| Officer account | **Alice** |
| Tender kind | `Request for Quote` |
| Bid mode | `Open` |

**Criteria**: `Price` `60`, `Capability` `40`. **Gates**: prefilled.

**Run the failures, in this order:**

1. **Publish tender** (Alice).
2. **Appoint Charlie only.** Declare no conflict as Charlie.
3. **A real conflict declaration** — appoint **Dave**, switch to Dave, and
   click **Declare: I have a conflict** with a note like
   `Former director of one of the bidding entities.` Dave's pill in the
   Evaluator panel turns red and his scoring form is replaced by a lock-out
   notice. He counts as appointed but cannot score.
4. **`EvaluatorIsBidder`** — do this *before* submission closes, while the
   Appoint control is still on screen. Select **Eve**, switch her **role lens
   to `Bidder`**, and submit a bid from her in the Bid panel. Now switch back
   to **Alice** and try to appoint Eve as an evaluator: refused, because she
   holds a bid commitment on this tender. (The role lens is what makes this
   reachable — see the note below.)
5. **`TooFewEvaluators`** — you now have Charlie activated and Dave conflicted,
   which is not three. Let another bid come in (as **Bob**), let the gates run
   to `Evaluation`, score as **Charlie** only, then **Propose award** →
   **Approve award**. The sudo wrapper lands but the *inner* call fails: the
   portal surfaces `TooFewEvaluators` rather than a false success, because
   fewer than `MinEvaluators = 3` evaluators are *activated*.
6. **Cancel it** — **Officer actions → Cancel tender** (Alice), confirm the
   dialog. State moves to `Cancelled`, which is terminal, and the pallet
   **releases all bonds**: cancellation never forfeits, because bidders should
   not be penalised for the entity's own decision.

Then reload the tender list and confirm the card shows `Cancelled`, and that
every action panel for it has gone.

> **`OfficerCannotEvaluate` cannot be provoked from the portal.** The Appoint
> dropdown is built from accounts whose *stored* role is `Evaluator`
> (`EvaluatorPanel.tsx:16`), and the header's role dropdown only rewrites
> `currentAccount` — it never touches the shared account list
> (`Header.tsx:132`). So Alice never appears in the dropdown, and neither does
> Bob. That asymmetry is also why step 4 works: the **Bid panel** reads
> `currentAccount.role`, so relensing Eve to `Bidder` really does let her bid,
> while the appointment pool still sees her as an `Evaluator`. To see
> `OfficerCannotEvaluate` itself, send `tenderChain.appointEvaluator` with
> Alice's own address from Polkadot.js Apps.

---

## 8. Errors you'll likely see, and what they mean here

Same set as the pallet guide's Section 4 — the portal surfaces the decoded
`section.Name` and its on-chain doc string in an alert/toast rather than
Polkadot.js Apps' event log, but it's the same error coming from the same
place.

| Error | Where you'll hit it | Fix |
|---|---|---|
| `NotOfficer` | Any Officer actions button, wrong account selected | Switch the account dropdown to the tender's officer (Alice by default) |
| `BadState` | Clicking an action before the tender reached the right state | Check the status chip on the tender card; wait for the block gate |
| `RevealWindowTooShort` | Open tender, before the wizard's Gates validation caught it | Recreate with a wider `openingEndAt − openingAt` gap (≥ `MinRevealWindow`) |
| `TooFewEvaluators` | Propose/approve award, with < 3 activated evaluators | Appoint + declare + activate a third evaluator, check the Evaluator panel's count |
| `ConflictNotDeclared` | Scoring panel refuses to show the score form | The evaluator must click a Declare button first |
| `1010: Inability to pay some fees` | Any call from Charlie/Dave/Eve/Ferdie on a fresh `--dev` chain | Click **⛽ Fund dev accounts** in the header |
| `RevealMismatch` (shown as a disqualified bid, not a failed tx) | Reveal panel, if the salt/documents/price don't match commit time | Bid is void by design — re-commit and reveal correctly next time |
| `StandstillActive` | Execute award, clicked too early | Wait for the block shown in the Award outcome panel |
| `NotAParticipant` | Lodge challenge, from an account with no bid on this tender | Only a bidder who actually committed/revealed can challenge |
| `OpenBidNotPermitted` | **Create draft tender**, with bid mode `Open` on an RFT or EOI | Open bidding is confined to RFQs. Use `Sealed`, or change the kind to `Request for Quote`. The wizard does not catch this — it fails on submit |
| `EvaluatorIsBidder` | Appointing an account that already holds a bid commitment | Use a fourth account; the roles are mutually exclusive per tender (§6.5) |
| `OfficerCannotEvaluate` | Appointing the tender's own officer (or entity) as an evaluator — only reachable via Polkadot.js Apps (§6.5) | Appoint someone else — Alice cannot score Alice's tender |
| `NotEvaluator` | Declare/score from an account that was never appointed | The officer must appoint it first; the scoring panel is hidden until then |

Not an error, but the most common "nothing happens": **the button isn't
there.** Action panels hide rather than grey out, so check the *role* dropdown
as well as the account — see the two gating rules at the top of §6.

## 9. Resetting between test runs

`--dev` chains don't persist state across restarts unless you pass
`--base-path`. If you restart the node, the block height resets to 0 but
your browser's localStorage (tender titles, criteria text, salts, funded
account cache) does not — clear it (DevTools → Application → Local Storage)
for a genuinely clean slate, or just create new tenders; old ones will show
as unreadable hashes if their storage entries no longer exist on chain.

To restart: `Ctrl+C` in Terminal 1 and run the same command from §2 again. The
frontend does not need restarting or redeploying — it reconnects to the new
chain on its own, though the tender list will be empty and you will want to
click **⛽ Fund dev accounts** again.
