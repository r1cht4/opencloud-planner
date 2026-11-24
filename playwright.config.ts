import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 120_000,
  expect: {
    timeout: 15_000
  },
  use: {
    // Default = the dev compose stack (docker-compose.yml publishes OpenCloud on 9200).
    baseURL: process.env.OPENCLOUD_URL ?? 'https://localhost:9200',
    viewport: { width: 1440, height: 1000 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] }
    }
  ]
})
