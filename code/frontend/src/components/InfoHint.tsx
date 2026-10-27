import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Info } from 'lucide-react';
import { useT } from '../i18n';

export interface InfoHintProps {
  /** Popover content: a definition, formula, source, or a chart's caveats. */
  readonly text: ReactNode;
  /** Accessible name of the «i» button; defaults to «Подсказка» / «Hint». */
  readonly label?: string;
  /** Popover alignment relative to the button. */
  readonly align?: 'center' | 'start' | 'end';
  readonly className?: string;
}

const ALIGN: Record<NonNullable<InfoHintProps['align']>, string> = {
  center: 'left-1/2 -translate-x-1/2',
  start: 'left-0',
  end: 'right-0',
};

/**
 * Accessible «i» hint next to a metric label or a chart title. The button is described by the
 * popover (`aria-describedby`), which stays in the DOM (visually hidden while closed) so screen
 * readers announce it on focus. Opens on hover/focus, click pins it, Escape or a click outside
 * closes it.
 */
export function InfoHint({
  text,
  label,
  align = 'center',
  className = '',
}: InfoHintProps): JSX.Element {
  const { t } = useT();
  const id = useId();
  const [hover, setHover] = useState(false);
  const [pinned, setPinned] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const open = hover || pinned;

  useEffect(() => {
    if (!pinned) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setPinned(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [pinned]);

  const close = (): void => {
    setHover(false);
    setPinned(false);
  };

  return (
    <span
      ref={ref}
      className={`relative inline-flex align-middle ${className}`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <button
        type="button"
        aria-label={label ?? t('hint.info')}
        aria-describedby={id}
        aria-expanded={open}
        onFocus={() => setHover(true)}
        onBlur={() => setHover(false)}
        onClick={() => setPinned((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && open) {
            e.stopPropagation();
            close();
          }
        }}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full text-muted hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <Info className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      <span
        id={id}
        role="tooltip"
        data-open={open ? 'true' : 'false'}
        className={
          open
            ? `absolute top-6 z-50 w-72 max-w-[80vw] rounded-lg border border-line bg-raised p-3 text-left text-xs font-normal normal-case leading-relaxed tracking-normal text-ink shadow-xl animate-fade-in ${ALIGN[align]}`
            : 'sr-only'
        }
      >
        {text}
      </span>
    </span>
  );
}
