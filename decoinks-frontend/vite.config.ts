import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
  build: {
    rollupOptions: {
      output: {
        // Split big third-party libs into their own chunks so they stay
        // cached across deploys (only the small app chunk changes each time).
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'mui-vendor': ['@mui/material', '@mui/system', '@emotion/react', '@emotion/styled'],
          'data-vendor': ['@tanstack/react-query', 'axios'],
          // Heavy, single-page libs split out so they cache separately and
          // don't bloat the page chunk that uses them.
          'charts-vendor': ['recharts'],
          // The full country/state dataset is ~500 kB and only the customer
          // form needs it. On its own chunk it survives a redeploy in cache,
          // so users re-download only the small page chunk that changed.
          'geo-vendor': ['country-state-city'],
        },
      },
    },
  },
})
