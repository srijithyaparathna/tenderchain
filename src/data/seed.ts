import type {
  AccountRef,
  ChainConstants,
  Tender,
} from '../types';

export const CONSTANTS: ChainConstants = {
  minEvaluators: 3,
  minRevealWindow: 200,
  maxScore: 100,
  minStandstillPeriod: 150,
  avgBlockTimeSeconds: 6,
};

// Demo accounts covering every role. In a real integration these come from
// the injected wallet extension (polkadot{.js} accounts), not a fixed list.
export const ACCOUNTS: AccountRef[] = [
  { address: '5FOfficer1DeptOfWorks', name: 'A. Fernando (Dept. of Works)', role: 'Officer' },
  { address: '5FOfficer2CityCouncil', name: 'M. Perera (City Council)', role: 'Officer' },
  { address: '5FBidder1BuildCo', name: 'BuildCo Pvt Ltd', role: 'Bidder' },
  { address: '5FBidder2Skyline', name: 'Skyline Construction', role: 'Bidder' },
  { address: '5FBidder3Horizon', name: 'Horizon Infra Group', role: 'Bidder' },
  { address: '5FEval1JDoe', name: 'Dr. J. Doe (Eng.)', role: 'Evaluator' },
  { address: '5FEval2KSilva', name: 'K. Silva (Finance)', role: 'Evaluator' },
  { address: '5FEval3RKumar', name: 'R. Kumar (Legal)', role: 'Evaluator' },
  { address: '5FGov1Multisig', name: 'Procurement Oversight Multisig', role: 'Governance' },
  { address: '5FPublicObserver', name: 'Public Observer', role: 'Public' },
];

let currentBlock = 128_430;

export function nowBlock() {
  return currentBlock;
}

export function tickBlock() {
  currentBlock += 1;
  return currentBlock;
}

// The portal starts empty: tenders come from the Create Tender wizard.
export const SEED_TENDERS: Tender[] = [];
