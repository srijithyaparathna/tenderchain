// Core domain types for TenderChain.
// These mirror the shape a Substrate pallet would expose via @polkadot/api,
// using block numbers (not wall-clock time) for every gate.

export type TenderState =
  | 'Draft'
  | 'Published'
  | 'Submission'
  | 'Closed'
  | 'Opening'
  | 'Evaluation'
  | 'Awarded'
  | 'Standstill'
  | 'Contracted'
  | 'Cancelled';

export const TENDER_STATE_ORDER: TenderState[] = [
  'Draft',
  'Published',
  'Submission',
  'Closed',
  'Opening',
  'Evaluation',
  'Awarded',
  'Standstill',
  'Contracted',
];

export type TenderKind = 'RFQ' | 'RFT' | 'EOI' | 'Panel' | 'JobTask';

export const TENDER_KIND_LABEL: Record<TenderKind, string> = {
  RFQ: 'Request for Quote',
  RFT: 'Request for Tender',
  EOI: 'Expression of Interest',
  Panel: 'Panel / Standing Offer',
  JobTask: 'Job & Task Order',
};

export type BidMode = 'Sealed' | 'Open';

export type Role =
  | 'Officer'
  | 'Bidder'
  | 'Evaluator'
  | 'Governance'
  | 'Public';

export interface AccountRef {
  address: string; // SS58-style mock address
  name: string; // display label for the demo
  role: Role;
}

export interface Criterion {
  id: string;
  name: string;
  description: string;
  weight: number; // percent, all criteria for a tender sum to 100
  maxScore: number; // usually equals chain constant MaxScore
}

export interface DocumentRef {
  id: string;
  label: string;
  hash: string; // blake2_256 hex, truncated in UI
  uploadedBy: string;
  uploadedAtBlock: number;
}

export interface TenderGates {
  publishAt: number;
  questionsCloseAt: number;
  submissionCloseAt: number;
  openingAt: number;
  openingEndAt: number;
  standstillPeriod: number; // in blocks, applied after award
}

export interface EligibilityRules {
  requiredCredentials: string[];
  minReputation: number;
}

export interface BondTerms {
  amount: string; // planck-denominated string, shown formatted
  currency: string;
  forfeitOnWithdrawal: boolean;
}

export interface QAItem {
  id: string;
  askedBy: string;
  question: string;
  askedAtBlock: number;
  answer?: string;
  answeredAtBlock?: number;
  blind: boolean; // if true, asker identity hidden from other bidders
}

export interface ConflictDeclaration {
  evaluator: string;
  declaredAtBlock: number;
  hasConflict: boolean;
  notes?: string;
}

export interface CriterionScore {
  criterionId: string;
  score: number;
  commentHash: string;
}

export interface EvaluatorScoreSet {
  evaluator: string;
  bidId: string;
  scores: CriterionScore[];
  submittedAtBlock: number;
}

export interface BidCommitment {
  bidder: string;
  commitmentHash: string;
  committedAtBlock: number;
  withdrawn: boolean;
  bondPaid: boolean;
}

export interface RevealedBid {
  id: string;
  bidder: string;
  bidderName: string;
  documentsHash: string;
  priceLineItems: PriceLineItem[];
  totalPrice: number;
  salt?: string; // only ever known locally to the bidder before reveal
  revealedAtBlock?: number;
  disqualified?: boolean;
  disqualifyReason?: string;
}

export interface PriceLineItem {
  id: string;
  description: string;
  qty: number;
  unitPrice: number;
}

export type ChallengeStatus = 'Open' | 'Upheld' | 'Dismissed';

export interface Challenge {
  id: string;
  lodgedBy: string;
  lodgedAtBlock: number;
  grounds: string;
  status: ChallengeStatus;
  resolvedBy?: string;
  resolvedAtBlock?: number;
  resolutionRationale?: string;
}

export interface AwardRecord {
  awardedBidId: string;
  awardedBidder: string;
  rationale: string;
  proposedBy: string;
  proposedAtBlock: number;
  approvedByGovernance: boolean;
  approvedAtBlock?: number;
}

export interface Tender {
  id: string;
  noticeHash: string;
  title: string;
  summary: string;
  entity: string; // procuring entity name
  officer: string; // officer account address
  kind: TenderKind;
  bidMode: BidMode;
  state: TenderState;
  criteria: Criterion[];
  gates: TenderGates;
  eligibility: EligibilityRules;
  bond: BondTerms;
  documents: DocumentRef[];
  qa: QAItem[];
  blindQuestions: boolean;
  shortlistFromTenderId?: string; // EOI -> RFT chaining
  shortlistedBidders?: string[];
  evaluators: string[];
  conflictDeclarations: ConflictDeclaration[];
  commitments: BidCommitment[];
  revealedBids: RevealedBid[];
  scores: EvaluatorScoreSet[];
  award?: AwardRecord;
  challenges: Challenge[];
  createdAtBlock: number;
}

export interface ChainConstants {
  minEvaluators: number;
  minRevealWindow: number; // blocks
  maxScore: number;
  minStandstillPeriod: number; // blocks
  avgBlockTimeSeconds: number;
}
