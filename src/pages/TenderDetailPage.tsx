import { shortHash } from '../services/contentStore';
import { Link, useParams } from 'react-router-dom';
import { useTender } from '../hooks/useTenders';
import { StatusBadge } from '../components/common/StatusBadge';
import { HashTag } from '../components/common/HashTag';
import { Stepper } from '../components/common/Stepper';
import { Card, CardBody, CardHeader } from '../components/common/Card';
import { GatesPanel } from '../components/tender/GatesPanel';
import { CriteriaPanel } from '../components/tender/CriteriaPanel';
import { DocumentsPanel } from '../components/tender/DocumentsPanel';
import { QAPanel } from '../components/tender/QAPanel';
import { BiddersPanel } from '../components/tender/BiddersPanel';
import { EvaluatorPanel } from '../components/tender/EvaluatorPanel';
import { AwardOutcomePanel } from '../components/tender/AwardOutcomePanel';
import { ChallengeLogPanel } from '../components/tender/ChallengeLogPanel';
import { OfficerActionsPanel } from '../components/tender/OfficerActionsPanel';
import { BidActionPanel } from '../components/tender/BidActionPanel';
import { EvaluatorScoringPanel } from '../components/tender/EvaluatorScoringPanel';
import { TENDER_KIND_LABEL, type Tender } from '../types';
import { useApp } from '../state/AppContext';
import { computeRankings, type BidRanking } from '../lib/scoring';

export function TenderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { tender, loading } = useTender(id);
  const { accounts } = useApp();

  if (loading) return <div className="py-20 text-center text-sm text-slate-400">Loading…</div>;
  if (!tender) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center">
        <p className="text-sm text-slate-500">Tender not found.</p>
        <Link to="/" className="mt-2 inline-block text-sm text-blue-600 hover:underline">← Back to marketplace</Link>
      </div>
    );
  }

  const officerName = accounts.find((a) => a.address === tender.officer)?.name ?? tender.officer;

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <Link to="/" className="mb-3 inline-block text-xs text-slate-400 hover:text-slate-600">← All tenders</Link>

      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="mb-1.5 flex items-center gap-2">
            <StatusBadge state={tender.state} />
            <span className="text-xs font-medium text-slate-400">{TENDER_KIND_LABEL[tender.kind]} · {tender.bidMode} bidding</span>
          </div>
          <h1 className="text-xl font-semibold text-slate-900">{tender.title}</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">{tender.summary}</p>
          <p className="mt-1.5 text-xs text-slate-400">{tender.entity} · Officer: {officerName} · <span className="mono" title={tender.id}>{shortHash(tender.id)}</span></p>
        </div>
        <div className="text-right">
          <HashTag hash={tender.noticeHash} explain="Notice hash — the on-chain commitment to this tender's published notice." label="Notice" />
        </div>
      </div>

      <Card className="mb-5">
        <CardBody>
          <Stepper state={tender.state} />
        </CardBody>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <CriteriaPanel tender={tender} />
          <GatesPanel tender={tender} />
          <DocumentsPanel tender={tender} />
          <QAPanel tender={tender} />
          <BiddersPanel tender={tender} />
          <EvaluatorPanel tender={tender} />
          {tender.scores.length > 0 && <ScoresBreakdown tender={tender} />}
          <AwardOutcomePanel tender={tender} />
          <ChallengeLogPanel tender={tender} />
        </div>

        <div className="space-y-4">
          <OfficerActionsPanel tender={tender} />
          <BidActionPanel tender={tender} />
          <EvaluatorScoringPanel tender={tender} />
          <EligibilityCard tender={tender} />
        </div>
      </div>
    </div>
  );
}

function EligibilityCard({ tender }: { tender: Tender }) {
  return (
    <Card>
      <CardHeader title="Eligibility & bond" />
      <CardBody className="space-y-2 text-sm">
        <div>
          <div className="text-xs text-slate-400">Required credentials</div>
          {tender.eligibility.requiredCredentials.length ? (
            <div className="mt-1 flex flex-wrap gap-1">
              {tender.eligibility.requiredCredentials.map((c) => (
                <span key={c} className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">{c}</span>
              ))}
            </div>
          ) : (
            <span className="text-slate-500">None</span>
          )}
        </div>
        <div className="flex justify-between text-xs text-slate-500">
          <span>Min. reputation</span><span className="font-medium text-slate-700">{tender.eligibility.minReputation}</span>
        </div>
        <div className="flex justify-between text-xs text-slate-500">
          <span>Bid bond</span><span className="font-medium text-slate-700">{tender.bond.amount} {tender.bond.currency}</span>
        </div>
        <div className="flex justify-between text-xs text-slate-500">
          <span>Forfeit on withdrawal</span><span className="font-medium text-slate-700">{tender.bond.forfeitOnWithdrawal ? 'Yes' : 'No'}</span>
        </div>
      </CardBody>
    </Card>
  );
}

function ScoresBreakdown({ tender }: { tender: Tender }) {
  const rankings = computeRankings(tender);
  return (
    <Card>
      <CardHeader title="Evaluation results" subtitle="Weighted score = Σ (average criterion score / max score × weight)." />
      <CardBody>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-400">
                <th className="pb-2 font-medium">Rank</th>
                <th className="pb-2 font-medium">Bidder</th>
                {tender.criteria.map((c) => (
                  <th key={c.id} className="pb-2 font-medium">{c.name}</th>
                ))}
                <th className="pb-2 font-medium">Weighted score</th>
              </tr>
            </thead>
            <tbody>
              {rankings.map((r: BidRanking, i: number) => (
                <tr key={r.bidId} className="border-t border-slate-100">
                  <td className="py-2 pr-3 font-medium text-slate-500">#{i + 1}</td>
                  <td className="py-2 pr-3 text-slate-800">{r.bidderName}</td>
                  {r.perCriterion.map((c) => (
                    <td key={c.criterionId} className="py-2 pr-3 text-slate-600">
                      {c.avgScore.toFixed(0)}/{c.maxScore}
                      {c.variance > 15 && <span title="High variance between evaluators" className="ml-1 text-amber-500">⚠</span>}
                    </td>
                  ))}
                  <td className="py-2 font-semibold text-slate-900">{r.weightedScore.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardBody>
    </Card>
  );
}
