// Turning a rejected chain call into something a human can read.
//
// A failed extrinsic rejects with a `ChainCallError` carrying two useful
// halves: `message` is the pallet variant (`tenderChain.NotInEvaluation`),
// which is what you grep the pallet for, and `docs` is the doc comment the
// runtime ships alongside it, which is the only half a non-developer can read.
// Dropping either one makes a failure harder to act on than it needs to be.

export function describeChainError(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e);
  const docs = (e as { docs?: unknown } | null | undefined)?.docs;
  return typeof docs === 'string' && docs.trim() ? `${message} — ${docs.trim()}` : message;
}
