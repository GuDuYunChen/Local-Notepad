import { defineConfig } from 'vite'
import path from 'node:path'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => ({
  root: 'src',
  base: './', // 确保 Electron 环境下资源路径正确
  plugins: [react()],
  server: { port: 5000, strictPort: true },
  build: { 
    outDir: '../dist', // 避免 dist 目录占用问题，
    emptyOutDir: true 
  },
  resolve: { alias: { '~': path.resolve(process.cwd(), 'src') } }
}))
