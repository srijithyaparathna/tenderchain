import type { Tender } from '../types';

export interface BidRanking {
  bidId: string;
  bidderName: string;
  bidder: string;
  totalPrice: number;
  weightedScore: number; // 0-100
  evaluatorCount: number;
  perCriterion: { criterionId: string; name: string; weight: number; avgScore: number; maxScore: number; variance: number }[];
}

export function computeRankings(tender: Tender): BidRanking[] {
  return tender.revealedBids
    .map((bid) => {
      const scoreSets = tender.scores.filter((s) => s.bidId === bid.id);
      const perCriterion = tender.criteria.map((c) => {
        const scoresForCriterion = scoreSets
          .map((s) => s.scores.find((x) => x.criterionId === c.id)?.score)
          .filter((v): v is number => v !== undefined);
        const avg = scoresForCriterion.length
          ? scoresForCriterion.reduce((a, b) => a + b, 0) / scoresForCriterion.length
          : 0;
        const variance = scoresForCriterion.length
          ? Math.sqrt(scoresForCriterion.reduce((a, b) => a + (b - avg) ** 2, 0) / scoresForCriterion.length)
          : 0;
        return { criterionId: c.id, name: c.name, weight: c.weight, avgScore: avg, maxScore: c.maxScore, variance };
      });
      const weightedScore = perCriterion.reduce((sum, c) => sum + (c.avgScore / c.maxScore) * c.weight, 0);
      return {
        bidId: bid.id,
        bidderName: bid.bidderName,
        bidder: bid.bidder,
        totalPrice: bid.totalPrice,
        weightedScore,
        evaluatorCount: scoreSets.length,
        perCriterion,
      };
    })
    .sort((a, b) => b.weightedScore - a.weightedScore);
}

/** Flags an evaluator's score on a criterion as an outlier if it diverges from the peer mean by more than this many points. */
export const VARIANCE_FLAG_THRESHOLD = 15;

export function isOutlierScore(myScore: number, peerScores: number[]): boolean {
  const others = peerScores;
  if (others.length === 0) return false;
  const mean = others.reduce((a, b) => a + b, 0) / others.length;
  return Math.abs(myScore - mean) > VARIANCE_FLAG_THRESHOLD;
}
