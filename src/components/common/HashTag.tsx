import { useState } from 'react';

function truncate(hash: string, lead = 8, tail = 6) {
  if (hash.length <= lead + tail + 3) return hash;
  return `${hash.slice(0, lead)}…${hash.slice(-tail)}`;
}

/**
 * Renders a hex hash truncated, with a copy button and a tooltip explaining
 * what the hash proves (e.g. "commitment hash", "notice hash"). Used for
 * every on-chain hash reference across the app so provenance is always one
 * hover away.
 */
export function HashTag({
  hash,
  explain,
  label,
}: {
  hash: string;
  explain: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(hash);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard unavailable in this environment — ignore */
    }
  };

  return (
    <span className="group relative inline-flex items-center gap-1 align-middle">
      {label && <span className="text-xs text-slate-500">{label}</span>}
      <span
        className="mono cursor-default rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700"
        title={explain}
      >
        {truncate(hash)}
      </span>
      <button
        type="button"
        onClick={copy}
        className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
        title="Copy full hash"
        aria-label="Copy full hash"
      >
        {copied ? (
          <svg width="13" height="13" viewBox="0 0 20 20" fill="none"><path d="M4 10.5l4 4 8-9" stroke="#059669" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
        ) : (
          <svg width="13" height="13" viewBox="0 0 20 20" fill="none"><rect x="7" y="7" width="10" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.5"/><path d="M4 13V4a1 1 0 011-1h9" stroke="currentColor" strokeWidth="1.5"/></svg>
        )}
      </button>
      <span className="pointer-events-none absolute bottom-full left-0 z-20 mb-1.5 hidden w-64 rounded-md bg-slate-900 px-2.5 py-1.5 text-[11px] leading-snug text-white shadow-lg group-hover:block">
        {explain}
      </span>
    </span>
  );
}
