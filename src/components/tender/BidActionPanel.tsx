import { useState } from 'react';
import type { AccountRef } from '../../types';
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
  const { currentAccount, currentBlock } = useApp();
  const { busy, error, clearError, run, fail } = useChainAction();
  const [items, setItems] = useState<LineItem[]>([{ id: 'l1', description: '', qty: 1, unitPrice: 0 }]);
  const [docsLabel, setDocsLabel] = useState('');
  const [salt, setSalt] = useState('');
  const [manualSalt, setManualSalt] = useState('');

  if (!currentAccount || currentAccount.role !== 'Bidder') return null;

  const myCommitment = tender.commitments.find((c) => c.bidder === currentAccount.address && !c.withdrawn);
  const myRevealedBid = tender.revealedBids.find((b) => b.bidder === currentAccount.address);
  const local = loadLocalSealedBid(tender.id, currentAccount.address);
  const documentsHash = docsLabel.trim() ? contentHash(docsLabel.trim()) : '';
  const totalPrice = items.reduce((s, i) => s + i.qty * i.unitPrice, 0);
  const buildCommitment = (docs: string, lines: LineItem[], s: string) =>
    docs && s ? (chainApi.buildCommitment?.(currentAccount.address, docs, lines, s) ?? '') : '';

  // The pallet takes bids from publication (`QaWindow`) until the close
  // block, and checks the block number itself — not just the stage.
  const windowReason = submissionWindowReason(tender, currentBlock, currentAccount);
  const lineIssue = priceScheduleIssue(items);

  const withdraw = (what: string) => {
    if (!confirm(`Withdraw your ${what}?${tender.bond.forfeitOnWithdrawal ? ' This tender FORFEITS the bid bond on withdrawal.' : ' Your bid bond will be returned.'}`)) return;
    run(async () => {
      await chainApi.withdrawCommitment(tender.id, currentAccount.address);
      clearLocalSealedBid(tender.id, currentAccount.address);
    });
  };

  const bondNote = Number(tender.bond.amount) > 0 && (
    <p className="mb-2 text-[11px] text-slate-500">
      Submitting reserves a bid bond of <strong>{tender.bond.amount} {tender.bond.currency}</strong> from this account.
    </p>
  );

  // ---- OPEN MODE ----
  if (tender.bidMode === 'Open') {
    const submit = () => {
      if (!docsLabel.trim()) return fail('Enter a documents label for your bid.');
      if (lineIssue) return fail(lineIssue);
      run(async () => {
        await chainApi.submitOpenBid(tender.id, currentAccount.address, {
          documentsHash,
          priceLineItems: items,
        });
        setDocsLabel('');
      });
    };
    return (
      <Card>
        <CardHeader title="Submit your bid" subtitle="Open bid mode — bid contents are public immediately." />
        <CardBody>
          {myRevealedBid ? (
            <>
              <p className="mb-2 rounded-md bg-emerald-50 p-2.5 text-sm text-emerald-700">
                ✓ Bid submitted — total {myRevealedBid.totalPrice.toLocaleString()}.
              </p>
              {/* The pallet holds one bid per bidder (`CommitmentExists`), so the
                  only way to change it is to withdraw and bid again. */}
              {!windowReason && (
                <>
                  <p className="mb-2 text-xs text-slate-500">To change it, withdraw it and submit a new one before submission closes.</p>
                  <RoleGatedButton variant="secondary" disabled={busy} onClick={() => withdraw('bid')}>Withdraw bid</RoleGatedButton>
                </>
              )}
            </>
          ) : (
            <>
              <label className="mb-1 block text-xs font-medium text-slate-500">Documents (label — hash is derived)</label>
              <input value={docsLabel} onChange={(e) => setDocsLabel(e.target.value)} placeholder="e.g. proposal-v2.pdf" className="mb-2 w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm outline-none focus:border-blue-400" />
              <label className="mb-1 block text-xs font-medium text-slate-500">Price schedule</label>
              <LineItemsEditor items={items} setItems={setItems} />
              <div className="mt-3">
                {bondNote}
                <RoleGatedButton
                  disabledReason={requireBidder(currentAccount) || windowReason || (!docsLabel.trim() ? 'Enter a documents label.' : lineIssue)}
                  disabled={busy}
                  onClick={submit}
                >
                  Submit bid
                </RoleGatedButton>
              </div>
            </>
          )}
          <ActionError error={error} onDismiss={clearError} />
        </CardBody>
      </Card>
    );
  }

  // ---- SEALED MODE: REVEALED (valid or voided) ----
  if (myRevealedBid) {
    return (
      <Card>
        <CardHeader title={myRevealedBid.disqualified ? 'Bid voided' : 'Bid revealed'} />
        <CardBody>
          {myRevealedBid.disqualified ? (
            <p className="rounded-md bg-red-50 p-2.5 text-sm text-red-700">
              ✕ Your reveal did not match your sealed commitment, so the bid was voided. The mismatch is on the
              public record and the bid cannot be scored or awarded.
            </p>
          ) : (
            <p className="text-sm text-emerald-700">✓ Your bid was successfully revealed — total {myRevealedBid.totalPrice.toLocaleString()}.</p>
          )}
        </CardBody>
      </Card>
    );
  }

  // ---- SEALED MODE: REVEAL STAGE ----
  if (tender.state === 'Opening') {
    if (!myCommitment) {
      return (
        <Card>
          <CardHeader title="Reveal your bid" />
          <CardBody><p className="text-sm text-slate-400">You have no active commitment on this tender.</p></CardBody>
        </Card>
      );
    }

    const revealWindowReason =
      currentBlock > tender.gates.openingEndAt ? `The reveal window ended at block #${tender.gates.openingEndAt.toLocaleString()}.` : undefined;

    // Either the details saved in this browser at commit time, or what the
    // bidder re-enters by hand. The recomputed commitment is compared with the
    // on-chain one before sending, because a mismatch is not refused by the
    // chain — it is accepted and the bid is permanently voided.
    const source: LocalSealedBid | null = local ?? (documentsHash && manualSalt.trim()
      ? { documentsHash, priceLineItems: items, salt: manualSalt.trim(), totalPrice, commitmentHash: '' }
      : null);
    const recomputed = source ? buildCommitment(source.documentsHash, source.priceLineItems, source.salt) : '';
    const matches = Boolean(recomputed) && recomputed === myCommitment.commitmentHash;

    const reveal = () => {
      if (!source) return fail('Enter the documents label, price schedule and salt you used at commit time.');
      if (!/^0x[0-9a-fA-F]{64}$/.test(source.salt)) return fail('The salt must be the 0x-prefixed 64-hex-digit value generated at commit time.');
      if (!matches && !confirm('These details do NOT reproduce your on-chain commitment. Revealing them will VOID your bid permanently. Reveal anyway?')) return;
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
        <CardHeader title="Reveal your bid" subtitle="Only available during the Opening window — the details must reproduce your commitment exactly." />
        <CardBody>
          {local ? (
            <>
              <p className="mb-2 rounded-md bg-blue-50 p-2.5 text-xs text-blue-700">
                We found your saved bid details in this browser. Review and reveal below.
              </p>
              <div className="mb-2 space-y-1 text-sm">
                <div>Documents hash: <HashTag hash={local.documentsHash} explain="Must match the hash used at commit time." /></div>
                <div>Total price: <span className="font-medium">{local.totalPrice.toLocaleString()}</span></div>
                <div>Salt: <span className="mono break-all text-xs">{local.salt}</span></div>
              </div>
            </>
          ) : (
            <>
              <p className="mb-2 rounded-md bg-amber-50 p-2.5 text-xs text-amber-700">
                No saved bid details found in this browser. Re-enter the exact documents label, price lines (same order and
                descriptions) and salt you used at commit time.
              </p>
              <label className="mb-1 block text-xs font-medium text-slate-500">Documents (label used at commit)</label>
              <input value={docsLabel} onChange={(e) => setDocsLabel(e.target.value)} className="mb-2 w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm outline-none focus:border-blue-400" />
              <label className="mb-1 block text-xs font-medium text-slate-500">Price schedule (must match exactly)</label>
              <LineItemsEditor items={items} setItems={setItems} />
              <label className="mb-1 mt-2 block text-xs font-medium text-slate-500">Salt used at commit</label>
              <input value={manualSalt} onChange={(e) => setManualSalt(e.target.value)} placeholder="0x…" className="mono mb-2 w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm outline-none focus:border-blue-400" />
            </>
          )}
          {recomputed && (
            <div className={`mb-2 rounded-md p-2 text-xs ${matches ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
              {matches
                ? '✓ These details reproduce your on-chain commitment — the reveal will be accepted.'
                : '✕ These details do NOT reproduce your on-chain commitment. Revealing them would void your bid.'}
              <div className="mt-1"><HashTag hash={recomputed} explain="Commitment recomputed from the details above." /></div>
            </div>
          )}
          <RoleGatedButton
            variant={recomputed && !matches ? 'danger' : 'primary'}
            disabledReason={revealWindowReason || (!source ? 'Enter your documents label and salt to reveal.' : undefined)}
            disabled={busy}
            onClick={reveal}
          >
            Reveal bid
          </RoleGatedButton>
          <ActionError error={error} onDismiss={clearError} />
        </CardBody>
      </Card>
    );
  }

  // ---- SEALED MODE: AFTER SUBMISSIONS ----
  if (!['Draft', 'Published', 'Submission'].includes(tender.state)) {
    return (
      <Card>
        <CardHeader title="Your bid" />
        <CardBody>
          <p className="text-sm text-slate-500">
            {myCommitment
              ? tender.state === 'Closed'
                ? 'Submissions are closed and your sealed bid is locked in. Come back when the officer opens the tender to reveal it.'
                : 'Your commitment was not revealed during the Opening window.'
              : `You did not bid on this tender (currently: ${tender.state}).`}
          </p>
        </CardBody>
      </Card>
    );
  }

  // ---- SEALED MODE: COMMIT STAGE ----
  if (myCommitment) {
    return (
      <Card>
        <CardHeader title="Your sealed bid" subtitle="Your bid stays hidden until the Opening window." />
        <CardBody>
          <div className="mb-3 rounded-md bg-blue-50 p-2.5 text-xs text-blue-700">
            ✓ Commitment recorded at block #{myCommitment.committedAtBlock.toLocaleString()}.
            <div className="mt-1"><HashTag hash={myCommitment.commitmentHash} explain="Your sealed commitment hash on-chain." /></div>
            {!local && (
              <p className="mt-1.5 font-medium text-amber-700">
                ⚠ This browser holds no saved details for this bid — you will need your documents label, price lines and salt to reveal.
              </p>
            )}
          </div>
          {/* One commitment per bidder (`CommitmentExists`): changing a bid means
              withdrawing it first, then committing again. */}
          <p className="mb-2 text-xs text-slate-500">To change your bid, withdraw this commitment and commit a new one before submission closes.</p>
          <RoleGatedButton variant="secondary" disabledReason={windowReason} disabled={busy} onClick={() => withdraw('sealed commitment')}>
            Withdraw commitment
          </RoleGatedButton>
          <ActionError error={error} onDismiss={clearError} />
        </CardBody>
      </Card>
    );
  }

  const previewCommitment = buildCommitment(documentsHash, items, salt);
  const saltIssue = salt && !/^0x[0-9a-fA-F]{64}$/.test(salt) ? 'Salt must be 0x followed by 64 hex digits — use Generate.' : undefined;

  const doCommit = () => {
    if (!documentsHash || !salt) return fail('Enter a documents label and generate a salt first.');
    if (saltIssue) return fail(saltIssue);
    if (lineIssue) return fail(lineIssue);
    run(async () => {
      await chainApi.commitBid(tender.id, currentAccount.address, previewCommitment);
      saveLocalSealedBid(tender.id, currentAccount.address, { documentsHash, priceLineItems: items, salt, totalPrice, commitmentHash: previewCommitment });
    });
  };

  return (
    <Card>
      <CardHeader title="Commit your sealed bid" subtitle="Sealed mode: your bid stays hidden until the Opening window." />
      <CardBody>
        <label className="mb-1 block text-xs font-medium text-slate-500">Documents (label — hash is derived)</label>
        <input value={docsLabel} onChange={(e) => setDocsLabel(e.target.value)} placeholder="e.g. proposal-v2.pdf" className="mb-2 w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm outline-none focus:border-blue-400" />

        <label className="mb-1 block text-xs font-medium text-slate-500">Price schedule</label>
        <LineItemsEditor items={items} setItems={setItems} />

        <label className="mb-1 mt-2 block text-xs font-medium text-slate-500">Salt (secret — proves this exact bid at reveal time)</label>
        <div className="mb-1 flex gap-1.5">
          <input value={salt} onChange={(e) => setSalt(e.target.value.trim())} className="mono min-w-0 flex-1 rounded-md border border-slate-300 px-2.5 py-1.5 text-sm outline-none focus:border-blue-400" placeholder="Generate or paste a 0x… 32-byte salt" />
          <button onClick={() => setSalt(randomSalt())} className="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">Generate</button>
        </div>

        {previewCommitment && !saltIssue && (
          <div className="mb-2 text-xs text-slate-500">
            Commitment hash (blake2_256 of bidder + documents + price + salt): <HashTag hash={previewCommitment} explain="This is what gets committed on-chain now. The documents, price and salt behind it stay private until you reveal." />
          </div>
        )}

        <div className="mb-3 rounded-md bg-red-50 p-2.5 text-[11px] leading-snug text-red-700">
          ⚠ Your salt is saved only in this browser's local storage. It is never sent anywhere until you reveal. If you clear
          your browser data or switch devices before the Opening window, you will not be able to reveal — and your bid (and
          bond) will be forfeit. Consider writing it down separately.
        </div>

        {bondNote}
        <RoleGatedButton
          disabledReason={
            requireBidder(currentAccount) ||
            windowReason ||
            (!documentsHash ? 'Enter a documents label.' : !salt ? 'Generate a salt.' : saltIssue ?? lineIssue)
          }
          disabled={busy}
          onClick={doCommit}
        >
          Commit bid
        </RoleGatedButton>
        <ActionError error={error} onDismiss={clearError} />
      </CardBody>
    </Card>
  );
}

/** Why a bid cannot be lodged right now, mirroring `ensure_can_submit`. */
function submissionWindowReason(tender: Tender, currentBlock: number, account: AccountRef): string | undefined {
  if (tender.state === 'Draft') return 'This tender has not been published yet.';
  if (tender.state !== 'Published' && tender.state !== 'Submission') {
    return `Bids are only accepted while the tender is published and before submission closes (currently: ${tender.state}).`;
  }
  if (currentBlock >= tender.gates.submissionCloseAt) {
    return `Submissions closed at block #${tender.gates.submissionCloseAt.toLocaleString()}.`;
  }
  if (tender.evaluators.includes(account.address)) return 'This account is appointed as an evaluator on this tender, so it cannot bid.';
  return undefined;
}

/** A price schedule the pallet will accept and an evaluator can read. */
function priceScheduleIssue(items: LineItem[]): string | undefined {
  if (items.length === 0) return 'Add at least one price line.';
  if (items.some((i) => !i.description.trim())) return 'Every price line needs a description.';
  if (items.some((i) => !Number.isFinite(i.qty) || i.qty <= 0)) return 'Quantities must be greater than zero.';
  if (items.some((i) => !Number.isFinite(i.unitPrice) || i.unitPrice < 0)) return 'Unit prices cannot be negative.';
  if (items.some((i) => !Number.isInteger(i.qty * i.unitPrice))) return 'Each line total (qty × unit price) must be a whole number.';
  return undefined;
}
