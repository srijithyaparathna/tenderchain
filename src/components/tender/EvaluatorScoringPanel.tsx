import { useState } from 'react';
import type { Tender } from '../../types';
import { Card, CardBody, CardHeader } from '../common/Card';
import { RoleGatedButton } from '../common/RoleGatedButton';
import { useApp } from '../../state/AppContext';
import { requireEvaluator } from '../../lib/permissions';
import { chainApi } from '../../services/api';
import { contentHash } from '../../lib/hashing';
import { isOutlierScore } from '../../lib/scoring';

export function EvaluatorScoringPanel({ tender }: { tender: Tender }) {
  const { currentAccount } = useApp();
  const [notes, setNotes] = useState('');
  const [bidId, setBidId] = useState('');
  const [scores, setScores] = useState<Record<string, number>>({});
  const [comments, setComments] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  if (!currentAccount || currentAccount.role !== 'Evaluator' || !tender.evaluators.includes(currentAccount.address)) return null;

  const gateReason = requireEvaluator(currentAccount, tender);
  const myDeclaration = tender.conflictDeclarations.find((c) => c.evaluator === currentAccount.address);
  const maxScore = tender.criteria[0]?.maxScore ?? 100;

  const declareConflict = async (conflict: boolean) => {
    setBusy(true);
    try {
      await chainApi.declareConflict(tender.id, currentAccount.address, conflict, notes.trim() || undefined);
    } finally {
      setBusy(false);
    }
  };

  if (!myDeclaration) {
    return (
      <Card>
        <CardHeader title="Conflict of interest declaration" subtitle="Required before you can score any bid on this tender." />
        <CardBody>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional notes (e.g. relationship details, if any)…"
            rows={2}
            className="mb-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-400"
          />
          <div className="flex gap-2">
            <RoleGatedButton disabledReason={gateReason} disabled={busy} onClick={() => declareConflict(false)}>
              Declare: no conflict
            </RoleGatedButton>
            <RoleGatedButton variant="danger" disabledReason={gateReason} disabled={busy} onClick={() => declareConflict(true)}>
              Declare: I have a conflict
            </RoleGatedButton>
          </div>
        </CardBody>
      </Card>
    );
  }

  if (myDeclaration.hasConflict) {
    return (
      <Card>
        <CardHeader title="Scoring unavailable" />
        <CardBody>
          <p className="rounded-md bg-red-50 p-2.5 text-sm text-red-700">
            You declared a conflict of interest on this tender and are recused from scoring.
          </p>
        </CardBody>
      </Card>
    );
  }

  if (tender.state !== 'Evaluation') {
    return (
      <Card>
        <CardHeader title="Score bids" />
        <CardBody>
          <p className="text-sm text-slate-400">Scoring opens once the tender enters the Evaluation stage (currently: {tender.state}).</p>
        </CardBody>
      </Card>
    );
  }

  const submit = async () => {
    if (!bidId) return;
    setBusy(true);
    try {
      await chainApi.submitScores({
        tenderId: tender.id,
        evaluator: currentAccount.address,
        bidId,
        scores: tender.criteria.map((c) => ({
          criterionId: c.id,
          score: Math.min(c.maxScore, Math.max(0, scores[c.id] ?? 0)),
          commentHash: contentHash(comments[c.id] ?? ''),
        })),
      });
      setBidId('');
      setScores({});
      setComments({});
    } finally {
      setBusy(false);
    }
  };

  const already = tender.scores.find((s) => s.evaluator === currentAccount.address && s.bidId === bidId);

  return (
    <Card>
      <CardHeader title="Score bids" subtitle={`Max ${maxScore} per criterion, capped automatically.`} />
      <CardBody>
        <label className="mb-1 block text-xs font-medium text-slate-500">Bid</label>
        <select value={bidId} onChange={(e) => setBidId(e.target.value)} className="mb-3 w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm outline-none focus:border-blue-400">
          <option value="">Select a bid to score…</option>
          {tender.revealedBids.map((b) => (
            <option key={b.id} value={b.id}>{b.bidderName} — {b.totalPrice.toLocaleString()}</option>
          ))}
        </select>

        {already && (
          <p className="mb-2 rounded-md bg-blue-50 p-2 text-xs text-blue-700">You already scored this bid — resubmitting will overwrite it.</p>
        )}

        {bidId && (
          <div className="space-y-3">
            {tender.criteria.map((c) => {
              const peerScores = tender.scores
                .filter((s) => s.bidId === bidId && s.evaluator !== currentAccount.address)
                .map((s) => s.scores.find((x) => x.criterionId === c.id)?.score)
                .filter((v): v is number => v !== undefined);
              const myScore = scores[c.id] ?? 0;
              const outlier = peerScores.length > 0 && isOutlierScore(myScore, peerScores);
              return (
                <div key={c.id} className="rounded-md border border-slate-100 p-2.5">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-sm font-medium text-slate-700">{c.name} <span className="text-xs text-slate-400">({c.weight}%)</span></span>
                    {outlier && (
                      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700" title="This score diverges significantly from other evaluators' scores on this criterion.">
                        ⚠ Variance flag
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={0}
                      max={c.maxScore}
                      value={scores[c.id] ?? ''}
                      onChange={(e) => setScores({ ...scores, [c.id]: Math.min(c.maxScore, Math.max(0, Number(e.target.value))) })}
                      className="w-20 rounded-md border border-slate-300 px-2 py-1 text-sm outline-none focus:border-blue-400"
                    />
                    <span className="text-xs text-slate-400">/ {c.maxScore}</span>
                    <input
                      value={comments[c.id] ?? ''}
                      onChange={(e) => setComments({ ...comments, [c.id]: e.target.value })}
                      placeholder="Comment (hashed before submission)…"
                      className="flex-1 rounded-md border border-slate-300 px-2 py-1 text-xs outline-none focus:border-blue-400"
                    />
                  </div>
                  {peerScores.length > 0 && (
                    <div className="mt-1 text-[11px] text-slate-400">Peer scores so far: {peerScores.join(', ')}</div>
                  )}
                </div>
              );
            })}
            <RoleGatedButton disabledReason={gateReason} disabled={busy} onClick={submit}>Submit scores</RoleGatedButton>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
