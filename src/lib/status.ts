import type { TenderState } from '../types';

export interface StatusTheme {
  label: string;
  bg: string;
  text: string;
  dot: string;
  border: string;
}

export const STATUS_THEME: Record<TenderState, StatusTheme> = {
  Draft: { label: 'Draft', bg: 'bg-slate-100', text: 'text-slate-600', dot: 'bg-slate-400', border: 'border-slate-300' },
  Published: { label: 'Published — Q&A', bg: 'bg-blue-50', text: 'text-blue-700', dot: 'bg-blue-500', border: 'border-blue-200' },
  Submission: { label: 'Submission open', bg: 'bg-blue-50', text: 'text-blue-700', dot: 'bg-blue-600', border: 'border-blue-200' },
  Closed: { label: 'Closed', bg: 'bg-slate-100', text: 'text-slate-600', dot: 'bg-slate-500', border: 'border-slate-300' },
  Opening: { label: 'Opening — reveal', bg: 'bg-amber-50', text: 'text-amber-700', dot: 'bg-amber-500', border: 'border-amber-200' },
  Evaluation: { label: 'Evaluation', bg: 'bg-amber-50', text: 'text-amber-700', dot: 'bg-amber-600', border: 'border-amber-200' },
  Awarded: { label: 'Awarded', bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500', border: 'border-emerald-200' },
  Standstill: { label: 'Standstill — challenge window', bg: 'bg-orange-50', text: 'text-orange-700', dot: 'bg-orange-500', border: 'border-orange-200' },
  Contracted: { label: 'Contracted', bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-600', border: 'border-emerald-200' },
  Cancelled: { label: 'Cancelled', bg: 'bg-neutral-200', text: 'text-neutral-700', dot: 'bg-neutral-500', border: 'border-neutral-300' },
};

export function hasOpenChallenge(state: TenderState) {
  return state === 'Standstill';
}
