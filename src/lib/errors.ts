// Turning a rejected chain call into something a human can read.
//
// A failed extrinsic rejects with a `ChainCallError` carrying two halves:
// `message` is the pallet variant (`tenderChain.BadState`), which is what you
// grep the pallet for, and `docs` is the doc comment the runtime ships with it.
// Neither is enough for an officer or a bidder on its own, so every variant the
// pallet can return is also mapped here to a plain-language title and a hint
// on what to do next. The raw code is always kept alongside, never replaced.

export interface ErrorView {
  /** What went wrong, in one plain sentence. */
  title: string;
  /** What to do about it, when there is something to do. */
  hint?: string;
  /** The runtime's own doc comment for the variant. */
  docs?: string;
  /** `section.Variant`, or the raw message for non-chain failures. */
  code?: string;
}

type Entry = { title: string; hint?: string };

const TENDER_CHAIN: Record<string, Entry> = {
  GateOrderInvalid: {
    title: 'The tender schedule is out of order, or the Q&A window has already passed.',
    hint: 'Gates must run publish < questions close < submission close ≤ opening < opening end, and the tender must be published before its questions-close block.',
  },
  WeightsInvalid: { title: 'Criterion weights must add up to exactly 100%.' },
  TooManyWeights: { title: 'Too many evaluation criteria for this chain.' },
  TenderNotFound: {
    title: 'This tender does not exist on chain.',
    hint: 'It may have been deleted. Go back to the tender list and refresh.',
  },
  BadState: {
    title: "This action is not allowed at the tender's current stage.",
    hint: 'The chain moves tenders between stages on its own at each gate block, so it may have just moved on. Check the stage shown at the top of the page and try again.',
  },
  NotOfficer: {
    title: "Only this tender's procurement officer (or its procuring entity) can do this.",
    hint: 'Switch to the officer account that created the tender.',
  },
  TenderNotPublished: {
    title: 'This tender has not been published yet.',
    hint: 'The officer must publish it before questions or bids are accepted.',
  },
  SubmissionClosed: {
    title: 'Submissions for this tender have closed.',
    hint: 'The close block has passed. Late bids are rejected by the chain itself, not by an official.',
  },
  NotEligible: { title: 'This account does not meet the tender’s eligibility requirements.' },
  CommitmentExists: {
    title: 'You already have a bid on this tender.',
    hint: 'To change it, withdraw your commitment first (before submission closes), then submit again.',
  },
  CommitmentNotFound: { title: 'No bid commitment was found for this account on this tender.' },
  RevealMismatch: {
    title: 'The revealed bid did not match the sealed commitment.',
    hint: 'The documents, price lines and salt must be exactly what was used at commit time.',
  },
  RevealWindowClosed: {
    title: 'The reveal window is not open.',
    hint: 'Bids can only be revealed after the officer opens the tender and before the opening-end block.',
  },
  AlreadyRevealed: { title: 'This bid has already been revealed.' },
  ConflictNotDeclared: {
    title: 'This evaluator has no active scoring rights yet.',
    hint: 'The evaluator must lodge a conflict-of-interest declaration and be activated by the officer before scoring.',
  },
  NotEvaluator: { title: 'This account is not an appointed evaluator on this tender.' },
  ScoreOutOfRange: { title: 'A score is above the maximum allowed per criterion.' },
  CriteriaMismatch: { title: 'The scoresheet must score every locked criterion, and only those.' },
  TooFewEvaluators: {
    title: 'Not enough activated evaluators to make an award.',
    hint: 'Appoint more evaluators and make sure each has declared no conflict and been activated.',
  },
  StandstillActive: {
    title: 'The standstill (challenge) window is still open.',
    hint: 'The award can only be executed after the standstill end block has passed.',
  },
  ChallengeWindowClosed: { title: 'The standstill window has ended — challenges can no longer be lodged.' },
  ChallengeOpen: {
    title: 'A challenge is still open, so execution is suspended.',
    hint: 'Governance must resolve every open challenge first.',
  },
  ChallengeNotFound: { title: 'That challenge does not exist or has already been resolved.' },
  NotPanelMember: { title: 'That supplier is not on this standing-offer panel.' },
  NotPanelTender: { title: 'This tender is not a panel / standing offer.' },
  CloseCannotShorten: { title: 'An addendum can only extend the submission close, never bring it forward.' },
  TooManyAddenda: { title: 'This tender already has the maximum number of addenda.' },
  TooManyBidders: { title: 'This tender already has the maximum number of bidders.' },
  TooManyEvaluators: { title: 'This tender already has the maximum number of evaluators.' },
  TooManyPriceLines: { title: 'Too many price lines in this bid.' },
  TooManyQuestions: { title: 'This tender has reached its question limit.' },
  TooManyChallenges: { title: 'This tender has reached its challenge limit.' },
  NotAParticipant: { title: 'Only a bidder who submitted a bid on this tender can challenge it.' },
  EvaluatorIsBidder: {
    title: 'Evaluators and bidders must be different accounts on the same tender.',
    hint: 'An appointed evaluator cannot bid, and a bidder cannot be appointed to evaluate.',
  },
  OfficerCannotEvaluate: { title: 'The officer or procuring entity cannot sit on their own evaluation panel.' },
  RevealWindowTooShort: {
    title: 'It is too late to open this tender.',
    hint: 'Opening now would leave bidders less than the minimum reveal window. The tender will move to evaluation at its opening-end block with all bonds returned.',
  },
  NotShortlisted: { title: 'This tender only admits suppliers shortlisted by its EOI, and this account is not on that shortlist.' },
  NotAnEoi: { title: 'That action needs an Expression of Interest (EOI) tender.' },
  InvalidShortlistEntry: { title: 'Every shortlisted supplier must have a valid revealed response on the EOI.' },
  DuplicateShortlistEntry: { title: 'The same supplier was listed twice in the shortlist.' },
  QuestionsClosed: {
    title: 'The Q&A window for this tender has closed.',
    hint: 'Questions are accepted only between publication and the questions-close block.',
  },
  OpeningNotReached: {
    title: 'The opening block has not been reached yet.',
    hint: 'Wait for the “Opening begins” block shown in the Gates panel, then open the tender.',
  },
  TooManyCredentials: { title: 'Too many required credentials for this chain.' },
  TitleTooLong: { title: 'The tender title is too long.' },
  TitleEmpty: { title: 'The tender needs a title.' },
  SummaryTooLong: { title: 'The tender summary is too long.' },
  GroundsTooLong: { title: 'The challenge grounds are too long.' },
  GroundsEmpty: { title: 'A challenge needs written grounds.' },
  ResolutionTooLong: { title: 'The resolution text is too long.' },
  ResolutionEmpty: { title: 'A challenge resolution needs written reasoning.' },
  WrongBidMode: {
    title: 'That bid action does not match this tender’s bid mode.',
    hint: 'Sealed tenders use commit + reveal; open tenders take a single open bid.',
  },
  PanelNotFound: { title: 'No such panel.' },
  DeadlineWheelFull: { title: 'Too many deadlines already fall on one of these blocks.', hint: 'Shift the gates by a block or two.' },
  InvalidAwardee: { title: 'The chosen awardee has no valid revealed bid on this tender.' },
  IdOverflow: { title: 'Internal id counter exhausted.' },
  IdCollision: { title: 'An id collision occurred. Try again in the next block.' },
  QuestionNotFound: { title: 'That question does not exist.' },
  AlreadyAnswered: { title: 'That question has already been answered — published answers cannot be rewritten.' },
  DuplicateCriterion: { title: 'Two criteria share the same id.' },
  DuplicateAwardee: { title: 'The same awardee was named twice.' },
  EoiUsesShortlist: { title: 'An EOI ends with a shortlist, not an award.' },
  AwardeeCannotChallenge: { title: 'The winning bidder cannot challenge its own award.' },
  NotEntity: {
    title: 'Only the procuring entity can cancel a tender.',
    hint: 'Switch to the entity account recorded on the tender.',
  },
  PublishTooEarly: {
    title: 'The tender’s publish block has not been reached yet.',
    hint: 'Wait until the publish block shown in the Gates panel, then publish.',
  },
  EvaluatorAlreadyActive: { title: 'This evaluator is already active; the declaration is locked.' },
  OpenBidNotPermitted: {
    title: 'Open bidding is only allowed on a Request for Quote (RFQ).',
    hint: 'Choose Sealed bidding, or change the tender kind to RFQ.',
  },
  NoValidBids: { title: 'There are no valid bids to award.' },
  DocumentNotAnchored: { title: 'A referenced document is not anchored in the document store.' },
  BondRequired: {
    title: 'The bid bond could not be reserved.',
    hint: 'The bidding account needs at least the bond amount plus fees in free balance.',
  },
  CriteriaLocked: { title: 'Criteria and weights are locked once a tender is published.' },
  AwardAuthorityRequired: {
    title: 'An award must come from the governed award authority (Root / Multisig).',
  },
  StandstillTooShort: { title: 'The standstill period is shorter than the procurement policy’s minimum.' },
  SubmissionPeriodTooShort: { title: 'The submission period is shorter than the procurement policy’s minimum.' },
  CloseExtensionTooLong: { title: 'That extension pushes the close past the policy’s cap.' },
  AddendumNeedsExtension: { title: 'This addendum leaves bidders too little time; it must also extend the close.' },
  TooManyCallOffs: { title: 'This panel has reached its call-off order limit.' },
  TenderNotDeletable: {
    title: 'Only a tender that was never published can be deleted.',
    hint: 'A published tender is part of the public record — use Cancel tender instead, which records a reason.',
  },
  BidNotScoreable: {
    title: 'That bid cannot be scored — it was never validly revealed.',
    hint: 'The bidder did not reveal, withdrew, or revealed content that did not match its commitment.',
  },
};

const OTHER: Record<string, Entry> = {
  'balances.InsufficientBalance': { title: 'The account does not have enough balance for this.' },
  'balances.FundsUnavailable': { title: 'The account’s funds are unavailable (reserved or locked).' },
  'sudo.RequireSudo': { title: 'Only the sudo key can dispatch this governed call.' },
  BadOrigin: {
    title: 'This call was signed by an account that is not allowed to make it.',
    hint: 'Governed calls (award, challenge resolution) must go through the sudo / multisig origin.',
  },
};

/** Patterns for failures that never reach the runtime (pool rejections, RPC, network). */
const PATTERNS: { test: RegExp; entry: Entry }[] = [
  {
    test: /Inability to pay some fees|account balance too low/i,
    entry: {
      title: 'This account cannot pay the transaction fee.',
      hint: 'Use “⛽ Fund dev accounts” in the header to top up the --dev accounts, then retry.',
    },
  },
  {
    test: /Priority is too low|1014/i,
    entry: {
      title: 'Another transaction from this account is still pending.',
      hint: 'Wait for the previous action to land in a block (about 6 seconds), then retry.',
    },
  },
  {
    test: /Transaction is outdated|Stale|1010.*Outdated/i,
    entry: { title: 'The transaction went stale before it was included.', hint: 'Retry the action.' },
  },
  {
    test: /Transaction (Invalid|Dropped|Usurped)/i,
    entry: { title: 'The node rejected or dropped the transaction.', hint: 'Retry; if it persists, check the node log.' },
  },
  {
    test: /Not connected|WebSocket|disconnected|ECONNREFUSED|No response received/i,
    entry: {
      title: 'Could not reach the TenderChain node.',
      hint: 'Check the node is running and that the header shows a live block number.',
    },
  },
  {
    test: /Cancelled|Rejected by user|User rejected/i,
    entry: { title: 'Signing was cancelled in the wallet.' },
  },
];

export function explainError(e: unknown): ErrorView {
  const message = (e instanceof Error ? e.message : String(e ?? 'Unknown error')).trim();
  const rawDocs = (e as { docs?: unknown } | null | undefined)?.docs;
  const docs = typeof rawDocs === 'string' && rawDocs.trim() ? rawDocs.trim() : undefined;

  const [section, variant] = message.includes('.') ? message.split('.', 2) : ['', message];
  const entry =
    (section === 'tenderChain' ? TENDER_CHAIN[variant] : undefined) ??
    OTHER[message] ??
    OTHER[variant] ??
    PATTERNS.find((p) => p.test.test(message))?.entry;

  if (entry) {
    return { title: entry.title, hint: entry.hint, docs: docs && docs !== entry.title ? docs : undefined, code: message };
  }
  // Not a known variant: the message itself is the most specific thing we have.
  return { title: message, docs };
}

/** One-line form, for places with no room for the structured view. */
export function describeChainError(e: unknown): string {
  const v = explainError(e);
  const parts = [v.title];
  if (v.hint) parts.push(v.hint);
  if (v.code && v.code !== v.title) parts.push(`[${v.code}]`);
  return parts.join(' ');
}
