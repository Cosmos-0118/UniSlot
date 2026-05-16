import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pkgJson = JSON.parse(
  readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8'),
) as { version: string }

// https://vite.dev/config/
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkgJson.version),
  },
  build: {
    chunkSizeWarningLimit: 1100,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('exceljs')) return 'vendor-exceljs'
          if (id.includes('framer-motion')) return 'vendor-framer-motion'
          if (id.includes('lucide-react')) return 'vendor-lucide'
          return undefined
        },
      },
    },
  },
  /**
   * ESM workers enable native dynamic import() chunking. Default IIFE inlines the full
   * solver + Excel graph into a ~1 MB monolithic scheduling.worker-*.js entry.
   */
  worker: {
    format: 'es',
    rollupOptions: {
      output: {
        chunkFileNames: 'assets/worker-chunk-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
        manualChunks(id) {
          if (id.includes('node_modules/exceljs')) return 'worker-vendor-exceljs'
          if (id.includes('/solver/localSearchSolver')) return 'worker-core-solver'
          if (id.includes('/solver/')) return 'worker-solver-support'
          if (id.includes('node_modules')) return 'worker-vendor-common'
          return undefined
        },
      },
    },
  },
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        secure: false,
      },
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    passWithNoTests: true,
  },
})
