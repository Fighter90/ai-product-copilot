/**
 * Capturing ResizeObserver stub for jsdom (ANA-177 review round 3): jsdom has no
 * ResizeObserver, and a fully inert stub means `useMeasuredWidth` (routes/funnel.tsx) never
 * fires its callback in any test — the measured-width → pixel-threshold mechanism stayed
 * untested in the component path. This stub stays PASSIVE by default (callbacks register but
 * never auto-fire, so suites stay deterministic) but it RECORDS them, so tests can drive the
 * hook explicitly via {@link fireObservedResize}.
 */
const callbacks: ResizeObserverCallback[] = [];

export class CapturingResizeObserver {
  constructor(callback: ResizeObserverCallback) {
    callbacks.push(callback);
  }

  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

/**
 * Fires every captured observer callback with the given container width. Omit `width` to
 * deliver an empty entry list (no usable measurement — contentRect absent).
 */
export function fireObservedResize(width?: number): void {
  const entries: ResizeObserverEntry[] =
    width === undefined ? [] : [{ contentRect: { width, height: 0 } } as ResizeObserverEntry];
  for (const cb of [...callbacks]) (cb as (entries: ResizeObserverEntry[]) => void)(entries);
}

/** Drops captured callbacks — stale ones belong to already-unmounted UI. Call between tests. */
export function resetObservedResizes(): void {
  callbacks.length = 0;
}
