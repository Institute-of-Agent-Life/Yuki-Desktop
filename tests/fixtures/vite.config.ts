import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
export default defineConfig({
  root: resolve('tests/fixtures'),
  plugins: [react()],
  optimizeDeps: { include: ['diff'] },
  server: {
    host: '127.0.0.1',
    port: 4178,
    strictPort: true,
    fs: { allow: [resolve('src'), resolve('tests/fixtures'), resolve('node_modules')] },
  },
})
