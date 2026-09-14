import type { ButtonHTMLAttributes, ReactNode } from 'react';

interface Props extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'title'> {
  children: ReactNode;
  /** Non-empty string disables the button and shows this as the reason (tooltip + inline note). */
  disabledReason?: string;
  variant?: 'primary' | 'secondary' | 'danger' | 'governance';
}

const VARIANT_CLASSES: Record<NonNullable<Props['variant']>, string> = {
  primary: 'bg-blue-600 text-white hover:bg-blue-700 disabled:bg-slate-300',
  secondary: 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 disabled:text-slate-400',
  danger: 'bg-red-600 text-white hover:bg-red-700 disabled:bg-slate-300',
  governance: 'bg-purple-700 text-white hover:bg-purple-800 disabled:bg-slate-300',
};

/**
 * A button that is always visible so users understand what action exists,
 * but self-explains via tooltip + inline caption why it's disabled when the
 * connected account lacks the required role/relationship to this tender.
 */
export function RoleGatedButton({ children, disabledReason, variant = 'primary', className = '', ...rest }: Props) {
  const disabled = Boolean(disabledReason) || rest.disabled;
  return (
    <div className="inline-flex flex-col items-start gap-1">
      <button
        {...rest}
        disabled={disabled}
        title={disabledReason}
        className={`rounded-md px-3.5 py-2 text-sm font-medium transition disabled:cursor-not-allowed ${VARIANT_CLASSES[variant]} ${className}`}
      >
        {children}
      </button>
      {disabledReason && <span className="max-w-xs text-[11px] leading-snug text-slate-500">{disabledReason}</span>}
    </div>
  );
}
