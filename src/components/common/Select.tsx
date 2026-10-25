import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';

export interface SelectOption<T extends string = string> {
  value: T;
  label: string;
  disabled?: boolean;
  title?: string;
}

interface SelectProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: SelectOption<T>[];
  /** `sm` matches the compact header / filter controls, `md` the form fields. */
  size?: 'sm' | 'md';
  /** Width / layout of the whole control (e.g. `w-full`, `w-32`). */
  className?: string;
  /** Colour overrides for the trigger (e.g. the header's role tint). */
  triggerClassName?: string;
  /** Which edge the list lines up with — `right` for controls near the right edge. */
  align?: 'left' | 'right';
  disabled?: boolean;
  title?: string;
  'aria-label'?: string;
}

/**
 * The portal's one dropdown.
 *
 * A native `<select>` was used before, but its arrow sat wherever each page's
 * padding happened to put it (and the header hid it outright with
 * `appearance-none`), and the option list it opens is drawn by the browser — no
 * rounded corners, no gap from the field, different on every OS. This draws
 * both itself: a fixed, vertically centred chevron, and a rounded list that
 * opens 4px below (or above, when there is no room) the field.
 *
 * Keyboard: ↑/↓/Home/End move, Enter/Space pick, Esc/Tab close, and typing a
 * letter jumps to the next option starting with it — the same as `<select>`.
 */
export function Select<T extends string>({
  value,
  onChange,
  options,
  size = 'md',
  className = 'w-full',
  triggerClassName = 'bg-white text-slate-700',
  align = 'left',
  disabled,
  title,
  'aria-label': ariaLabel,
}: SelectProps<T>) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [dropUp, setDropUp] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const id = useId();

  const selectedIndex = options.findIndex((o) => o.value === value);
  const selected = options[selectedIndex];

  const enabledFrom = (start: number, step: 1 | -1) => {
    for (let i = start; i >= 0 && i < options.length; i += step) if (!options[i].disabled) return i;
    return -1;
  };

  const openList = () => {
    if (disabled || options.length === 0) return;
    setActive(selectedIndex >= 0 && !options[selectedIndex].disabled ? selectedIndex : enabledFrom(0, 1));
    setOpen(true);
  };

  const pick = (i: number) => {
    const o = options[i];
    if (!o || o.disabled) return;
    if (o.value !== value) onChange(o.value);
    setOpen(false);
  };

  // Close on any press outside the control.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // Open upwards when the list would run off the bottom of the viewport.
  useLayoutEffect(() => {
    if (!open || !rootRef.current || !listRef.current) return;
    const field = rootRef.current.getBoundingClientRect();
    const listHeight = listRef.current.offsetHeight;
    const below = window.innerHeight - field.bottom;
    setDropUp(below < listHeight + 8 && field.top > below);
  }, [open]);

  useEffect(() => {
    if (!open || active < 0) return;
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        e.preventDefault();
        openList();
      }
      return;
    }
    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault();
        const next = enabledFrom(active + 1, 1);
        if (next >= 0) setActive(next);
        break;
      }
      case 'ArrowUp': {
        e.preventDefault();
        const prev = enabledFrom(active - 1, -1);
        if (prev >= 0) setActive(prev);
        break;
      }
      case 'Home':
        e.preventDefault();
        setActive(enabledFrom(0, 1));
        break;
      case 'End':
        e.preventDefault();
        setActive(enabledFrom(options.length - 1, -1));
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        pick(active);
        break;
      case 'Escape':
        e.preventDefault();
        setOpen(false);
        break;
      case 'Tab':
        setOpen(false);
        break;
      default:
        if (e.key.length === 1) {
          const ch = e.key.toLowerCase();
          const n = options.length;
          for (let k = 1; k <= n; k++) {
            const i = (active + k) % n;
            if (!options[i].disabled && options[i].label.toLowerCase().startsWith(ch)) {
              setActive(i);
              break;
            }
          }
        }
    }
  };

  const sizing = size === 'sm' ? 'py-1.5 pl-3 pr-8 text-xs font-medium' : 'py-1.5 pl-2.5 pr-9 text-sm';

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-activedescendant={open && active >= 0 ? `${id}-opt-${active}` : undefined}
        aria-label={ariaLabel}
        title={title}
        disabled={disabled}
        onClick={(e) => {
          // A wrapping <label> would re-dispatch this click; handle it once.
          e.preventDefault();
          if (open) setOpen(false);
          else openList();
        }}
        onKeyDown={onKeyDown}
        className={`relative block w-full truncate rounded-md border text-left outline-none transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${sizing} ${
          open ? 'border-blue-400 ring-2 ring-blue-100' : 'border-slate-300 focus-visible:border-blue-400'
        } ${triggerClassName}`}
      >
        {selected?.label ?? ' '}
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          fill="currentColor"
          className={`pointer-events-none absolute top-1/2 h-4 w-4 -translate-y-1/2 opacity-60 transition-transform ${
            size === 'sm' ? 'right-2' : 'right-2.5'
          } ${open ? 'rotate-180' : ''}`}
        >
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.17l3.71-3.94a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06Z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {open && (
        <ul
          ref={listRef}
          id={`${id}-list`}
          role="listbox"
          className={`absolute z-50 max-h-64 min-w-full w-max max-w-[min(28rem,calc(100vw-2rem))] overflow-auto rounded-lg border border-slate-200 bg-white p-1 shadow-lg ring-1 ring-black/5 ${
            dropUp ? 'bottom-full mb-1' : 'top-full mt-1'
          } ${align === 'right' ? 'right-0' : 'left-0'}`}
        >
          {options.map((o, i) => {
            const isSelected = i === selectedIndex;
            return (
              <li
                key={o.value}
                id={`${id}-opt-${i}`}
                data-index={i}
                role="option"
                aria-selected={isSelected}
                aria-disabled={o.disabled || undefined}
                title={o.title}
                onMouseEnter={() => !o.disabled && setActive(i)}
                // Keep focus on the trigger so the keyboard keeps working.
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => {
                  e.preventDefault();
                  pick(i);
                }}
                className={`flex items-center justify-between gap-3 rounded-md px-2.5 py-1.5 ${size === 'sm' ? 'text-xs' : 'text-sm'} ${
                  o.disabled
                    ? 'cursor-not-allowed text-slate-300'
                    : `cursor-pointer text-slate-700 ${i === active ? 'bg-slate-100' : ''}`
                } ${isSelected ? 'font-medium text-slate-900' : ''}`}
              >
                <span className="truncate">{o.label}</span>
                {isSelected && (
                  <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 shrink-0 text-blue-600">
                    <path
                      fillRule="evenodd"
                      d="M16.7 5.3a1 1 0 0 1 0 1.4l-8 8a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.4L8 12.58l7.3-7.3a1 1 0 0 1 1.4 0Z"
                      clipRule="evenodd"
                    />
                  </svg>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
