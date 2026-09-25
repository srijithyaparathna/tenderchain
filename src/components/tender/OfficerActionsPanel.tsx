import { useState } from 'react';
import type { Tender } from '../../types';
import { Card, CardBody, CardHeader } from '../common/Card';
import { RoleGatedButton } from '../common/RoleGatedButton';
import { ActionError } from '../common/ActionError';
import { useChainAction } from '../../hooks/useChainAction';
import { useApp } from '../../state/AppContext';
import { requireOfficer } from '../../lib/permissions';
import { chainApi } from '../../services/api';
import { computeRankings } from '../../lib/scoring';

export function OfficerActionsPanel({ tender }: { tender: Tender }) {
  const { currentAccount, currentBlock } = useApp();
  const { busy, error, clearError, run } = useChainAction();
  const [awardBidId, setAwardBidId] = useState('');
  const [rationale, setRationale] = useState('');
  const [shortlist, setShortlist] = useState<string[]>([]);

  if (!currentAccount || currentAccount.role !== 'Officer' || currentAccount.address !== tender.officer) return null;

  const baseReason = requireOfficer(currentAccount, tender);

  // The pallet records the concrete end block in the outcome; the portal
  // derives it the same way the wheel does.
  const standstillEnd =
    tender.award?.approvedAtBlock !== undefined
      ? tender.award.approvedAtBlock + tender.gates.standstillPeriod
      : null;

  return (
    <Card>
      <CardHeader title="Officer actions" subtitle={tender.entity} />
      <CardBody className="space-y-3">
        {tender.state === 'Draft' && (
          <RoleGatedButton
            disabledReason={baseReason || (currentBlock < tender.gates.publishAt ? `Publish block (#${tender.gates.publishAt.toLocaleString()}) not yet reached.` : undefined)}
            disabled={busy}
            onClick={() => run(() => chainApi.publishTender(tender.id))}
          >
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

        {/*
          An EOI ends at `Shortlisted`, not at an award — `publish_shortlist`
          rejects any other kind with `NotAnEoi`, so this replaces the award
          block rather than sitting alongside it.
        */}
        {tender.state === 'Evaluation' && tender.kind === 'EOI' && (
          <div>
            <h4 className="mb-2 text-xs font-semibold text-slate-500">Shortlist suppliers</h4>
            {(() => {
              // The pallet only accepts suppliers whose reveal survived
              // validation; a disqualified one fails `InvalidShortlistEntry`.
              const eligible = tender.revealedBids.filter((b) => !b.disqualified);
              if (eligible.length === 0) {
                return <p className="mb-2 text-sm text-slate-400">No valid revealed bids to shortlist.</p>;
              }
              return (
                <ul className="mb-2 space-y-1">
                  {eligible.map((b) => (
                    <li key={b.id}>
                      <label className="flex items-center gap-2 rounded-md border border-slate-100 px-2.5 py-1.5 text-sm">
                        <input
                          type="checkbox"
                          checked={shortlist.includes(b.bidder)}
                          onChange={(e) =>
                            setShortlist((prev) =>
                              e.target.checked ? [...prev, b.bidder] : prev.filter((a) => a !== b.bidder),
                            )
                          }
                        />
                        <span>{b.bidderName}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              );
            })()}
            <RoleGatedButton
              disabledReason={baseReason || (shortlist.length === 0 ? 'Select at least one supplier.' : undefined)}
              disabled={busy}
              onClick={() => run(async () => {
                await chainApi.publishShortlist(tender.id, shortlist);
                setShortlist([]);
              })}
            >
              Publish shortlist
            </RoleGatedButton>
          </div>
        )}

        {tender.state === 'Evaluation' && !tender.award && tender.kind !== 'EOI' && (
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

        <ActionError error={error} onDismiss={clearError} />
      </CardBody>
    </Card>
  );
}
