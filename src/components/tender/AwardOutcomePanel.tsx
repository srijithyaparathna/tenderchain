import type { Tender } from '../../types';
import { Card, CardBody, CardHeader } from '../common/Card';
import { RoleGatedButton } from '../common/RoleGatedButton';
import { useApp } from '../../state/AppContext';
import { requireGovernance } from '../../lib/permissions';
import { chainApi } from '../../services/api';
import { formatBlock } from '../../lib/blocks';
import { useState } from 'react';

export function AwardOutcomePanel({ tender }: { tender: Tender }) {
  const { accounts, currentAccount } = useApp();
  const [busy, setBusy] = useState(false);
  if (!tender.award) return null;

  const nameFor = (addr: string) => accounts.find((a) => a.address === addr)?.name ?? addr;

  const approve = async () => {
    setBusy(true);
    try {
      await chainApi.approveAward(tender.id);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader
        title="Award outcome"
        right={
          tender.award.approvedByGovernance ? (
            <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">Approved</span>
          ) : (
            <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">Pending governance approval</span>
          )
        }
      />
      <CardBody>
        <div className="mb-3">
          <div className="text-xs text-slate-400">Proposed awardee</div>
          <div className="text-sm font-semibold text-slate-900">{nameFor(tender.award.awardedBidder)}</div>
        </div>
        <div className="mb-3">
          <div className="text-xs text-slate-400">Rationale</div>
          <p className="text-sm text-slate-700">{tender.award.rationale}</p>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-400">
          <span>Proposed by {nameFor(tender.award.proposedBy)} at {formatBlock(tender.award.proposedAtBlock)}</span>
          {tender.award.approvedAtBlock && <span>Approved at {formatBlock(tender.award.approvedAtBlock)}</span>}
        </div>

        {!tender.award.approvedByGovernance && (
          <div className="mt-4 rounded-md border border-purple-200 bg-purple-50 p-3">
            <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-purple-800">
              🏛 Requires governed origin (Multisig / Root)
            </div>
            <p className="mb-2.5 text-[11px] leading-snug text-purple-700">
              This step cannot be submitted as a plain signed transaction — it must be dispatched through the configured
              multisig or root origin. A normal account's call will be rejected by the runtime.
            </p>
            <RoleGatedButton variant="governance" disabledReason={requireGovernance(currentAccount)} disabled={busy} onClick={approve}>
              Approve award (governed call)
            </RoleGatedButton>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
