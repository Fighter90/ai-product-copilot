/**
 * Frontend build stamp (ANA-43): product version from the root package.json, short git SHA and
 * build date, injected by Vite `define` (vite.config.ts). Under vitest the constants are absent →
 * «dev» placeholders.
 */
export interface BuildInfo {
  readonly version: string;
  /** Short git SHA (7 chars) or «dev». */
  readonly sha: string;
  /** Build date, ISO `YYYY-MM-DD`, or '' when unknown. */
  readonly date: string;
}

export const FRONTEND_BUILD: BuildInfo = {
  version: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev',
  sha: typeof __BUILD_SHA__ === 'string' ? __BUILD_SHA__ : 'dev',
  date: typeof __BUILD_DATE__ === 'string' ? __BUILD_DATE__ : '',
};

/** `2026-10-25` → `25.10.2026`; anything else is returned as is. */
export function formatBuildDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : iso;
}

/** «v3.1.0 · a1b2c3d · 25.10.2026» (missing parts are skipped). */
export function buildLabel(b: BuildInfo = FRONTEND_BUILD): string {
  return [`v${b.version}`, b.sha && b.sha !== 'dev' ? b.sha : '', formatBuildDate(b.date)]
    .filter(Boolean)
    .join(' · ');
}

/** What `GET /api/health` reports about the backend build. */
export interface BackendBuild {
  readonly version?: string | null;
  /** Full git SHA from BUILD_SHA (deploy.sh), or null in dev. */
  readonly build?: string | null;
}

export interface BuildMismatch {
  readonly field: 'version' | 'build';
  readonly frontend: string;
  readonly backend: string;
}

const known = (s: string | null | undefined): s is string => !!s && s !== 'dev';

/**
 * Compare the frontend bundle with the backend: a different version, or a different commit when
 * both sides know theirs (short vs full SHA compare by prefix). Unknown sides never mismatch.
 */
export function buildMismatch(
  front: BuildInfo,
  back: BackendBuild | null | undefined,
): BuildMismatch | null {
  if (!back) return null;
  if (known(front.version) && known(back.version) && front.version !== back.version) {
    return { field: 'version', frontend: front.version, backend: back.version };
  }
  if (known(front.sha) && known(back.build)) {
    const a = front.sha.toLowerCase();
    const b = back.build.toLowerCase();
    if (!b.startsWith(a) && !a.startsWith(b)) {
      return { field: 'build', frontend: front.sha, backend: back.build.slice(0, 7) };
    }
  }
  return null;
}
