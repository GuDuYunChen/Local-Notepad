import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'happy-dom', // Use happy-dom instead of jsdom to avoid webidl-conversions issue
    setupFiles: ['./vitest.setup.js'],
  },
  resolve: {
    alias: {
      '~': path.resolve(process.cwd(), 'src'),
    },
  },
});
