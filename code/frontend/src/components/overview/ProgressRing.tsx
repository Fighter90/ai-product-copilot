/** Compact SVG progress ring for the Overview hero (current / target). */
export function ProgressRing({
  progress,
  label,
  caption,
  ariaLabel,
}: {
  /** 0..1 */
  progress: number;
  /** Big number in the centre. */
  label: string;
  /** Small line under the number (e.g. «из 300»). */
  caption: string;
  ariaLabel: string;
}): JSX.Element {
  const r = 42;
  const circumference = 2 * Math.PI * r;
  const p = Math.min(Math.max(progress, 0), 1);
  const color = p >= 1 ? '#22c55e' : p >= 0.5 ? '#f59e0b' : '#ef4444';
  return (
    <div
      role="img"
      aria-label={ariaLabel}
      className="relative h-20 w-20 shrink-0 lg:h-24 lg:w-24"
      data-testid="progress-ring"
    >
      <svg viewBox="0 0 100 100" className="h-full w-full" aria-hidden="true">
        <circle cx="50" cy="50" r={r} fill="none" stroke="#e2e8f0" strokeWidth="9" />
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="9"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - p)}
          strokeLinecap="round"
          transform="rotate(-90 50 50)"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center leading-tight">
        <span className="text-lg font-bold lg:text-xl">{label}</span>
        <span className="text-[10px] text-slate-500 lg:text-xs">{caption}</span>
      </div>
    </div>
  );
}
