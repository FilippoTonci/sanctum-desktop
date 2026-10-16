import { defineConfig } from '@playwright/test'

// Installed-app smoke test (tests/package). Kept out of the default config:
// it needs a real installed build, which only the packaging workflow has.
export default defineConfig({
  testDir: './tests/package',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
})
