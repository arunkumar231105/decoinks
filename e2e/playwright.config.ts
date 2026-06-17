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

const BASE_URL = process.env.BASE_URL || 'http://31.97.110.197'

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,       // run sequentially so shared DB state is predictable
  retries: 1,                 // retry once on flake
  timeout: 30_000,            // 30s per test
  reporter: [
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['line'],
  ],
  use: {
    baseURL: BASE_URL,
    screenshot: 'only-on-failure',   // screenshot on failure
    video: 'retain-on-failure',      // video on failure
    trace: 'retain-on-failure',
    headless: true,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
})
