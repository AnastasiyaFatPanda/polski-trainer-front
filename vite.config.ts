import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { vocabApi } from './server/vocabApi';

export default defineConfig({
  plugins: [react(), vocabApi()],
  server: {
    port: 5180,
    open: true,
  },
  // onnxruntime-web ships prebuilt wasm; keep it out of the dep pre-bundler
  optimizeDeps: {
    exclude: ['@mintplex-labs/piper-tts-web'],
  },
});
