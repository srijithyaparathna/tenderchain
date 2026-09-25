import { useState } from 'react';
import type { Tender } from '../../types';
import { Card, CardBody, CardHeader } from '../common/Card';
import { RoleGatedButton } from '../common/RoleGatedButton';
import { ActionError } from '../common/ActionError';
import { useChainAction } from '../../hooks/useChainAction';
import { HashTag } from '../common/HashTag';
import { useApp } from '../../state/AppContext';
import { requireBidder } from '../../lib/permissions';
import { chainApi } from '../../services/api';
import { contentHash, randomSalt } from '../../lib/hashing';
import { loadLocalSealedBid, saveLocalSealedBid, clearLocalSealedBid, type LocalSealedBid } from '../../lib/localBidStore';

interface LineItem { id: string; description: string; qty: number; unitPrice: number }

function LineItemsEditor({ items, setItems }: { items: LineItem[]; setItems: (v: LineItem[]) => void }) {
  const update = (id: string, patch: Partial<LineItem>) =>
    setItems(items.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  const total = items.reduce((s, i) => s + i.qty * i.unitPrice, 0);

  return (
    <div>
      <div className="space-y-1.5">
        {items.map((item) => (
          <div key={item.id} className="flex items-center gap-1.5">
            <input
              value={item.description}
              onChange={(e) => update(item.id, { description: e.target.value })}
              placeholder="Line item description"
              className="flex-1 rounded-md border border-slate-300 px-2 py-1 text-xs outline-none focus:border-blue-400"
            />
            <input
              type="number"
              value={item.qty}
              onChange={(e) => update(item.id, { qty: Number(e.target.value) })}
              placeholder="Qty"
              className="w-16 rounded-md border border-slate-300 px-2 py-1 text-xs outline-none focus:border-blue-400"
            />
            <input
              type="number"
              value={item.unitPrice}
              onChange={(e) => update(item.id, { unitPrice: Number(e.target.value) })}
              placeholder="Unit price"
              className="w-24 rounded-md border border-slate-300 px-2 py-1 text-xs outline-none focus:border-blue-400"
            />
            <button onClick={() => setItems(items.filter((i) => i.id !== item.id))} className="text-slate-400 hover:text-red-500">✕</button>
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex items-center justify-between">
        <button
          onClick={() => setItems([...items, { id: `l${items.length + 1}-${Date.now()}`, description: '', qty: 1, unitPrice: 0 }])}
          className="text-xs font-medium text-blue-600 hover:text-blue-700"
        >
          + Add line item
        </button>
        <span className="text-xs font-semibold text-slate-700">Total: {total.toLocaleString()}</span>
      </div>
    </div>
  );
}

export function BidActionPanel({ tender }: { tender: Tender }) {
  const { currentAccount } = useApp();
  const { busy, error, clearError, run } = useChainAction();
  const [items, setItems] = useState<LineItem[]>([{ id: 'l1', description: '', qty: 1, unitPrice: 0 }]);
  const [docsLabel, setDocsLabel] = useState('');
  const [salt, setSalt] = useState('');
  const [revealItems, setRevealItems] = useState<LocalSealedBid | null>(null);
  const [manualSalt, setManualSalt] = useState('');

  if (!currentAccount || currentAccount.role !== 'Bidder') return null;

  const myCommitment = tender.commitments.find((c) => c.bidder === currentAccount.address && !c.withdrawn);
  const myRevealedBid = tender.revealedBids.find((b) => b.bidder === currentAccount.address);
  const local = loadLocalSealedBid(tender.id, currentAccount.address);
  const documentsHash = docsLabel ? contentHash(docsLabel) : '';
  const totalPrice = items.reduce((s, i) => s + i.qty * i.unitPrice, 0);
  const buildCommitment = (docs: string, lines: LineItem[], s: string) =>
    docs && s ? (chainApi.buildCommitment?.(currentAccount.address, docs, lines, s) ?? '') : '';
  const previewCommitment = buildCommitment(documentsHash, items, salt);

  // ---- OPEN MODE ----
  if (tender.bidMode === 'Open') {
    const disabled = requireBidder(currentAccount) || (tender.state !== 'Submission' ? `Bids can only be submitted during the submission window (currently: ${tender.state}).` : undefined);
    const submit = () =>
      run(() =>
        chainApi.submitOpenBid(tender.id, currentAccount.address, {
          documentsHash: documentsHash || contentHash(`${tender.id}-${Date.now()}`),
          priceLineItems: items,
        }),
      );
    return (
      <Card>
        <CardHeader title="Submit your bid" subtitle="Open bid mode — bid contents are public immediately." />
        <CardBody>
          {myRevealedBid ? (
            <p className="rounded-md bg-emerald-50 p-2.5 text-sm text-emerald-700">✓ Bid submitted — total {myRevealedBid.totalPrice.toLocaleString()}. You may resubmit before the deadline to update it.</p>
          ) : null}
          <label className="mb-1 block text-xs font-medium text-slate-500">Documents (label — hash is derived)</label>
          <input value={docsLabel} onChange={(e) => setDocsLabel(e.target.value)} placeholder="e.g. proposal-v2.pdf" className="mb-2 w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm outline-none focus:border-blue-400" />
          <label className="mb-1 block text-xs font-medium text-slate-500">Price schedule</label>
          <LineItemsEditor items={items} setItems={setItems} />
          <div className="mt-3">
            <RoleGatedButton disabledReason={disabled} disabled={busy} onClick={submit}>{myRevealedBid ? 'Update bid' : 'Submit bid'}</RoleGatedButton>
            <ActionError error={error} onDismiss={clearError} />
          </div>
        </CardBody>
      </Card>
    );
  }

  // ---- SEALED MODE: REVEAL STAGE ----
  if (tender.state === 'Opening') {
    if (myRevealedBid) {
      return (
        <Card>
          <CardHeader title="Bid revealed" />
          <CardBody>
            <p className="text-sm text-emerald-700">✓ Your bid was successfully revealed — total {myRevealedBid.totalPrice.toLocaleString()}.</p>
          </CardBody>
        </Card>
      );
    }
    if (!myCommitment) {
      return (
        <Card>
          <CardHeader title="Reveal your bid" />
          <CardBody><p className="text-sm text-slate-400">You have no active commitment on this tender.</p></CardBody>
        </Card>
      );
    }

    const source = revealItems ?? local;
    const reveal = () => {
      if (!source) return;
      run(async () => {
        await chainApi.revealBid(tender.id, currentAccount.address, {
          documentsHash: source.documentsHash,
          priceLineItems: source.priceLineItems,
          salt: source.salt,
        });
        clearLocalSealedBid(tender.id, currentAccount.address);
      });
    };

    return (
      <Card>
        <CardHeader title="Reveal your bid" subtitle="Only available during the Opening window — re-enter exactly what you committed with." />
        <CardBody>
          {local ? (
            <>
              <p className="mb-2 rounded-md bg-blue-50 p-2.5 text-xs text-blue-700">
                We found your saved bid details in this browser. Review and reveal below.
              </p>
              <div className="mb-2 space-y-1 text-sm">
                <div>Documents hash: <HashTag hash={local.documentsHash} explain="Must match the hash used at commit time." /></div>
                <div>Total price: <span className="font-medium">{local.totalPrice.toLocaleString()}</span></div>
                <div>Salt: <span className="mono text-xs">{local.salt}</span></div>
                <div>Commitment (recomputed): <HashTag hash={buildCommitment(local.documentsHash, local.priceLineItems, local.salt)} explain="Recomputed from the details above — must equal your on-chain commitment hash for the reveal to be accepted." /></div>
              </div>
              <RoleGatedButton disabled={busy} onClick={reveal}>Reveal bid</RoleGatedButton>
              <ActionError error={error} onDismiss={clearError} />
            </>
          ) : (
            <>
              <p className="mb-2 rounded-md bg-amber-50 p-2.5 text-xs text-amber-700">
                No saved bid details found in this browser. Re-enter the exact documents, price and salt you used at commit time — if they don't hash to your on-chain commitment, the reveal will be rejected.
              </p>
              <label className="mb-1 block text-xs font-medium text-slate-500">Documents (label used at commit)</label>
              <input value={docsLabel} onChange={(e) => setDocsLabel(e.target.value)} className="mb-2 w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm outline-none focus:border-blue-400" />
              <label className="mb-1 block text-xs font-medium text-slate-500">Price schedule (must match exactly)</label>
              <LineItemsEditor items={items} setItems={setItems} />
              <label className="mb-1 mt-2 block text-xs font-medium text-slate-500">Salt used at commit</label>
              <input value={manualSalt} onChange={(e) => setManualSalt(e.target.value)} className="mono mb-2 w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm outline-none focus:border-blue-400" />
              <RoleGatedButton
                disabled={busy}
                onClick={() => {
                  setRevealItems({ documentsHash, priceLineItems: items, salt: manualSalt, totalPrice, commitmentHash: previewCommitment });
                }}
              >
                Preview reveal
              </RoleGatedButton>
              <ActionError error={error} onDismiss={clearError} />
            </>
          )}
        </CardBody>
      </Card>
    );
  }

  // ---- SEALED MODE: COMMIT STAGE ----
  const commitDisabled =
    requireBidder(currentAccount) ||
    (tender.state !== 'Submission' ? `Bids can only be committed during the submission window (currently: ${tender.state}).` : undefined);

  const doCommit = () => {
    if (!documentsHash || !salt) return;
    run(async () => {
      await chainApi.commitBid(tender.id, currentAccount.address, previewCommitment);
      saveLocalSealedBid(tender.id, currentAccount.address, { documentsHash, priceLineItems: items, salt, totalPrice, commitmentHash: previewCommitment });
    });
  };

  const withdraw = () =>
    run(async () => {
      await chainApi.withdrawCommitment(tender.id, currentAccount.address);
      clearLocalSealedBid(tender.id, currentAccount.address);
    });

  return (
    <Card>
      <CardHeader title="Commit your sealed bid" subtitle="Sealed mode: your bid stays hidden until the Opening window." />
      <CardBody>
        {myCommitment ? (
          <div className="mb-3 rounded-md bg-blue-50 p-2.5 text-xs text-blue-700">
            ✓ Commitment recorded. You may withdraw and re-commit before submission closes.
            <div className="mt-1"><HashTag hash={myCommitment.commitmentHash} explain="Your sealed commitment hash on-chain." /></div>
          </div>
        ) : null}

        <label className="mb-1 block text-xs font-medium text-slate-500">Documents (label — hash is derived)</label>
        <input value={docsLabel} onChange={(e) => setDocsLabel(e.target.value)} placeholder="e.g. proposal-v2.pdf" className="mb-2 w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm outline-none focus:border-blue-400" />

        <label className="mb-1 block text-xs font-medium text-slate-500">Price schedule</label>
        <LineItemsEditor items={items} setItems={setItems} />

        <label className="mb-1 mt-2 block text-xs font-medium text-slate-500">Salt (secret — proves this exact bid at reveal time)</label>
        <div className="mb-1 flex gap-1.5">
          <input value={salt} onChange={(e) => setSalt(e.target.value)} className="mono flex-1 rounded-md border border-slate-300 px-2.5 py-1.5 text-sm outline-none focus:border-blue-400" placeholder="Generate or enter your own…" />
          <button onClick={() => setSalt(randomSalt())} className="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">Generate</button>
        </div>

        {previewCommitment && (
          <div className="mb-2 text-xs text-slate-500">
            Commitment hash (blake2_256 of bidder + documents + price + salt): <HashTag hash={previewCommitment} explain="This is what gets committed on-chain now. The documents, price and salt behind it stay private until you reveal." />
          </div>
        )}

        <div className="mb-3 rounded-md bg-red-50 p-2.5 text-[11px] leading-snug text-red-700">
          ⚠ Your salt is saved only in this browser's local storage. It is never sent anywhere until you reveal. If you clear
          your browser data or switch devices before the Opening window, you will not be able to reveal — and your bid (and
          bond) will be forfeit. Consider writing it down separately.
        </div>

        <div className="flex gap-2">
          <RoleGatedButton disabledReason={commitDisabled || (!documentsHash || !salt ? 'Enter documents and a salt to compute your commitment.' : undefined)} disabled={busy} onClick={doCommit}>
            {myCommitment ? 'Re-commit bid' : 'Commit bid'}
          </RoleGatedButton>
          {myCommitment && (
            <RoleGatedButton variant="secondary" disabledReason={commitDisabled} disabled={busy} onClick={withdraw}>
              Withdraw commitment
            </RoleGatedButton>
          )}
        </div>
        <ActionError error={error} onDismiss={clearError} />
      </CardBody>
    </Card>
  );
}
