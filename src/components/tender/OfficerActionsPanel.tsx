import { useState } from 'react';
import type { Tender } from '../../types';
import { Card, CardBody, CardHeader } from '../common/Card';
import { RoleGatedButton } from '../common/RoleGatedButton';
import { useApp } from '../../state/AppContext';
import { requireOfficer } from '../../lib/permissions';
import { chainApi } from '../../services/api';
import { computeRankings } from '../../lib/scoring';

export function OfficerActionsPanel({ tender }: { tender: Tender }) {
  const { currentAccount, currentBlock } = useApp();
  const [busy, setBusy] = useState(false);
  const [awardBidId, setAwardBidId] = useState('');
  const [rationale, setRationale] = useState('');

  if (!currentAccount || currentAccount.role !== 'Officer' || currentAccount.address !== tender.officer) return null;

  const baseReason = requireOfficer(currentAccount, tender);

  // The pallet records the concrete end block in the outcome; the portal
  // derives it the same way the wheel does.
  const standstillEnd =
    tender.award?.approvedAtBlock !== undefined
      ? tender.award.approvedAtBlock + tender.gates.standstillPeriod
      : null;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader title="Officer actions" subtitle={tender.entity} />
      <CardBody className="space-y-3">
        {tender.state === 'Draft' && (
          <RoleGatedButton disabledReason={baseReason} disabled={busy} onClick={() => run(() => chainApi.publishTender(tender.id))}>
            Publish tender
          </RoleGatedButton>
        )}

        {tender.state === 'Closed' && (
          <RoleGatedButton
            disabledReason={baseReason || (currentBlock < tender.gates.openingAt ? `Opening block (#${tender.gates.openingAt.toLocaleString()}) not yet reached.` : undefined)}
            disabled={busy}
            onClick={() => run(() => chainApi.openTender(tender.id))}
          >
            Open tender (start reveal window)
          </RoleGatedButton>
        )}

        {tender.state === 'Evaluation' && !tender.award && (
          <div>
            <h4 className="mb-2 text-xs font-semibold text-slate-500">Ranked results</h4>
            <ul className="mb-2 space-y-1">
              {computeRankings(tender).map((r, i) => (
                <li key={r.bidId} className="flex items-center justify-between rounded-md border border-slate-100 px-2.5 py-1.5 text-sm">
                  <span>
                    <span className="mr-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-100 text-[10px] font-semibold text-slate-500">{i + 1}</span>
                    {r.bidderName}
                  </span>
                  <span className="text-xs text-slate-500">weighted {r.weightedScore.toFixed(1)} · price {r.totalPrice.toLocaleString()} · {r.evaluatorCount} scored</span>
                </li>
              ))}
            </ul>
            <select value={awardBidId} onChange={(e) => setAwardBidId(e.target.value)} className="mb-2 w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm outline-none focus:border-blue-400">
              <option value="">Select awardee…</option>
              {tender.revealedBids.map((b) => (
                <option key={b.id} value={b.id}>{b.bidderName}</option>
              ))}
            </select>
            <textarea
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
              placeholder="Award rationale (required, public record)…"
              rows={2}
              className="mb-2 w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm outline-none focus:border-blue-400"
            />
            <RoleGatedButton
              disabledReason={baseReason || (!awardBidId ? 'Select an awardee.' : !rationale.trim() ? 'Rationale is required.' : undefined)}
              disabled={busy}
              onClick={() => run(() => chainApi.proposeAward(tender.id, awardBidId, rationale.trim()))}
            >
              Propose award
            </RoleGatedButton>
          </div>
        )}

        {tender.state === 'Standstill' && tender.award && (
          <RoleGatedButton
            disabledReason={
              baseReason ||
              (tender.challenges.some((c) => c.status === 'Open')
                ? 'An open challenge suspends execution — resolve it first.'
                : standstillEnd !== null && currentBlock <= standstillEnd
                  ? `Standstill runs until block #${standstillEnd.toLocaleString()}.`
                  : undefined)
            }
            disabled={busy}
            onClick={() => run(() => chainApi.executeAward!(tender.id, `Contract for tender ${tender.id}`))}
          >
            Execute award (notarise contract)
          </RoleGatedButton>
        )}

        {!['Contracted', 'Cancelled', 'Standstill', 'Awarded'].includes(tender.state) && (
          <RoleGatedButton
            variant="danger"
            disabledReason={baseReason}
            disabled={busy}
            onClick={() => {
              if (confirm('Cancel this tender? This cannot be undone.')) run(() => chainApi.cancelTender(tender.id, 'Cancelled by officer'));
            }}
          >
            Cancel tender
          </RoleGatedButton>
        )}
      </CardBody>
    </Card>
  );
}
