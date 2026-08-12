import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3002,
    proxy: {
      // The customer-facing API module (wired up in a later phase).
      '/api/portal': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})
