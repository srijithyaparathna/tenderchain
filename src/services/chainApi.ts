// The swap-in seam: everything above this file talks to `ChainApi` only.
// Replace `mockChainApi` with a real @polkadot/api-backed implementation
// (subscribing to storage, submitting extrinsics, decoding events) without
// touching any component or page.

import type {
  AccountRef,
  Challenge,
  ChainConstants,
  Tender,
} from '../types';

export interface CreateTenderInput {
  title: string;
  summary: string;
  entity: string;
  officer: string;
  kind: Tender['kind'];
  bidMode: Tender['bidMode'];
  criteria: Tender['criteria'];
  gates: Tender['gates'];
  eligibility: Tender['eligibility'];
  bond: Tender['bond'];
  blindQuestions: boolean;
  shortlistFromTenderId?: string;
}

export interface SubmitScoreInput {
  tenderId: string;
  evaluator: string;
  bidId: string;
  scores: { criterionId: string; score: number; commentHash: string }[];
}

export interface ChainApi {
  // reads
  getConstants(): Promise<ChainConstants>;
  getCurrentBlock(): number;
  /** Finality trails the best block; 0 when there is no real chain. */
  getFinalizedBlock(): number;
  subscribeBlock(cb: (block: number) => void): () => void;
  listAccounts(): AccountRef[];
  /** Accounts arrive asynchronously once a wallet/keyring is resolved. */
  subscribeAccounts(cb: (accounts: AccountRef[]) => void): () => void;
  /** Where `listAccounts()` came from, when backed by a real node. */
  getAccountSource?(): 'extension' | 'dev' | null;
  /**
   * A misconfiguration that leaves the portal connected but unusable — a node
   * whose runtime has no TenderChain pallet, say. Null when nothing is wrong.
   */
  subscribeChainError?(cb: (error: string | null) => void): () => void;
  listTenders(): Promise<Tender[]>;
  getTender(id: string): Promise<Tender | undefined>;
  subscribeTenders(cb: (tenders: Tender[]) => void): () => void;

  // officer actions
  createTender(input: CreateTenderInput): Promise<Tender>;
  publishTender(id: string): Promise<void>;
  cancelTender(id: string, reason: string): Promise<void>;
  answerQuestion(id: string, qaId: string, answer: string): Promise<void>;
  appointEvaluator(id: string, evaluator: string): Promise<void>;
  openTender(id: string): Promise<void>;
  publishShortlist(id: string, bidderAddresses: string[]): Promise<void>;
  proposeAward(id: string, bidId: string, rationale: string): Promise<void>;

  // bidder actions
  askQuestion(id: string, asker: string, question: string, blind: boolean): Promise<void>;
  commitBid(id: string, bidder: string, commitmentHash: string): Promise<void>;
  withdrawCommitment(id: string, bidder: string): Promise<void>;
  revealBid(id: string, bidder: string, payload: { documentsHash: string; priceLineItems: { id: string; description: string; qty: number; unitPrice: number }[]; salt?: string }): Promise<void>;
  submitOpenBid(id: string, bidder: string, payload: { documentsHash: string; priceLineItems: { id: string; description: string; qty: number; unitPrice: number }[] }): Promise<void>;
  lodgeChallenge(id: string, lodgedBy: string, grounds: string): Promise<void>;

  // evaluator actions
  declareConflict(id: string, evaluator: string, hasConflict: boolean, notes?: string): Promise<void>;
  submitScores(input: SubmitScoreInput): Promise<void>;

  // governance actions (requires governed origin — multisig/root, distinct from a normal signed call)
  approveAward(id: string): Promise<void>;
  resolveChallenge(id: string, challengeId: string, status: Extract<Challenge['status'], 'Upheld' | 'Dismissed'>, rationale: string): Promise<void>;

  /** Top up unfunded `--dev` accounts so they can pay fees. Live chain only. */
  fundDevAccounts?(): Promise<string[]>;
  /** Post-standstill contract notarisation. Live chain only. */
  executeAward?(id: string, contractText?: string): Promise<void>;
  /** The pallet's sealed-bid commitment preimage. Live chain only. */
  buildCommitment?(
    bidder: string,
    documentsHash: string,
    priceLineItems: { id: string; description: string; qty: number; unitPrice: number }[],
    salt: string,
  ): string;

  // demo-only: advance the simulated chain clock
  advanceBlocks(n: number): void;
}
