import preact from '@preact/preset-vite';
import { defineConfig, loadEnv } from 'vite';

// The hub (apps/hub) serves /api, /ws, /casepacks and /snapshots. In dev, Vite proxies them.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '../..', ['HUB_', 'VIEWER_']);
  const hub = `http://127.0.0.1:${env.HUB_PORT ?? '8787'}`;
  return {
    plugins: [preact()],
    server: {
      host: '127.0.0.1',
      port: Number(env.VIEWER_PORT ?? 5173),
      strictPort: true,
      proxy: {
        '/api': hub,
        '/casepacks': hub,
        '/snapshots': hub,
        '/ws': { target: hub.replace('http', 'ws'), ws: true },
      },
    },
    build: { outDir: 'dist', target: 'es2022', chunkSizeWarningLimit: 1500 },
  };
});
