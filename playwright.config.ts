import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  reporter: 'list',
  // Both specs build into .output and launch a persistent Chromium profile.
  workers: 1,
});
