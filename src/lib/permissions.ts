import type { AccountRef, Tender } from '../types';

/** Returns a disabled-reason string when the account cannot perform the action, or undefined when allowed. */

export function requireAccount(account: AccountRef | null): string | undefined {
  if (!account) return 'Connect a wallet to perform this action.';
  return undefined;
}

export function requireOfficer(account: AccountRef | null, tender: Tender): string | undefined {
  const base = requireAccount(account);
  if (base) return base;
  if (account!.role !== 'Officer') return 'Only a Procuring Officer account can perform this action.';
  if (account!.address !== tender.officer) return "Only this tender's officer account can perform this action.";
  return undefined;
}

export function requireBidder(account: AccountRef | null): string | undefined {
  const base = requireAccount(account);
  if (base) return base;
  if (account!.role !== 'Bidder') return 'Only a Bidder/Supplier account can perform this action.';
  return undefined;
}

export function requireEvaluator(account: AccountRef | null, tender: Tender): string | undefined {
  const base = requireAccount(account);
  if (base) return base;
  if (account!.role !== 'Evaluator') return 'Only an Evaluator account can perform this action.';
  if (!tender.evaluators.includes(account!.address)) return 'This account is not appointed to evaluate this tender.';
  return undefined;
}

export function requireGovernance(account: AccountRef | null): string | undefined {
  const base = requireAccount(account);
  if (base) return base;
  if (account!.role !== 'Governance') return 'This action requires a governed origin (Multisig/Root) — a plain signed call will fail here.';
  return undefined;
}
