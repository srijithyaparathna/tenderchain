// Submitting extrinsics, and reading the result honestly.
//
// Two traps this module exists to close:
//  1. An extrinsic that lands in a block has *not* necessarily succeeded —
//     `ExtrinsicFailed` carries a module error that has to be decoded.
//  2. A sudo-wrapped call reports twice: `sudo.sudo` confirms Root origin was
//     accepted, and a separate `sudo.Sudid` reports whether the inner call
//     worked. A green `sudo.sudo` alone means nothing.

import type { ApiPromise } from '@polkadot/api';
import type { SubmittableExtrinsic } from '@polkadot/api/types';
import type { ISubmittableResult } from '@polkadot/types/types';
import type { EventRecord } from '@polkadot/types/interfaces';
import { getDevPair } from './accounts';

export class ChainCallError extends Error {
  readonly docs?: string;

  constructor(message: string, docs?: string) {
    super(message);
    this.name = 'ChainCallError';
    this.docs = docs;
  }
}

function decodeDispatchError(api: ApiPromise, dispatchError: unknown): ChainCallError {
  const err = dispatchError as { isModule?: boolean; asModule?: unknown; toString(): string };
  if (err?.isModule) {
    try {
      const meta = api.registry.findMetaError(err.asModule as never);
      return new ChainCallError(`${meta.section}.${meta.name}`, meta.docs.join(' ').trim());
    } catch {
      /* fall through to the raw form */
    }
  }
  return new ChainCallError(String(dispatchError));
}

/** The inner result of a `sudo.sudo` wrapper, if this batch of events has one. */
function sudoInnerError(api: ApiPromise, events: EventRecord[]): ChainCallError | null {
  for (const { event } of events) {
    if (event.section !== 'sudo' || event.method !== 'Sudid') continue;
    const result = event.data[0] as unknown as { isErr?: boolean; asErr?: unknown };
    if (result?.isErr) return decodeDispatchError(api, result.asErr);
  }
  return null;
}

async function resolveSigner(address: string) {
  const pair = getDevPair(address);
  if (pair) return { who: pair as never, options: {} };

  const { web3FromAddress } = await import('@polkadot/extension-dapp');
  const injector = await web3FromAddress(address);
  return { who: address as never, options: { signer: injector.signer } };
}

/**
 * Sign, submit, and wait for inclusion. Resolves with the block's events so the
 * caller can inspect them — `reveal_bid` in particular returns `Ok` on a hash
 * mismatch and reports the failure only as a `RevealMismatch` event.
 */
export async function submit(
  api: ApiPromise,
  tx: SubmittableExtrinsic<'promise'>,
  from: string,
): Promise<EventRecord[]> {
  const { who, options } = await resolveSigner(from);

  return new Promise((resolve, reject) => {
    let unsub: (() => void) | undefined;
    const done = (fn: () => void) => {
      unsub?.();
      fn();
    };

    tx.signAndSend(who, options, (result: ISubmittableResult) => {
      const { status, events, dispatchError } = result;

      if (dispatchError) {
        return done(() => reject(decodeDispatchError(api, dispatchError)));
      }
      if (status.isInBlock || status.isFinalized) {
        const inner = sudoInnerError(api, events);
        if (inner) return done(() => reject(inner));
        return done(() => resolve(events));
      }
      if (status.isInvalid || status.isDropped || status.isUsurped) {
        return done(() => reject(new ChainCallError(`Transaction ${status.type}`)));
      }
    })
      .then((u) => {
        unsub = u as unknown as () => void;
      })
      .catch((e) => reject(e instanceof Error ? e : new ChainCallError(String(e))));
  });
}

/**
 * Dispatch through `sudo`, for the origins the runtime binds to Root:
 * `AwardOrigin` (award) and `ChallengeResolverOrigin` (resolve_challenge).
 */
export async function submitSudo(
  api: ApiPromise,
  call: SubmittableExtrinsic<'promise'>,
  preferred?: string,
): Promise<EventRecord[]> {
  const sudoKey = (await api.query.sudo.key()).toString();
  const signer = getDevPair(sudoKey) ? sudoKey : (preferred ?? sudoKey);
  if (!getDevPair(signer)) {
    throw new ChainCallError(
      `This call needs Root. The sudo key is ${sudoKey}, which none of the loaded accounts can sign for.`,
    );
  }
  return submit(api, api.tx.sudo.sudo(call), signer);
}

export function hasEvent(events: EventRecord[], section: string, method: string): boolean {
  return events.some((e) => e.event.section === section && e.event.method === method);
}

export function findEvent(events: EventRecord[], section: string, method: string) {
  return events.find((e) => e.event.section === section && e.event.method === method)?.event;
}
