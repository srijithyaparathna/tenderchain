// Demo-only stand-in for blake2_256. Deterministic so the same inputs
// always reproduce the same commitment (as required for sealed-bid reveal
// verification), but NOT cryptographically secure — replace with a real
// blake2_256 (e.g. via @polkadot/util-crypto) when wiring up the live API.
export function mockHash(input: string): string {
  let h1 = 0xdeadbeef ^ input.length;
  let h2 = 0x41c6ce57 ^ input.length;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const hex = (n: number) => (n >>> 0).toString(16).padStart(8, '0');
  return '0x' + (hex(h1) + hex(h2) + hex(h1 ^ h2) + hex(h1 + h2)).slice(0, 64);
}

export function randomSalt(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function commitmentHash(bidder: string, documentsHash: string, totalPrice: number, salt: string): string {
  return mockHash(`${bidder}|${documentsHash}|${totalPrice}|${salt}`);
}
