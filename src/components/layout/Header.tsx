import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useApp } from '../../state/AppContext';
import type { Role } from '../../types';
import { formatBlock } from '../../lib/blocks';
import { chainApi } from '../../services/api';
import { describeChainError } from '../../lib/errors';
import { Select } from '../common/Select';

const NAV = [
  { to: '/', label: 'Tenders', end: true },
  { to: '/evaluator', label: 'Evaluator' },
  { to: '/audit', label: 'Public Audit' },
];

function roleColor(role: string) {
  switch (role) {
    case 'Officer': return 'bg-blue-100 text-blue-700';
    case 'Bidder': return 'bg-emerald-100 text-emerald-700';
    case 'Evaluator': return 'bg-amber-100 text-amber-700';
    case 'Governance': return 'bg-purple-100 text-purple-700';
    default: return 'bg-slate-100 text-slate-600';
  }
}

const ROLES: Role[] = ['Officer', 'Bidder', 'Evaluator', 'Governance', 'Public'];

export function Header() {
  const { accounts, currentAccount, setCurrentAccount, currentBlock, finalizedBlock, connection, endpoint, accountSource, chainError } = useApp();

  const [funding, setFunding] = useState<string | null>(null);

  const fund = async () => {
    setFunding('Funding…');
    try {
      const names = await chainApi.fundDevAccounts?.();
      setFunding(names && names.length > 0 ? `Funded ${names.join(', ')}` : 'All accounts already funded');
    } catch (e) {
      setFunding(describeChainError(e));
    }
    setTimeout(() => setFunding(null), 6000);
  };

  const chain = chainError
    ? { dot: 'bg-red-500', text: 'Wrong runtime', hint: `${chainError} (connected to ${endpoint})` }
    : {
        mock: { dot: 'bg-emerald-500 animate-pulse', text: formatBlock(currentBlock), hint: 'Simulated chain clock — no node attached.' },
        connecting: { dot: 'bg-amber-500 animate-pulse', text: 'Connecting…', hint: `Opening a WebSocket to ${endpoint}` },
        connected: { dot: 'bg-emerald-500 animate-pulse', text: formatBlock(currentBlock), hint: `Best block from ${endpoint} — every tender gate and countdown is computed from this. Finalized: #${finalizedBlock}.` },
        disconnected: { dot: 'bg-red-500', text: 'Node offline', hint: `No node answering at ${endpoint}. Start the TenderChain node, or run with VITE_CHAIN_MODE=mock.` },
      }[connection];

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-slate-900 text-sm font-bold text-white">T</div>
          <div className="leading-tight">
            <div className="text-sm font-semibold text-slate-900">TenderChain</div>
            <div className="text-[10px] text-slate-500">Public procurement, on-chain</div>
          </div>
        </div>

        <nav className="ml-4 flex items-center gap-1">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                `rounded-md px-3 py-1.5 text-sm font-medium ${
                  isActive ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
                }`
              }
            >
              {n.label}
            </NavLink>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          {accountSource === 'dev' && connection === 'connected' && (
            <button
              onClick={fund}
              className="hidden items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 sm:inline-flex"
              title="--dev endows only Alice and Bob. The lifecycle needs five distinct accounts (officer, bidder, three evaluators); this tops up the rest from the sudo key so they can pay fees."
            >
              {funding ?? '⛽ Fund dev accounts'}
            </button>
          )}

          {connection === 'mock' && (
            <button
              onClick={() => chainApi.advanceBlocks(50)}
              className="hidden items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 sm:inline-flex"
              title="Demo control: fast-forward the simulated chain clock"
            >
              ⏩ +50 blocks
            </button>
          )}

          <div className="hidden items-center gap-1.5 rounded-md bg-slate-100 px-2.5 py-1.5 sm:inline-flex" title={chain.hint}>
            <span className={`h-1.5 w-1.5 rounded-full ${chain.dot}`} />
            <span className="mono text-xs font-medium text-slate-700">{chain.text}</span>
          </div>

          <Select
            size="sm"
            align="right"
            className="w-auto min-w-0 max-w-[9rem] sm:max-w-xs"
            triggerClassName={currentAccount ? roleColor(currentAccount.role) : 'bg-white text-slate-700'}
            value={currentAccount?.address ?? ''}
            onChange={(address) => setCurrentAccount(accounts.find((a) => a.address === address) ?? null)}
            aria-label="Account"
            title={
              accountSource === 'extension'
                ? 'Accounts injected by your polkadot{.js} extension'
                : accountSource === 'dev'
                  ? 'Well-known --dev accounts (no extension detected)'
                  : 'Demo wallet switcher'
            }
            options={[
              { value: '', label: 'Disconnected (Public)' },
              ...accounts.map((a) => ({ value: a.address, label: `${a.name} · ${a.address.slice(0, 6)}…${a.address.slice(-4)}` })),
            ]}
          />

          {currentAccount && (
            <Select
              size="sm"
              align="right"
              className="w-auto"
              triggerClassName={roleColor(currentAccount.role)}
              value={currentAccount.role}
              onChange={(role) => setCurrentAccount({ ...currentAccount, role })}
              aria-label="Role"
              title="The pallet has no role registry — an account is an officer because it created a tender, an evaluator because it was appointed to one. Pick the role to act in."
              options={ROLES.map((r) => ({ value: r, label: r }))}
            />
          )}
        </div>
      </div>

      {chainError && (
        <div className="border-t border-red-200 bg-red-50 px-4 py-2 text-center text-xs text-red-800">
          <span className="font-semibold">Connected, but this node cannot run the portal.</span>{' '}
          {chainError}
        </div>
      )}
    </header>
  );
}
