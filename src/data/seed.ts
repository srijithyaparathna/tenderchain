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

const hash = (seed: string) =>
  '0x' +
  Array.from(seed)
    .reduce((acc, ch) => (acc * 33 + ch.charCodeAt(0)) >>> 0, 5381)
    .toString(16)
    .padStart(8, '0')
    .repeat(4)
    .slice(0, 64);

let currentBlock = 128_430;

export function nowBlock() {
  return currentBlock;
}

export function tickBlock() {
  currentBlock += 1;
  return currentBlock;
}

const b = (offset: number) => currentBlock + offset;

export const SEED_TENDERS: Tender[] = [
  {
    id: 'T-1001',
    noticeHash: hash('T-1001-notice'),
    title: 'Resurfacing of Galle Road (Section 4–9)',
    summary: 'Road resurfacing, drainage repair and line-marking works over a 5.2km stretch.',
    entity: 'Department of Works',
    officer: ACCOUNTS[0].address,
    kind: 'RFT',
    bidMode: 'Sealed',
    state: 'Submission',
    criteria: [
      { id: 'c1', name: 'Technical capability', description: 'Plant, equipment and methodology', weight: 40, maxScore: 100 },
      { id: 'c2', name: 'Price', description: 'Total lump-sum price competitiveness', weight: 35, maxScore: 100 },
      { id: 'c3', name: 'Past performance', description: 'Track record on comparable works', weight: 15, maxScore: 100 },
      { id: 'c4', name: 'Local employment plan', description: 'Commitment to local labour sourcing', weight: 10, maxScore: 100 },
    ],
    gates: {
      publishAt: b(-4000),
      questionsCloseAt: b(-2200),
      submissionCloseAt: b(600),
      openingAt: b(650),
      openingEndAt: b(850),
      standstillPeriod: 150,
    },
    eligibility: { requiredCredentials: ['ICTAD-Grade-C1', 'Tax-Compliance-Cert'], minReputation: 60 },
    bond: { amount: '2,500,000', currency: 'LKR', forfeitOnWithdrawal: true },
    documents: [
      { id: 'd1', label: 'Notice of Tender.pdf', hash: hash('d1-notice'), uploadedBy: ACCOUNTS[0].address, uploadedAtBlock: b(-4000) },
      { id: 'd2', label: 'Drawings & Specifications.zip', hash: hash('d2-specs'), uploadedBy: ACCOUNTS[0].address, uploadedAtBlock: b(-4000) },
      { id: 'd3', label: 'Bill of Quantities.xlsx', hash: hash('d3-boq'), uploadedBy: ACCOUNTS[0].address, uploadedAtBlock: b(-3990) },
    ],
    qa: [
      {
        id: 'q1',
        askedBy: ACCOUNTS[2].address,
        question: 'Can the bond be provided as a bank guarantee rather than cash deposit?',
        askedAtBlock: b(-3000),
        answer: 'Yes, an unconditional bank guarantee from a licensed commercial bank is acceptable.',
        answeredAtBlock: b(-2950),
        blind: false,
      },
      {
        id: 'q2',
        askedBy: ACCOUNTS[3].address,
        question: 'Is night-time working permitted on Section 6?',
        askedAtBlock: b(-2800),
        blind: true,
      },
    ],
    blindQuestions: true,
    evaluators: [ACCOUNTS[5].address, ACCOUNTS[6].address, ACCOUNTS[7].address],
    conflictDeclarations: [
      { evaluator: ACCOUNTS[5].address, declaredAtBlock: b(-3900), hasConflict: false },
      { evaluator: ACCOUNTS[6].address, declaredAtBlock: b(-3900), hasConflict: false },
    ],
    commitments: [
      { bidder: ACCOUNTS[2].address, commitmentHash: hash('bid-t1001-buildco'), committedAtBlock: b(-500), withdrawn: false, bondPaid: true },
      { bidder: ACCOUNTS[3].address, commitmentHash: hash('bid-t1001-skyline'), committedAtBlock: b(-400), withdrawn: false, bondPaid: true },
    ],
    revealedBids: [],
    scores: [],
    challenges: [],
    createdAtBlock: b(-4100),
  },
  {
    id: 'T-1002',
    noticeHash: hash('T-1002-notice'),
    title: 'Supply of Laboratory Reagents (Annual Panel)',
    summary: 'Standing offer panel for supply of chemical reagents to municipal testing labs.',
    entity: 'City Council Health Division',
    officer: ACCOUNTS[1].address,
    kind: 'Panel',
    bidMode: 'Open',
    state: 'Evaluation',
    criteria: [
      { id: 'c1', name: 'Unit pricing', description: 'Competitiveness across catalogue items', weight: 50, maxScore: 100 },
      { id: 'c2', name: 'Delivery reliability', description: 'Lead time and logistics network', weight: 30, maxScore: 100 },
      { id: 'c3', name: 'Quality certification', description: 'ISO/GMP certification coverage', weight: 20, maxScore: 100 },
    ],
    gates: {
      publishAt: b(-9000),
      questionsCloseAt: b(-7500),
      submissionCloseAt: b(-5000),
      openingAt: b(-4900),
      openingEndAt: b(-4700),
      standstillPeriod: 150,
    },
    eligibility: { requiredCredentials: ['GMP-Certified'], minReputation: 50 },
    bond: { amount: '400,000', currency: 'LKR', forfeitOnWithdrawal: false },
    documents: [
      { id: 'd1', label: 'Reagent Catalogue Template.xlsx', hash: hash('t1002-d1'), uploadedBy: ACCOUNTS[1].address, uploadedAtBlock: b(-9000) },
    ],
    qa: [],
    blindQuestions: false,
    evaluators: [ACCOUNTS[5].address, ACCOUNTS[6].address, ACCOUNTS[7].address],
    conflictDeclarations: [
      { evaluator: ACCOUNTS[5].address, declaredAtBlock: b(-4600), hasConflict: false },
      { evaluator: ACCOUNTS[6].address, declaredAtBlock: b(-4600), hasConflict: false },
      { evaluator: ACCOUNTS[7].address, declaredAtBlock: b(-4600), hasConflict: true, notes: 'Spouse employed by one bidder — recused from scoring that line.' },
    ],
    commitments: [
      { bidder: ACCOUNTS[2].address, commitmentHash: hash('t1002-buildco'), committedAtBlock: b(-5200), withdrawn: false, bondPaid: true },
      { bidder: ACCOUNTS[4].address, commitmentHash: hash('t1002-horizon'), committedAtBlock: b(-5100), withdrawn: false, bondPaid: true },
    ],
    revealedBids: [
      {
        id: 'bid-1', bidder: ACCOUNTS[2].address, bidderName: ACCOUNTS[2].name,
        documentsHash: hash('t1002-buildco-docs'),
        priceLineItems: [
          { id: 'l1', description: 'Sodium Chloride 500g (case of 20)', qty: 200, unitPrice: 1850 },
          { id: 'l2', description: 'Ethanol 99% 1L', qty: 500, unitPrice: 940 },
        ],
        totalPrice: 200 * 1850 + 500 * 940,
        revealedAtBlock: b(-4800),
      },
      {
        id: 'bid-2', bidder: ACCOUNTS[4].address, bidderName: ACCOUNTS[4].name,
        documentsHash: hash('t1002-horizon-docs'),
        priceLineItems: [
          { id: 'l1', description: 'Sodium Chloride 500g (case of 20)', qty: 200, unitPrice: 1790 },
          { id: 'l2', description: 'Ethanol 99% 1L', qty: 500, unitPrice: 980 },
        ],
        totalPrice: 200 * 1790 + 500 * 980,
        revealedAtBlock: b(-4790),
      },
    ],
    scores: [
      {
        evaluator: ACCOUNTS[5].address, bidId: 'bid-1', submittedAtBlock: b(-4500),
        scores: [
          { criterionId: 'c1', score: 78, commentHash: hash('score-c1-bid1-e1') },
          { criterionId: 'c2', score: 85, commentHash: hash('score-c2-bid1-e1') },
          { criterionId: 'c3', score: 90, commentHash: hash('score-c3-bid1-e1') },
        ],
      },
      {
        evaluator: ACCOUNTS[6].address, bidId: 'bid-1', submittedAtBlock: b(-4480),
        scores: [
          { criterionId: 'c1', score: 74, commentHash: hash('score-c1-bid1-e2') },
          { criterionId: 'c2', score: 80, commentHash: hash('score-c2-bid1-e2') },
          { criterionId: 'c3', score: 88, commentHash: hash('score-c3-bid1-e2') },
        ],
      },
    ],
    challenges: [],
    createdAtBlock: b(-9100),
  },
  {
    id: 'T-1003',
    noticeHash: hash('T-1003-notice'),
    title: 'Design-Build of Community Library — Ward 7',
    summary: 'Turnkey design and construction of a 1,200sqm public library and reading hall.',
    entity: 'City Council',
    officer: ACCOUNTS[1].address,
    kind: 'RFT',
    bidMode: 'Sealed',
    state: 'Standstill',
    criteria: [
      { id: 'c1', name: 'Design quality', description: 'Architectural merit and accessibility', weight: 30, maxScore: 100 },
      { id: 'c2', name: 'Price', description: 'Total project cost', weight: 40, maxScore: 100 },
      { id: 'c3', name: 'Programme', description: 'Delivery timeline realism', weight: 20, maxScore: 100 },
      { id: 'c4', name: 'Sustainability', description: 'Green building features', weight: 10, maxScore: 100 },
    ],
    gates: {
      publishAt: b(-20000),
      questionsCloseAt: b(-18000),
      submissionCloseAt: b(-14000),
      openingAt: b(-13900),
      openingEndAt: b(-13600),
      standstillPeriod: 150,
    },
    eligibility: { requiredCredentials: ['ICTAD-Grade-C1'], minReputation: 70 },
    bond: { amount: '5,000,000', currency: 'LKR', forfeitOnWithdrawal: true },
    documents: [
      { id: 'd1', label: 'Notice of Tender.pdf', hash: hash('t1003-d1'), uploadedBy: ACCOUNTS[1].address, uploadedAtBlock: b(-20000) },
    ],
    qa: [],
    blindQuestions: false,
    evaluators: [ACCOUNTS[5].address, ACCOUNTS[6].address, ACCOUNTS[7].address],
    conflictDeclarations: [
      { evaluator: ACCOUNTS[5].address, declaredAtBlock: b(-13700), hasConflict: false },
      { evaluator: ACCOUNTS[6].address, declaredAtBlock: b(-13700), hasConflict: false },
      { evaluator: ACCOUNTS[7].address, declaredAtBlock: b(-13700), hasConflict: false },
    ],
    commitments: [
      { bidder: ACCOUNTS[2].address, commitmentHash: hash('t1003-buildco'), committedAtBlock: b(-14200), withdrawn: false, bondPaid: true },
      { bidder: ACCOUNTS[3].address, commitmentHash: hash('t1003-skyline'), committedAtBlock: b(-14100), withdrawn: false, bondPaid: true },
    ],
    revealedBids: [
      {
        id: 'bid-1', bidder: ACCOUNTS[2].address, bidderName: ACCOUNTS[2].name,
        documentsHash: hash('t1003-buildco-docs'),
        priceLineItems: [{ id: 'l1', description: 'Lump sum design-build', qty: 1, unitPrice: 148_000_000 }],
        totalPrice: 148_000_000,
        revealedAtBlock: b(-13800),
      },
      {
        id: 'bid-2', bidder: ACCOUNTS[3].address, bidderName: ACCOUNTS[3].name,
        documentsHash: hash('t1003-skyline-docs'),
        priceLineItems: [{ id: 'l1', description: 'Lump sum design-build', qty: 1, unitPrice: 152_500_000 }],
        totalPrice: 152_500_000,
        revealedAtBlock: b(-13790),
      },
    ],
    scores: [
      { evaluator: ACCOUNTS[5].address, bidId: 'bid-1', submittedAtBlock: b(-13000), scores: [
        { criterionId: 'c1', score: 88, commentHash: hash('a') }, { criterionId: 'c2', score: 92, commentHash: hash('b') },
        { criterionId: 'c3', score: 80, commentHash: hash('c') }, { criterionId: 'c4', score: 70, commentHash: hash('d') },
      ]},
      { evaluator: ACCOUNTS[6].address, bidId: 'bid-1', submittedAtBlock: b(-12990), scores: [
        { criterionId: 'c1', score: 85, commentHash: hash('e') }, { criterionId: 'c2', score: 90, commentHash: hash('f') },
        { criterionId: 'c3', score: 82, commentHash: hash('g') }, { criterionId: 'c4', score: 72, commentHash: hash('h') },
      ]},
      { evaluator: ACCOUNTS[7].address, bidId: 'bid-1', submittedAtBlock: b(-12980), scores: [
        { criterionId: 'c1', score: 86, commentHash: hash('i') }, { criterionId: 'c2', score: 91, commentHash: hash('j') },
        { criterionId: 'c3', score: 79, commentHash: hash('k') }, { criterionId: 'c4', score: 71, commentHash: hash('l') },
      ]},
      { evaluator: ACCOUNTS[5].address, bidId: 'bid-2', submittedAtBlock: b(-13000), scores: [
        { criterionId: 'c1', score: 76, commentHash: hash('m') }, { criterionId: 'c2', score: 84, commentHash: hash('n') },
        { criterionId: 'c3', score: 88, commentHash: hash('o') }, { criterionId: 'c4', score: 65, commentHash: hash('p') },
      ]},
    ],
    award: {
      awardedBidId: 'bid-1',
      awardedBidder: ACCOUNTS[2].address,
      rationale: 'Highest weighted score (87.9) with strongest design quality and acceptable price premium within budget envelope.',
      proposedBy: ACCOUNTS[1].address,
      proposedAtBlock: b(-12500),
      approvedByGovernance: true,
      approvedAtBlock: b(-12450),
    },
    challenges: [
      {
        id: 'ch1',
        lodgedBy: ACCOUNTS[3].address,
        lodgedAtBlock: b(-12300),
        grounds: 'Requesting review of price-scoring methodology; alleges normalization formula favours higher bids.',
        status: 'Open',
      },
    ],
    createdAtBlock: b(-20100),
  },
  {
    id: 'T-1004',
    noticeHash: hash('T-1004-notice'),
    title: 'IT Helpdesk Support Services — 2 Year Term',
    summary: 'Managed helpdesk and desktop support for 14 municipal offices.',
    entity: 'City Council',
    officer: ACCOUNTS[1].address,
    kind: 'RFQ',
    bidMode: 'Open',
    state: 'Published',
    criteria: [
      { id: 'c1', name: 'Price', description: 'Total contract value', weight: 60, maxScore: 100 },
      { id: 'c2', name: 'Response SLA', description: 'Guaranteed response times', weight: 40, maxScore: 100 },
    ],
    gates: {
      publishAt: b(-1000),
      questionsCloseAt: b(800),
      submissionCloseAt: b(1600),
      openingAt: b(1650),
      openingEndAt: b(1750),
      standstillPeriod: 100,
    },
    eligibility: { requiredCredentials: [], minReputation: 30 },
    bond: { amount: '150,000', currency: 'LKR', forfeitOnWithdrawal: false },
    documents: [
      { id: 'd1', label: 'Scope of Work.pdf', hash: hash('t1004-d1'), uploadedBy: ACCOUNTS[1].address, uploadedAtBlock: b(-1000) },
    ],
    qa: [
      { id: 'q1', askedBy: ACCOUNTS[4].address, question: 'Is remote support acceptable outside business hours?', askedAtBlock: b(-800), blind: false },
    ],
    blindQuestions: false,
    evaluators: [ACCOUNTS[5].address, ACCOUNTS[7].address],
    conflictDeclarations: [],
    commitments: [],
    revealedBids: [],
    scores: [],
    challenges: [],
    createdAtBlock: b(-1100),
  },
  {
    id: 'T-1005',
    noticeHash: hash('T-1005-notice'),
    title: 'Flood Mitigation Study — Kelani River Basin (EOI)',
    summary: 'Expression of interest to shortlist consultants for a hydrological modelling study.',
    entity: 'Department of Works',
    officer: ACCOUNTS[0].address,
    kind: 'EOI',
    bidMode: 'Open',
    state: 'Draft',
    criteria: [
      { id: 'c1', name: 'Technical expertise', description: 'Relevant hydrology experience', weight: 70, maxScore: 100 },
      { id: 'c2', name: 'Capacity', description: 'Team size and availability', weight: 30, maxScore: 100 },
    ],
    gates: {
      publishAt: b(300),
      questionsCloseAt: b(1200),
      submissionCloseAt: b(2200),
      openingAt: b(2250),
      openingEndAt: b(2350),
      standstillPeriod: 100,
    },
    eligibility: { requiredCredentials: ['Chartered-Engineer'], minReputation: 65 },
    bond: { amount: '0', currency: 'LKR', forfeitOnWithdrawal: false },
    documents: [],
    qa: [],
    blindQuestions: true,
    evaluators: [],
    conflictDeclarations: [],
    commitments: [],
    revealedBids: [],
    scores: [],
    challenges: [],
    createdAtBlock: b(-50),
  },
  {
    id: 'T-1006',
    noticeHash: hash('T-1006-notice'),
    title: 'Office Stationery Supply — Q3 Bulk Order',
    summary: 'One-off bulk purchase of office stationery for all council branches.',
    entity: 'City Council',
    officer: ACCOUNTS[1].address,
    kind: 'JobTask',
    bidMode: 'Open',
    state: 'Cancelled',
    criteria: [
      { id: 'c1', name: 'Price', description: 'Lowest conforming price', weight: 100, maxScore: 100 },
    ],
    gates: {
      publishAt: b(-6000),
      questionsCloseAt: b(-5500),
      submissionCloseAt: b(-5000),
      openingAt: b(-4950),
      openingEndAt: b(-4900),
      standstillPeriod: 80,
    },
    eligibility: { requiredCredentials: [], minReputation: 0 },
    bond: { amount: '0', currency: 'LKR', forfeitOnWithdrawal: false },
    documents: [],
    qa: [],
    blindQuestions: false,
    evaluators: [],
    conflictDeclarations: [],
    commitments: [],
    revealedBids: [],
    scores: [],
    challenges: [],
    createdAtBlock: b(-6100),
  },
];
