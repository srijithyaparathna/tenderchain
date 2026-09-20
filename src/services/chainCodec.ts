// Translation between the pallet's SCALE types and the portal's view model.
//
// The commitment hash in here is the one thing that must be byte-exact: it is
// reproduced from `Pallet::compute_commitment`, and a single byte of drift
// voids every sealed bid as a RevealMismatch.

import type { ApiPromise } from '@polkadot/api';
import { blake2AsHex, blake2AsU8a } from '@polkadot/util-crypto';
import { hexToU8a, u8aConcat } from '@polkadot/util';
import type { BidMode, PriceLineItem, TenderKind, TenderState } from '../types';

// --- enums -----------------------------------------------------------------

const KIND_TO_CHAIN: Record<TenderKind, string> = {
  RFQ: 'Rfq',
  RFT: 'Rft',
  EOI: 'Eoi',
  Panel: 'Panel',
  JobTask: 'JobTask',
};

const KIND_FROM_CHAIN: Record<string, TenderKind> = {
  Rfq: 'RFQ',
  Rft: 'RFT',
  Eoi: 'EOI',
  Panel: 'Panel',
  JobTask: 'JobTask',
};

export function kindToChain(k: TenderKind): string {
  return KIND_TO_CHAIN[k];
}

export function kindFromChain(k: string): TenderKind {
  return KIND_FROM_CHAIN[k] ?? 'RFQ';
}

export function bidModeFromChain(m: string): BidMode {
  return m === 'Open' ? 'Open' : 'Sealed';
}

/**
 * The pallet's lifecycle has two states the portal's view model does not name
 * separately:
 *  - `Challenged` is `Awarded` with an open challenge, which the portal reads
 *    off the challenges list instead.
 *  - `Shortlisted` is an EOI's terminal state; the portal shows it as awarded.
 * Award opens the standstill window in the same call, so `Awarded` maps onto
 * the portal's `Standstill`.
 */
export function stateFromChain(s: string): TenderState {
  switch (s) {
    case 'Draft':
      return 'Draft';
    case 'QaWindow':
      return 'Published';
    case 'Submission':
      return 'Submission';
    case 'Closed':
      return 'Closed';
    case 'Opening':
      return 'Opening';
    case 'Evaluation':
      return 'Evaluation';
    case 'Awarded':
    case 'Challenged':
      return 'Standstill';
    case 'Shortlisted':
      return 'Awarded';
    case 'Contracted':
      return 'Contracted';
    case 'Cancelled':
      return 'Cancelled';
    default:
      return 'Draft';
  }
}

// --- hashes ----------------------------------------------------------------

export const ZERO_HASH = `0x${'00'.repeat(32)}`;

/** A fresh 32-byte salt. The pallet's preimage takes 32, not 16. */
export function randomSalt32(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

export interface ChainPriceLine {
  itemId: number;
  amount: bigint;
}

/** The portal's per-item lines flatten to the pallet's `{item_id, amount}`. */
export function toChainPriceLines(items: PriceLineItem[]): ChainPriceLine[] {
  return items.map((item, index) => ({
    itemId: index,
    amount: BigInt(Math.round(item.qty * item.unitPrice)),
  }));
}

/**
 * `blake2_256(SCALE(bidder) ‖ documents_hash ‖ SCALE(Vec<PriceLine>) ‖ salt)`.
 *
 * The price schedule is encoded as the vector it becomes on chain, so line
 * order is part of the hash — reordering voids the bid. Must stay byte-for-byte
 * identical to `Pallet::compute_commitment`.
 */
export function computeCommitment(
  api: ApiPromise,
  bidder: string,
  documentsHash: string,
  lines: ChainPriceLine[],
  salt: string,
): string {
  const encodedBidder = api.createType('AccountId32', bidder).toU8a();
  const encodedPrices = api
    .createType(
      'Vec<PalletTenderChainPriceLine>',
      lines.map((l) => ({ itemId: l.itemId, amount: l.amount })),
    )
    .toU8a();

  const preimage = u8aConcat(
    encodedBidder,
    hexToU8a(documentsHash),
    encodedPrices,
    hexToU8a(salt),
  );

  return blake2AsHex(preimage, 256);
}

/** `Pallet::blind_author` — `blake2_256(asker ‖ salt)`. */
export function blindAuthor(api: ApiPromise, asker: string, salt: string): string {
  return blake2AsHex(
    u8aConcat(api.createType('AccountId32', asker).toU8a(), hexToU8a(salt)),
    256,
  );
}

export { blake2AsU8a };
