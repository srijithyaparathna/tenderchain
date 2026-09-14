export function blocksToDuration(blocks: number, avgBlockTimeSeconds: number): string {
  const totalSeconds = Math.max(0, blocks) * avgBlockTimeSeconds;
  const d = Math.floor(totalSeconds / 86400);
  const h = Math.floor((totalSeconds % 86400) / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function formatBlock(block: number): string {
  return `#${block.toLocaleString()}`;
}
