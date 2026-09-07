import { defineConfig, devices } from '@playwright/test';

const APP_DIR = '../examples/motion-starter';
const JAR = `${APP_DIR}/target/motion-starter-1.0.0-SNAPSHOT.jar`;
const PORT = process.env.E2E_PORT ?? '8090';
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
    testDir: './tests',
    timeout: 90_000,
    expect: { timeout: 15_000 },
    fullyParallel: false,
    workers: 1,
    reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
    use: {
        baseURL: BASE_URL,
        trace: 'on-first-retry',
        screenshot: 'only-on-failure',
        video: 'retain-on-failure',
    },
    webServer: {
        // Runs the production jar: dev mode needs the vaadin-dev-server dependency, while this
        // suite only verifies runtime behaviour. Prerequisite: mvn package -Pproduction (see README).
        command: `java -jar ${JAR} --server.port=${PORT}`,
        url: `${BASE_URL}/`,
        timeout: 180_000,
        reuseExistingServer: !process.env.CI,
        stdout: 'pipe',
        stderr: 'pipe',
    },
    projects: [
        { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
        { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    ],
});
