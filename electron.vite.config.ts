import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: { rolldownOptions: { input: { app: resolve('src/main/app.ts') } } },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rolldownOptions: {
        input: { index: resolve('src/preload/index.ts') },
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: { plugins: [react()], base: './' },
})
