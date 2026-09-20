// Where the account list comes from once the chain is real.
//
// Roles are deliberately *not* read from chain state: the pallet has no role
// registry. An account is an officer because it created a tender, an evaluator
// because it was appointed to one, and governance because it holds the
// AwardOrigin. So the role attached here is a UI lens the operator picks — the
// address is what is real. See the role switcher in `Header.tsx`.

import { Keyring } from '@polkadot/keyring';
import type { KeyringPair } from '@polkadot/keyring/types';
import { cryptoWaitReady } from '@polkadot/util-crypto';
import type { AccountRef, Role } from '../types';

export type AccountSource = 'extension' | 'dev';

// Roles follow the pallet's own testing convention: Alice administers, Bob
// bids, Charlie/Dave/Eve evaluate (MinEvaluators is 3), Ferdie stands in for
// the governed origin. Evaluators must be neither the officer/entity nor a
// bidder on the same tender, which this split guarantees.
//
// Only //Alice and //Bob (and their stashes) are endowed at genesis, so the
// rest need topping up before they can pay a fee — see `fundDevAccounts`.
const DEV_ACCOUNTS: { suri: string; label: string; role: Role }[] = [
  { suri: '//Alice', label: 'Alice', role: 'Officer' },
  { suri: '//Bob', label: 'Bob', role: 'Bidder' },
  { suri: '//Charlie', label: 'Charlie', role: 'Evaluator' },
  { suri: '//Dave', label: 'Dave', role: 'Evaluator' },
  { suri: '//Eve', label: 'Eve', role: 'Evaluator' },
  { suri: '//Ferdie', label: 'Ferdie', role: 'Governance' },
  { suri: '//Alice//stash', label: 'Alice (stash)', role: 'Bidder' },
  { suri: '//Bob//stash', label: 'Bob (stash)', role: 'Bidder' },
];

// Dev pairs are kept so calls can be signed in-page without an extension.
// They are well-known keys on a throwaway chain; nothing secret lives here.
const devPairs = new Map<string, KeyringPair>();

export function getDevPair(address: string): KeyringPair | undefined {
  return devPairs.get(address);
}

export async function devAccounts(ss58Format: number): Promise<AccountRef[]> {
  await cryptoWaitReady();
  const keyring = new Keyring({ type: 'sr25519', ss58Format });
  return DEV_ACCOUNTS.map(({ suri, label, role }) => {
    const pair = keyring.addFromUri(suri);
    devPairs.set(pair.address, pair);
    return { address: pair.address, name: label, role };
  });
}

async function extensionAccounts(): Promise<AccountRef[]> {
  try {
    // Dynamic so the extension bridge (and its polyfills) stay out of the
    // initial bundle, and so a browser with no extension costs nothing.
    const { web3Accounts, web3Enable } = await import('@polkadot/extension-dapp');
    const enabled = await web3Enable('TenderChain');
    if (enabled.length === 0) return [];
    const injected = await web3Accounts();
    return injected.map((a) => ({
      address: a.address,
      name: a.meta.name ?? a.address.slice(0, 8),
      role: 'Public' as Role,
    }));
  } catch {
    // No extension, or the user declined the authorisation prompt.
    return [];
  }
}

/**
 * Prefers a signing extension; falls back to the `--dev` keyring so the portal
 * is usable over plain http, where extension injection is unreliable.
 */
export async function loadAccounts(
  ss58Format: number,
): Promise<{ accounts: AccountRef[]; source: AccountSource }> {
  const injected = await extensionAccounts();
  if (injected.length > 0) return { accounts: injected, source: 'extension' };
  return { accounts: await devAccounts(ss58Format), source: 'dev' };
}
