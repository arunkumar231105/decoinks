import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    // Not the default "assets". While this app is reached through a /pay/ path
    // on a host that also serves the Customer Portal, both would ask for
    // /assets/index-<hash>.js and the wrong container would answer. A prefix of
    // its own removes the clash, and still works unchanged the day this app
    // gets a domain to itself.
    assetsDir: 'pay-assets',
  },
  server: {
    port: 3003,
    proxy: { '/api': { target: 'http://localhost:8000', changeOrigin: true } },
  },
})
