import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useApp } from '../../state/AppContext';
import type { Role } from '../../types';
import { formatBlock } from '../../lib/blocks';
import { chainApi } from '../../services/api';

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
  const { accounts, currentAccount, setCurrentAccount, currentBlock, finalizedBlock, connection, endpoint, accountSource } = useApp();

  const [funding, setFunding] = useState<string | null>(null);

  const fund = async () => {
    setFunding('Funding…');
    try {
      const names = await chainApi.fundDevAccounts?.();
      setFunding(names && names.length > 0 ? `Funded ${names.join(', ')}` : 'All accounts already funded');
    } catch (e) {
      setFunding((e as Error).message);
    }
    setTimeout(() => setFunding(null), 6000);
  };

  const chain = {
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

          <div className="relative">
            <select
              className={`appearance-none rounded-md border border-slate-300 py-1.5 pl-3 pr-7 text-xs font-medium outline-none ${currentAccount ? roleColor(currentAccount.role) : 'bg-white'}`}
              value={currentAccount?.address ?? ''}
              onChange={(e) => {
                const acc = accounts.find((a) => a.address === e.target.value) ?? null;
                setCurrentAccount(acc);
              }}
              title={
                accountSource === 'extension'
                  ? 'Accounts injected by your polkadot{.js} extension'
                  : accountSource === 'dev'
                    ? 'Well-known --dev accounts (no extension detected)'
                    : 'Demo wallet switcher'
              }
            >
              <option value="">Disconnected (Public)</option>
              {accounts.map((a) => (
                <option key={a.address} value={a.address}>
                  {a.name} · {a.address.slice(0, 6)}…{a.address.slice(-4)}
                </option>
              ))}
            </select>
          </div>

          {currentAccount && (
            <select
              className={`appearance-none rounded-md border border-slate-300 py-1.5 pl-3 pr-7 text-xs font-medium outline-none ${roleColor(currentAccount.role)}`}
              value={currentAccount.role}
              onChange={(e) => setCurrentAccount({ ...currentAccount, role: e.target.value as Role })}
              title="The pallet has no role registry — an account is an officer because it created a tender, an evaluator because it was appointed to one. Pick the role to act in."
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          )}
        </div>
      </div>
    </header>
  );
}
