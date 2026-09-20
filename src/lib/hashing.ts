// Real blake2-256, matching what the pallet stores.
//
// This file used to hold a deliberately fake hash for the simulated chain. It
// is now the genuine article: every value here goes on chain as a `[u8;32]`,
// so a 16-byte stand-in would be rejected outright, and a commitment computed
// over the wrong preimage would void the bid at reveal time.

import { blake2AsHex } from '@polkadot/util-crypto';
import { stringToU8a } from '@polkadot/util';

/** blake2-256 over the UTF-8 bytes of `input`, as a 0x-prefixed 32-byte hex. */
export function contentHash(input: string): string {
  return blake2AsHex(stringToU8a(input), 256);
}

/**
 * A fresh 32-byte salt. The pallet's commitment preimage takes 32 bytes — a
 * shorter salt changes the hash and voids the reveal.
 */
export function randomSalt(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/** True when `value` is already a well-formed 32-byte hex hash. */
export function isHash32(value: string | undefined): value is string {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value);
}

/**
 * Coerce anything the UI holds into a valid `[u8;32]`: pass a real hash
 * through untouched, hash everything else.
 */
export function asHash32(value: string | undefined, fallbackSeed: string): string {
  if (isHash32(value)) return value;
  return contentHash(value ? value : fallbackSeed);
}
