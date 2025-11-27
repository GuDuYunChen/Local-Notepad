import { defineConfig } from 'vite'
import path from 'node:path'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => ({
  root: 'src',
  plugins: [react()],
  server: { port: 5000, strictPort: true },
  build: { outDir: 'dist' },
  resolve: { alias: { '~': path.resolve(process.cwd(), 'src') } }
}))
