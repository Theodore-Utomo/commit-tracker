import { execFile } from 'node:child_process';
import { readdir, readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { chromium, expect, test, type BrowserContext } from '@playwright/test';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(import.meta.dirname, '../..');
const extensionPath = path.join(repoRoot, '.output/chrome-mv3');

// A trace, screenshot, or video would record the token typed into the options page.
test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test.describe.configure({ timeout: 300_000 });

let userDataDir: string | undefined;
let context: BrowserContext | undefined;

test.beforeAll(async () => {
  if (!process.env.E2E_GITHUB_TOKEN?.trim()) {
    throw new Error('E2E_GITHUB_TOKEN is not set');
  }
  await execFileAsync('pnpm', ['build'], { cwd: repoRoot });
  await assertContentScriptOmitsToken();
});

test.afterAll(async () => {
  await context?.close();
  if (userDataDir) {
    await rm(userDataDir, { recursive: true, force: true });
  }
});

test("shows the all-branches heatmap on someone else's profile", async () => {
  const token = process.env.E2E_GITHUB_TOKEN?.trim();
  if (!token) {
    throw new Error('E2E_GITHUB_TOKEN is not set');
  }

  const login = await viewerLogin(token);
  test.skip(login.toLowerCase() === 'octocat', 'the viewer is octocat, so this profile is not someone else');

  userDataDir = await mkdtemp(path.join(tmpdir(), 'commit-tracker-e2e-'));
  // Headless shell cannot load extensions. Headed Chromium can.
  context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });

  const extensionId = await workerExtensionId(context);
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await options.locator('#token').fill(token);
  await options.getByRole('button', { name: 'Save token' }).click();
  await expect(options.getByText('Token saved.')).toBeVisible();
  await options.close();

  const profile = await context.newPage();
  await profile.goto('https://github.com/octocat');
  const graph = profile.locator('.js-calendar-graph-table, .js-yearly-contributions').first();
  await graph.waitFor();
  await graph.scrollIntoViewIfNeeded();

  const accept = profile.locator('commit-tracker').getByRole('button', { name: 'See commits across all branches' });
  await expect(accept).toBeVisible();
  await accept.click();

  const heatmap = profile.locator('commit-tracker');
  await expect(heatmap.getByRole('heading', { name: 'All commits across branches' })).toBeVisible({
    timeout: 240_000,
  });
});

async function viewerLogin(token: string): Promise<string> {
  const response = await fetch('https://api.github.com/user', {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'commit-tracker-e2e',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!response.ok) {
    throw new Error(`GET https://api.github.com/user failed with status ${response.status}`);
  }
  const body: unknown = await response.json();
  if (typeof body !== 'object' || body === null || !('login' in body) || typeof body.login !== 'string' || !body.login) {
    throw new Error('GET https://api.github.com/user returned no login');
  }
  return body.login;
}

async function workerExtensionId(browserContext: BrowserContext): Promise<string> {
  const existing = browserContext.serviceWorkers()[0];
  const worker = existing ?? (await browserContext.waitForEvent('serviceworker'));
  return new URL(worker.url()).host;
}

async function assertContentScriptOmitsToken(): Promise<void> {
  const dir = path.join(extensionPath, 'content-scripts');
  const names = (await readdir(dir)).filter((name) => name.endsWith('.js'));
  if (names.length === 0) {
    throw new Error('No content script bundle was built');
  }
  for (const name of names) {
    const source = await readFile(path.join(dir, name), 'utf8');
    if (source.includes('githubToken')) {
      throw new Error('The content script bundle contains githubToken');
    }
  }
}
