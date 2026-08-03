import { defineConfig, devices } from '@playwright/test'
import * as fs from 'fs'
import * as path from 'path'

// Load .env file if present
const envFile = path.join(__dirname, '.env')
if (fs.existsSync(envFile)) {
  fs.readFileSync(envFile, 'utf8').split('\n').forEach(line => {
    const [k, ...v] = line.split('=')
    if (k && !k.startsWith('#') && v.length) process.env[k.trim()] = v.join('=').trim()
  })
}

// Tests run against the app on the server's own ports, which bypasses the
// Authentik SSO proxy in front of the public hostname — so the normal
// email/password login works and no SSO round-trip is needed.
const BASE_URL = process.env.BASE_URL || 'http://localhost:8093'

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,       // sequential — shared DB + token rotation
  retries: 1,
  timeout: 45_000,            // 45s per test (remote server needs time)
  reporter: [
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['line'],
  ],
  use: {
    baseURL: BASE_URL,
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
    headless: true,
    navigationTimeout: 30_000,
    actionTimeout:    15_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
})
