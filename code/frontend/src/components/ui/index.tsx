import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Info, Moon, Sun, X } from 'lucide-react';
import { usePrefs } from '../../store/prefs';
import { useT, fmtNum } from '../../i18n';
import { FRONTEND_BUILD, buildLabel } from '../../lib/build-info';

/** ANA-172: CHANGELOG of the project's own repo (ai-product-copilot was renamed → 404). */
export const GITHUB_CHANGELOG_URL =
  'https://github.com/Fighter90/yandex-metrika-analyse-dashboard/blob/main/CHANGELOG.md';

/** Page title block with optional actions. */
export function PageHeader({
  title,
  subtitle,
  actions,
  eyebrow,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
}): JSX.Element {
  return (
    <div className="mb-6 flex flex-col gap-3 animate-fade-up sm:flex-row sm:items-end sm:justify-between">
      <div>
        {eyebrow && (
          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-accent">
            {eyebrow}
          </div>
        )}
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 max-w-3xl text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Count-up animation for KPI numbers (skipped under reduced motion). */
export function CountUp({
  value,
  digits = 0,
  suffix = '',
}: {
  value: number;
  digits?: number;
  suffix?: string;
}): JSX.Element {
  const { locale } = useT();
  const [shown, setShown] = useState(value);
  const from = useRef(0);
  useEffect(() => {
    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce || typeof requestAnimationFrame === 'undefined') {
      setShown(value);
      return;
    }
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / 700);
      const eased = 1 - Math.pow(1 - k, 3);
      setShown(a + (value - a) * eased);
      if (k < 1) raf = requestAnimationFrame(step);
      else from.current = value;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return (
    <>
      {fmtNum(shown, locale, digits)}
      {suffix}
    </>
  );
}

/** KPI tile with label, animated value, optional delta and hint. */
export function Kpi({
  label,
  value,
  digits = 0,
  suffix,
  delta,
  hint,
  accent,
}: {
  label: ReactNode;
  value: number;
  digits?: number;
  suffix?: string;
  delta?: number | null;
  hint?: ReactNode;
  accent?: boolean;
}): JSX.Element {
  const { locale } = useT();
  return (
    <div
      className={`card group relative overflow-hidden p-4 transition-transform duration-300 hover:-translate-y-0.5 ${
        accent ? 'border-accent/50' : ''
      }`}
    >
      {accent && (
        <div className="pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full bg-accent/20 blur-2xl" />
      )}
      <div className="flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-muted">
        {label}
        {hint && <Hint text={hint} />}
      </div>
      <div className="mt-2 text-3xl font-bold tracking-tight">
        <CountUp value={value} digits={digits} suffix={suffix} />
      </div>
      {delta !== undefined && delta !== null && (
        <div
          className={`mt-1 text-xs font-medium ${delta >= 0 ? 'text-green-600' : 'text-red-600'}`}
        >
          {delta >= 0 ? '▲' : '▼'} {fmtNum(Math.abs(delta * 100), locale, 1)}%
        </div>
      )}
    </div>
  );
}

/** Small "i" tooltip — explanations live here instead of paragraphs under every chart. */
export function Hint({ text }: { text: ReactNode }): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex" onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        aria-label="?"
        className="inline-flex h-4 w-4 items-center justify-center rounded-full text-muted hover:text-accent"
        onMouseEnter={() => setOpen(true)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen((v) => !v)}
      >
        <Info className="h-3.5 w-3.5" />
      </button>
      {open && (
        <span
          role="tooltip"
          className="absolute left-1/2 top-6 z-50 w-64 -translate-x-1/2 rounded-lg border border-line bg-raised p-3 text-xs normal-case leading-relaxed tracking-normal text-ink shadow-xl animate-fade-in"
        >
          {text}
        </span>
      )}
    </span>
  );
}

export function Card({
  title,
  hint,
  actions,
  children,
  className = '',
}: {
  title?: ReactNode;
  hint?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}): JSX.Element {
  return (
    <section className={`card p-4 sm:p-5 animate-fade-up ${className}`}>
      {(title || actions) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-1.5 text-base font-semibold">
            {title}
            {hint && <Hint text={hint} />}
          </h2>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Skeleton({ className = 'h-24' }: { className?: string }): JSX.Element {
  return <div className={`skeleton ${className}`} />;
}

export function ErrorBox({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry?: () => void;
}): JSX.Element {
  const { t } = useT();
  let msg = error instanceof Error ? error.message : String(error);
  try {
    const parsed = JSON.parse(msg) as { error?: string; code?: string };
    msg = parsed.error ?? msg;
  } catch {
    /* plain text */
  }
  return (
    <div role="alert" className="card border-red-300 p-4 text-sm text-red-700">
      <div className="font-semibold">{t('common.error')}</div>
      <div className="mt-1 break-words">{msg.slice(0, 400)}</div>
      {onRetry && (
        <button type="button" className="btn-ghost mt-3" onClick={onRetry}>
          {t('common.retry')}
        </button>
      )}
    </div>
  );
}

/** Dialog widths: md/lg keep the old compact look, xl fits the form-heavy hypothesis/decision editors. */
const MODAL_SIZES: Record<'md' | 'lg' | 'xl', string> = {
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-2xl',
};

export function Modal({
  open,
  title,
  onClose,
  children,
  size = 'lg',
}: {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  /** Dialog width (ANA-75 / БАГ-14): 'md' | 'lg' (default) | 'xl'. */
  size?: keyof typeof MODAL_SIZES;
}): JSX.Element | null {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 p-4 backdrop-blur-sm animate-fade-in sm:items-center"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        className={`card w-full min-w-0 p-5 shadow-2xl animate-fade-up ${MODAL_SIZES[size]}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold">{title}</h3>
          <button
            type="button"
            aria-label="close"
            onClick={onClose}
            className="text-muted hover:text-ink"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/**
 * Styled destructive-action confirmation (БАГ-15 removal-UX): the same Modal chrome as the
 * rest of the app instead of the browser's native window.confirm(). Cancel is the safe
 * default — Escape/backdrop close it, and the confirm button only fires onConfirm once.
 */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  busy = false,
}: {
  open: boolean;
  title: ReactNode;
  body: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}): JSX.Element | null {
  return (
    <Modal open={open} size="md" title={title} onClose={busy ? () => {} : onCancel}>
      <p className="text-sm text-ink" data-testid="confirm-body">
        {body}
      </p>
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className="btn-ghost" onClick={onCancel} disabled={busy}>
          {cancelLabel}
        </button>
        <button
          type="button"
          data-testid="confirm-accept"
          className="btn-danger"
          onClick={onConfirm}
          disabled={busy}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

export function ThemeToggle({
  className = '',
  reload,
}: {
  className?: string;
  /** Default `window.location.reload()`; tests inject a spy (jsdom forbids stubbing it). */
  reload?: () => void;
}): JSX.Element {
  const { theme, toggleTheme } = usePrefs();
  const { t } = useT();
  const label = theme === 'dark' ? t('theme.light') : t('theme.dark');
  const doReload = reload ?? (() => window.location.reload());
  // ANA-173 (регресс прод 15.11, /help): пока запланированный reload не произошёл, повторные
  // клики игнорируются — иначе второй клик возвращает тему обратно (два toggle + два reload),
  // и тумблер выглядит мёртвым. Без хранилища reload не планируется — клики работают как обычно.
  const reloadPending = useRef(false);
  return (
    <button
      type="button"
      onClick={() => {
        if (reloadPending.current) return;
        // Тема красит и canvas-графики (ECharts) — надёжнее перезагрузить страницу,
        // чтобы все диаграммы/стили пересобрались чисто под новую тему.
        // ANA-173: если хранилище недоступно, выбор не переживёт перезагрузку —
        // страница вернулась бы как была, и тумблер выглядел бы мёртвым. Применяем на месте.
        if (toggleTheme()) {
          reloadPending.current = true;
          doReload();
        }
      }}
      title={label}
      aria-label={label}
      className={`inline-flex h-9 w-9 items-center justify-center rounded-md border border-line text-ink transition-colors hover:border-accent hover:text-accent ${className}`}
    >
      {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}

export function LangToggle({
  className = '',
  onChange,
  reload,
}: {
  className?: string;
  onChange?: (l: 'ru' | 'en') => void;
  /** Default `window.location.reload()`; tests inject a spy (jsdom forbids stubbing it). */
  reload?: () => void;
}): JSX.Element {
  const { locale, setLocale } = usePrefs();
  const { t } = useT();
  const doReload = reload ?? (() => window.location.reload());
  // ANA-173 (регресс прод 15.11, EN на лендинге, 3 клика): каждый клик планировал свой reload;
  // гонка перезагрузок оставляла страницу на прежнем языке. Пока reload в полёте — клики
  // игнорируются. Без хранилища reload не планируется — язык применяется на месте.
  const reloadPending = useRef(false);
  return (
    <div
      role="group"
      aria-label={t('lang.switch')}
      className={`inline-flex h-9 overflow-hidden rounded-md border border-line text-xs font-semibold ${className}`}
    >
      {(['ru', 'en'] as const).map((l) => (
        <button
          key={l}
          type="button"
          aria-pressed={locale === l}
          onClick={() => {
            if (reloadPending.current) return;
            // Язык меняет все тексты и даты — надёжнее перезагрузить страницу целиком.
            // ANA-173: без хранилища перезагрузка стёрла бы выбор (мёртвая кнопка на
            // публичных страницах) — тогда применяем язык на месте, без перезагрузки.
            const persisted = setLocale(l);
            onChange?.(l);
            if (persisted) {
              reloadPending.current = true;
              doReload();
            }
          }}
          className={`px-2.5 uppercase transition-colors ${locale === l ? 'bg-accent text-onaccent' : 'text-muted hover:text-ink'}`}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

/** «v3.1.0 · a1b2c3d · 25.10.2026» — version, git SHA and build date injected at build time. */
export function VersionBadge({ className = '' }: { className?: string }): JSX.Element {
  return (
    <a
      href={GITHUB_CHANGELOG_URL}
      target="_blank"
      rel="noreferrer"
      data-testid="version-badge"
      className={`font-mono text-[11px] text-muted hover:text-accent ${className}`}
      title={`build ${FRONTEND_BUILD.sha} · ${FRONTEND_BUILD.date}`}
    >
      {buildLabel(FRONTEND_BUILD)}
    </a>
  );
}

/** Status pill for live/sleeping/dead etc. `title` adds a tooltip (ANA-138 badge reasons). */
export function Pill({
  tone,
  title,
  children,
}: {
  tone: 'green' | 'amber' | 'red' | 'neutral' | 'accent';
  title?: string;
  children: ReactNode;
}): JSX.Element {
  const cls = {
    green: 'border-green-300 bg-green-50 text-green-700',
    amber: 'border-amber-300 bg-amber-50 text-amber-700',
    red: 'border-red-300 bg-red-50 text-red-700',
    neutral: 'border-line bg-raised text-muted',
    accent: 'border-accent/40 bg-accent/10 text-accent',
  }[tone];
  return (
    <span
      title={title}
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${cls}`}
    >
      {children}
    </span>
  );
}

/** Live indicator dot. */
export function LiveDot({ paused }: { paused?: boolean }): JSX.Element {
  return (
    <span className="relative inline-flex h-2.5 w-2.5">
      {!paused && (
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />
      )}
      <span
        className={`relative inline-flex h-2.5 w-2.5 rounded-full ${paused ? 'bg-muted' : 'bg-accent'}`}
      />
    </span>
  );
}
