// Sized for a 16 GB laptop: one test at a time, headless Chromium shell only, no video.
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
    testDir: './tests',
    workers: 1,
    timeout: 90_000,
    expect: { timeout: 15_000 },
    reporter: [['list']],
    globalSetup: require.resolve('./support/global-setup'),
    globalTeardown: require.resolve('./support/global-teardown'),
    use: {
        baseURL: 'http://localhost:3000',
        headless: true,
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
        video: 'off'
    },
    projects: [{ name: 'chromium', use: { browserName: 'chromium' } }]
});
