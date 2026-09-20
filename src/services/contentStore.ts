// The pallet stores structure and proof, never readable content: a tender's
// title, its criteria names, the text of a question are all off-chain, anchored
// on chain only by a blake2-256 hash. In production that content lives in a DNC
// / IPFS layer; for testing it lives in this browser's localStorage.
//
// Consequence worth knowing: a tender created in one browser shows up in
// another as hashes with no text, because only the hash is on chain. That is
// the pallet behaving correctly, not a bug.

import { blake2AsHex } from '@polkadot/util-crypto';
import { stringToU8a } from '@polkadot/util';

const KEY = 'tenderchain.content.v1';

type Store = Record<string, string>;

function load(): Store {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Store;
  } catch {
    return {};
  }
}

function save(store: Store) {
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    /* quota exceeded — the chain still has the hash, only the text is lost */
  }
}

/** The anchor the pallet actually stores. */
export function hashOf(text: string): string {
  return blake2AsHex(stringToU8a(text), 256);
}

/** Record `text` locally and return the hash to put on chain. */
export function putText(text: string): string {
  const hash = hashOf(text);
  const store = load();
  store[hash] = text;
  save(store);
  return hash;
}

export function putJson(value: unknown): string {
  return putText(JSON.stringify(value));
}

export function getText(hash: string): string | undefined {
  return load()[hash];
}

export function getJson<T>(hash: string): T | undefined {
  const raw = getText(hash);
  if (raw === undefined) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

/** What to show when the content behind a hash was never seen in this browser. */
export function shortHash(hash: string): string {
  return `${hash.slice(0, 10)}…${hash.slice(-6)}`;
}

export function textOr(hash: string, fallback: string): string {
  return getText(hash) ?? fallback;
}
