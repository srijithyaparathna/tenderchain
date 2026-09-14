import { useState } from 'react';
import { useTenders } from '../hooks/useTenders';
import { Card, CardBody, CardHeader } from '../components/common/Card';
import { StatusBadge } from '../components/common/StatusBadge';
import { HashTag } from '../components/common/HashTag';
import { Stepper } from '../components/common/Stepper';
import { formatBlock } from '../lib/blocks';
import { useApp } from '../state/AppContext';
import { computeRankings } from '../lib/scoring';

export function PublicAuditPage() {
  const { tenders } = useTenders();
  const { accounts } = useApp();
  const [selected, setSelected] = useState('');
  const nameFor = (addr: string) => accounts.find((a) => a.address === addr)?.name ?? addr;

  const tender = tenders.find((t) => t.id === selected);

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <div className="mb-5 rounded-lg border border-slate-200 bg-slate-50 p-4">
        <h1 className="mb-1 text-xl font-semibold text-slate-900">Public probity & audit trail</h1>
        <p className="text-sm text-slate-500">
          Read-only reconstruction of a tender's complete public record — no wallet connection required. Every value shown
          here is independently verifiable against on-chain events.
        </p>
      </div>

      <label className="mb-5 block">
        <span className="mb-1 block text-xs font-medium text-slate-500">Select a tender to audit</span>
        <select value={selected} onChange={(e) => setSelected(e.target.value)} className="w-full max-w-md rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-400">
          <option value="">— Select —</option>
          {tenders.map((t) => <option key={t.id} value={t.id}>{t.id} — {t.title}</option>)}
        </select>
      </label>

      {!tender ? (
        <p className="text-sm text-slate-400">Choose a tender above to view its full public trail.</p>
      ) : (
        <div className="space-y-4">
          <Card>
            <CardHeader title={tender.title} subtitle={`${tender.entity} · ${tender.id}`} right={<StatusBadge state={tender.state} />} />
            <CardBody>
              <HashTag hash={tender.noticeHash} label="Notice hash" explain="Commitment to the tender's published notice content." />
              <div className="mt-4"><Stepper state={tender.state} /></div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Locked criteria" />
            <CardBody>
              <ul className="space-y-1 text-sm">
                {tender.criteria.map((c) => (
                  <li key={c.id} className="flex justify-between border-b border-slate-100 py-1.5">
                    <span>{c.name}</span><span className="font-medium text-slate-700">{c.weight}%</span>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Participation timeline" subtitle="Every commit, reveal and Q&A event, in order." />
            <CardBody>
              <ol className="space-y-2 border-l-2 border-slate-100 pl-4 text-sm">
                {buildTimeline(tender, nameFor).map((e, i) => (
                  <li key={i} className="relative">
                    <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-slate-300" />
                    <div className="text-[11px] text-slate-400">{formatBlock(e.block)}</div>
                    <div className="text-slate-700">{e.text}</div>
                  </li>
                ))}
              </ol>
            </CardBody>
          </Card>

          {tender.scores.length > 0 && (
            <Card>
              <CardHeader title="Evaluation scores" subtitle="Per-evaluator scores, ranked results." />
              <CardBody>
                <ul className="space-y-1.5 text-sm">
                  {computeRankings(tender).map((r, i) => (
                    <li key={r.bidId} className="flex justify-between border-b border-slate-100 py-1.5">
                      <span>#{i + 1} {r.bidderName}</span>
                      <span className="text-slate-500">weighted {r.weightedScore.toFixed(1)} · {r.evaluatorCount} evaluators</span>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          )}

          {tender.award && (
            <Card>
              <CardHeader title="Award rationale" />
              <CardBody className="text-sm">
                <p className="mb-1 text-slate-700">{tender.award.rationale}</p>
                <p className="text-xs text-slate-400">
                  Awarded to {nameFor(tender.award.awardedBidder)} · proposed {formatBlock(tender.award.proposedAtBlock)}
                  {tender.award.approvedAtBlock && ` · governance-approved ${formatBlock(tender.award.approvedAtBlock)}`}
                </p>
              </CardBody>
            </Card>
          )}

          {tender.challenges.length > 0 && (
            <Card>
              <CardHeader title="Challenges" />
              <CardBody>
                <ul className="space-y-2 text-sm">
                  {tender.challenges.map((c) => (
                    <li key={c.id} className="border-b border-slate-100 pb-2">
                      <div className="text-xs text-slate-400">{nameFor(c.lodgedBy)} · {formatBlock(c.lodgedAtBlock)} · {c.status}</div>
                      <div className="text-slate-700">{c.grounds}</div>
                      {c.resolutionRationale && <div className="mt-1 text-xs text-slate-500">Resolution: {c.resolutionRationale}</div>}
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

function buildTimeline(tender: ReturnType<typeof useTenders>['tenders'][number], nameFor: (a: string) => string) {
  const events: { block: number; text: string }[] = [];
  events.push({ block: tender.createdAtBlock, text: 'Tender created (Draft)' });
  tender.qa.forEach((qa) => {
    events.push({ block: qa.askedAtBlock, text: `Question asked by ${qa.blind ? 'anonymous bidder' : nameFor(qa.askedBy)}` });
    if (qa.answer) events.push({ block: qa.answeredAtBlock!, text: 'Question answered by officer' });
  });
  tender.commitments.forEach((c) => events.push({ block: c.committedAtBlock, text: `${nameFor(c.bidder)} committed a sealed bid` }));
  tender.revealedBids.forEach((b) => b.revealedAtBlock && events.push({ block: b.revealedAtBlock, text: `${b.bidderName} revealed bid — total ${b.totalPrice.toLocaleString()}` }));
  tender.scores.forEach((s) => events.push({ block: s.submittedAtBlock, text: `${nameFor(s.evaluator)} submitted scores` }));
  if (tender.award) {
    events.push({ block: tender.award.proposedAtBlock, text: `Award proposed to ${nameFor(tender.award.awardedBidder)}` });
    if (tender.award.approvedAtBlock) events.push({ block: tender.award.approvedAtBlock, text: 'Award approved by governance' });
  }
  tender.challenges.forEach((c) => {
    events.push({ block: c.lodgedAtBlock, text: `Challenge lodged by ${nameFor(c.lodgedBy)}` });
    if (c.resolvedAtBlock) events.push({ block: c.resolvedAtBlock, text: `Challenge ${c.status.toLowerCase()}` });
  });
  return events.sort((a, b) => a.block - b.block);
}
