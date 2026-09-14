import { NavLink } from 'react-router-dom';
import { useApp } from '../../state/AppContext';
import { formatBlock } from '../../lib/blocks';
import { chainApi } from '../../services/mockChainApi';

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

export function Header() {
  const { accounts, currentAccount, setCurrentAccount, currentBlock } = useApp();

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
          <button
            onClick={() => chainApi.advanceBlocks(50)}
            className="hidden items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 sm:inline-flex"
            title="Demo control: fast-forward the simulated chain clock"
          >
            ⏩ +50 blocks
          </button>

          <div
            className="hidden items-center gap-1.5 rounded-md bg-slate-100 px-2.5 py-1.5 sm:inline-flex"
            title="Current finalized block number — every tender gate and countdown is computed from this"
          >
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
            <span className="mono text-xs font-medium text-slate-700">{formatBlock(currentBlock)}</span>
          </div>

          <div className="relative">
            <select
              className={`appearance-none rounded-md border border-slate-300 py-1.5 pl-3 pr-7 text-xs font-medium outline-none ${currentAccount ? roleColor(currentAccount.role) : 'bg-white'}`}
              value={currentAccount?.address ?? ''}
              onChange={(e) => {
                const acc = accounts.find((a) => a.address === e.target.value) ?? null;
                setCurrentAccount(acc);
              }}
              title="Demo wallet switcher — simulates connecting a different account/role"
            >
              <option value="">Disconnected (Public)</option>
              {accounts.map((a) => (
                <option key={a.address} value={a.address}>
                  {a.name} · {a.role}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>
    </header>
  );
}
