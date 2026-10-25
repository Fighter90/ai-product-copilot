/** ProductCamp-styled orbit mark (original artwork, not the ProductCamp logo). */
export function BrandMark({ className = 'h-8 w-8' }: { className?: string }): JSX.Element {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="rgb(var(--c-ink))" />
      <circle cx="16" cy="16" r="9" fill="none" stroke="#FF4D14" strokeWidth="3" />
      <circle cx="16" cy="16" r="3" fill="#FF4D14" />
      <circle cx="24.5" cy="9" r="2" fill="rgb(var(--c-canvas))" />
    </svg>
  );
}
