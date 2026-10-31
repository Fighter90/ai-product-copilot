import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const FRONTEND_PORT = Number(process.env.PORT) || 5173;
const API_PORT = Number(process.env.API_PORT) || 4000;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const version = (
  JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string }
).version;
const sha = (() => {
  if (process.env.BUILD_SHA) return process.env.BUILD_SHA.slice(0, 7);
  try {
    return execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim();
  } catch {
    return 'dev';
  }
})();

// BUILD_DATE (ISO) may be pinned by the deploy for reproducible bundles; defaults to today (UTC).
const buildDate = (process.env.BUILD_DATE ?? new Date().toISOString()).slice(0, 10);

// The backend mounts everything under /api; proxy keeps the path so /api/health resolves.
export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __APP_SHA__: JSON.stringify(sha),
    __APP_BUILT__: JSON.stringify(buildDate),
    // ANA-43: build stamp for the footer and the frontend↔backend build check (/api/health).
    __BUILD_SHA__: JSON.stringify(sha),
    __BUILD_DATE__: JSON.stringify(buildDate),
  },
  server: {
    port: FRONTEND_PORT,
    proxy: {
      '/api': {
        target: `http://localhost:${API_PORT}`,
        changeOrigin: true,
      },
    },
  },
  build: {
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        manualChunks: {
          // ANA-41: echarts (~1.1MB / gzip ~385KB) должен оставаться ленивым — он достижим
          // только через динамический import() в components/charts (React.lazy EChartInner),
          // поэтому chunk грузится лишь когда реально рендерится график. Не импортировать
          // echarts / echarts-for-react из статики (App, layouts, shared-компоненты)!
          echarts: ['echarts', 'echarts-for-react'],
          react: ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
  },
});
