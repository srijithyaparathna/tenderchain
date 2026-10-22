import type { Tender } from '../types';

export interface BidRanking {
  bidId: string;
  bidderName: string;
  bidder: string;
  totalPrice: number;
  weightedScore: number; // 0-100
  evaluatorCount: number;
  /** `spread` is max − min across evaluators: what the chain's variance flag measures. */
  perCriterion: { criterionId: string; name: string; weight: number; avgScore: number; maxScore: number; variance: number; spread: number }[];
}

export function computeRankings(tender: Tender): BidRanking[] {
  // Voided reveals are excluded from the ranking, exactly as the pallet's
  // `compute_ranking` excludes them.
  return tender.revealedBids
    .filter((bid) => !bid.disqualified)
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
        const spread = scoresForCriterion.length ? Math.max(...scoresForCriterion) - Math.min(...scoresForCriterion) : 0;
        return { criterionId: c.id, name: c.name, weight: c.weight, avgScore: avg, maxScore: c.maxScore, variance, spread };
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

/** The runtime's `ScoreVarianceThreshold`, used until constants arrive. */
export const VARIANCE_FLAG_THRESHOLD = 30;

/**
 * Whether submitting `myScore` will make the chain emit `ScoreVarianceFlagged`:
 * the pallet compares pairwise against every other evaluator's score on the
 * same criterion and flags any spread strictly above the threshold.
 */
export function isOutlierScore(myScore: number, peerScores: number[], threshold = VARIANCE_FLAG_THRESHOLD): boolean {
  return peerScores.some((p) => Math.abs(myScore - p) > threshold);
}
