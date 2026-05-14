import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      // Future-proofing for backend API (user accounts, etc.)
      '/api': {
        target: 'http://localhost:3000', // Replace with your future backend URL
        changeOrigin: true,
        secure: false,
      },
    },
  },
})
