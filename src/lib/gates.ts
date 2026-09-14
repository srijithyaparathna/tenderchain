import type { Tender } from '../types';

export function nextGate(t: Tender): { label: string; block: number } | null {
  switch (t.state) {
    case 'Draft':
      return { label: 'Publishes', block: t.gates.publishAt };
    case 'Published':
      return { label: 'Questions close', block: t.gates.questionsCloseAt };
    case 'Submission':
      return { label: 'Submission closes', block: t.gates.submissionCloseAt };
    case 'Closed':
      return { label: 'Opening begins', block: t.gates.openingAt };
    case 'Opening':
      return { label: 'Opening ends', block: t.gates.openingEndAt };
    case 'Standstill':
      return t.award?.approvedAtBlock !== undefined
        ? { label: 'Standstill ends', block: t.award.approvedAtBlock + t.gates.standstillPeriod }
        : null;
    default:
      return null;
  }
}

export function weightSum(criteria: Tender['criteria']): number {
  return criteria.reduce((s, c) => s + c.weight, 0);
}
