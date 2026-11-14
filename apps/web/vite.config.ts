import preact from '@preact/preset-vite';
import { defineConfig, loadEnv } from 'vite';
import { demoFiles } from './vite-demo-files.js';

// The hub (apps/hub) serves /api, /ws, /snapshots, /phone and /share. In dev, Vite proxies them.
// NeuroView volumes are served from this machine so the scanner works while the hub is down.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '../..', ['HUB_', 'VIEWER_']);
  const hub = `http://127.0.0.1:${env.HUB_PORT ?? '8787'}`;
  return {
    plugins: [preact(), demoFiles()],
    envDir: '../..',
    envPrefix: ['VITE_', 'WHISPER_'],
    server: {
      host: '127.0.0.1',
      port: Number(env.VIEWER_PORT ?? 5173),
      strictPort: true,
      proxy: {
        '/api': hub,
        '/snapshots': hub,
        '/phone': hub,
        '/share': hub,
        '/ws': { target: hub.replace('http', 'ws'), ws: true },
      },
    },
    build: { outDir: 'dist', target: 'es2022', chunkSizeWarningLimit: 1500 },
  };
});
