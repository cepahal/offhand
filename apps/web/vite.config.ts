import preact from '@preact/preset-vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, loadEnv } from 'vite';
import { demoFiles } from './vite-demo-files.js';

// The hub serves app state, commands, and casepack files. In dev, Vite proxies them together.
// NeuroView volumes are served from this machine so the scanner works while the hub is down.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '../..', ['HUB_', 'VIEWER_']);
  const hub = `http://127.0.0.1:${env.HUB_PORT ?? '8787'}`;
  return {
    plugins: [preact(), tailwindcss(), demoFiles()],
    envDir: '../..',
    envPrefix: ['VITE_', 'WHISPER_'],
    server: {
      host: '127.0.0.1',
      port: Number(env.VIEWER_PORT ?? 5173),
      strictPort: true,
      proxy: {
        '/api': hub,
        '/casepacks': hub,
        '/snapshots': hub,
        '/phone': hub,
        '/share': hub,
        '/ws': { target: hub.replace('http', 'ws'), ws: true },
      },
    },
    build: { outDir: 'dist', target: 'es2022', chunkSizeWarningLimit: 1500 },
  };
});
