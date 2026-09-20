import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTenders } from '../hooks/useTenders';
import { StatusBadge } from '../components/common/StatusBadge';
import { Countdown } from '../components/common/Countdown';
import { HashTag } from '../components/common/HashTag';
import { TENDER_KIND_LABEL, type TenderKind, type TenderState } from '../types';
import { nextGate } from '../lib/gates';

const ALL_STATES: (TenderState | 'All')[] = [
  'All', 'Draft', 'Published', 'Submission', 'Closed', 'Opening', 'Evaluation', 'Standstill', 'Contracted', 'Cancelled',
];
const ALL_KINDS: (TenderKind | 'All')[] = ['All', 'RFQ', 'RFT', 'EOI', 'Panel', 'JobTask'];

export function TenderListPage() {
  const { tenders, loading } = useTenders();
  const [state, setState] = useState<TenderState | 'All'>('All');
  const [kind, setKind] = useState<TenderKind | 'All'>('All');
  const [entity, setEntity] = useState('All');
  const [q, setQ] = useState('');

  const entities = useMemo(() => ['All', ...Array.from(new Set(tenders.map((t) => t.entity)))], [tenders]);

  const filtered = tenders.filter((t) => {
    if (state !== 'All' && t.state !== state) return false;
    if (kind !== 'All' && t.kind !== kind) return false;
    if (entity !== 'All' && t.entity !== entity) return false;
    if (q && !`${t.title} ${t.summary}`.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Tender marketplace</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            Every tender's lifecycle, criteria and gates are recorded on-chain and publicly auditable.
          </p>
        </div>
        <Link
          to="/create"
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          + Create tender
        </Link>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search title or summary…"
          className="w-56 rounded-md border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-blue-400"
        />
        <FilterSelect label="Status" value={state} onChange={(v) => setState(v as TenderState | 'All')} options={ALL_STATES} />
        <FilterSelect
          label="Type"
          value={kind}
          onChange={(v) => setKind(v as TenderKind | 'All')}
          options={ALL_KINDS}
          render={(k) => (k === 'All' ? 'All' : TENDER_KIND_LABEL[k as TenderKind])}
        />
        <FilterSelect label="Entity" value={entity} onChange={setEntity} options={entities} />
        <span className="ml-auto text-xs text-slate-400">{filtered.length} of {tenders.length} tenders</span>
      </div>

      {loading ? (
        <div className="py-20 text-center text-sm text-slate-400">Loading tenders…</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 py-16 text-center text-sm text-slate-400">
          {tenders.length === 0
            ? 'No tenders published yet.'
            : 'No tenders match these filters.'}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((t) => {
            const gate = nextGate(t);
            return (
              <Link
                key={t.id}
                to={`/tenders/${t.id}`}
                className="flex flex-col rounded-lg border border-slate-200 bg-white p-4 shadow-sm transition hover:border-blue-300 hover:shadow-md"
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <StatusBadge state={t.state} />
                  <span className="text-[11px] font-medium text-slate-400">{TENDER_KIND_LABEL[t.kind]}</span>
                </div>
                <h3 className="mb-1 text-sm font-semibold text-slate-900">{t.title}</h3>
                <p className="mb-3 line-clamp-2 text-xs text-slate-500">{t.summary}</p>
                <div className="mb-3 flex items-center justify-between text-xs text-slate-500">
                  <span>{t.entity}</span>
                  <span className="mono">{t.id}</span>
                </div>
                <div className="mb-3">
                  <HashTag hash={t.noticeHash} explain="Notice hash — the on-chain commitment to this tender's published notice; any later edit would change this hash." />
                </div>
                <div className="mt-auto border-t border-slate-100 pt-2.5">
                  {gate ? (
                    <Countdown targetBlock={gate.block} label={gate.label} />
                  ) : (
                    <span className="text-xs text-slate-400">No further gates pending</span>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function FilterSelect<T extends string>({
  label,
  value,
  onChange,
  options,
  render,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: T[];
  render?: (v: T) => string;
}) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-slate-500">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="rounded-md border border-slate-300 px-2 py-1.5 text-xs font-medium text-slate-700 outline-none focus:border-blue-400"
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {render ? render(o) : o}
          </option>
        ))}
      </select>
    </label>
  );
}
