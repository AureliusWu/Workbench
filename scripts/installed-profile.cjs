const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron } = require('playwright');

const [executable, profile, mode, expectedVersion, evidenceDir] = process.argv.slice(2);
if (!executable || !profile || !['seed', 'verify'].includes(mode) || !expectedVersion || !evidenceDir) {
  throw new Error('Usage: node scripts/installed-profile.cjs <exe> <profile> <seed|verify> <version> <evidence>');
}
const root = path.resolve(__dirname, '..');
const resolvedProfile = path.resolve(profile);
const testRoot = path.join(root, 'artifacts');
const relative = path.relative(testRoot, resolvedProfile);
const inArtifacts = relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
const defaultProfile = path.join(process.env.APPDATA || '', 'Workbench');
const hostedProfile = process.env.GITHUB_ACTIONS === 'true' && process.env.RUNNER_ENVIRONMENT === 'github-hosted' && resolvedProfile.toLowerCase() === path.resolve(defaultProfile).toLowerCase();
if (!inArtifacts && !hostedProfile) throw new Error('Installer test profile must be isolated under artifacts or use an ephemeral GitHub-hosted Windows profile.');
fs.mkdirSync(evidenceDir, { recursive: true });
const stateFile = path.join(resolvedProfile, 'workbench.json');
const fixture = {
  schemaVersion: 1,
  tasks: [
    { id: 'installer-legacy-task', title: '安装升级保留的待办', date: '2026-11-25', time: '', priority: 'high', done: false, createdAt: '2026-11-24T01:00:00.000Z', steps: [{ id: 'installer-legacy-step', title: '保留这个小步骤', done: true }], repeat: 'none', estimate: 25, reminder: false },
    { id: 'installer-completed-task', title: '已完成的历史任务', date: '2026-11-23', time: '', priority: 'medium', done: true, completedAt: '2026-11-23T08:00:00.000Z', createdAt: '2026-11-23T01:00:00.000Z', steps: [{ id: 'installer-completed-step', title: '历史已完成步骤', done: true }], repeat: 'none', estimate: 25, reminder: false },
  ],
  notes: [{ id: 'installer-legacy-note', text: '这是旧版本数据，安装升级后必须保留。', color: 'lavender', createdAt: '2026-11-24T01:00:00.000Z' }],
  focusSessions: [{ id: 'installer-legacy-focus', date: '2026-11-24', minutes: 25 }],
  reviews: { '2026-11-23': '旧版本已保存的周复盘。' },
  settings: { name: '安装升级验证', lastSaturdayWork: true, dayOverrides: { '2026-11-26': 'rest' }, focusMinutes: 25, breakMinutes: 5, morningGreeting: false, autoLaunch: false, aiEndpoint: 'https://api.openai.com/v1', aiModel: 'gpt-4.1-mini' },
};
if (mode === 'seed') {
  if (fs.existsSync(stateFile)) throw new Error('Refusing to overwrite an existing state file while seeding the installer fixture.');
  fs.mkdirSync(resolvedProfile, { recursive: true });
  fs.writeFileSync(stateFile, JSON.stringify(fixture, null, 2));
}

let app;
let page;
const result = { mode, expectedVersion, profile: resolvedProfile, status: 'FAIL' };
async function main() {
  const env = { ...process.env, WORKBENCH_DATA_DIR: resolvedProfile };
  if (hostedProfile) delete env.WORKBENCH_DATA_DIR;
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.WORKBENCH_DEV_URL;
  app = await electron.launch({ executablePath: path.resolve(executable), args: [], cwd: path.dirname(executable), env, timeout: 30000 });
  const nativeProfile = await app.evaluate(({ app }) => app.getPath('userData'));
  assert.equal(path.resolve(nativeProfile).toLowerCase(), resolvedProfile.toLowerCase(), 'installed executable must discover the expected real user-data location');
  result.nativeUserDataPath = nativeProfile;
  page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => Boolean(window.workbench), undefined, { timeout: 20000 });
  const version = await page.evaluate(() => window.workbench.version());
  assert.equal(version, expectedVersion);
  const loaded = await page.evaluate(() => window.workbench.load());
  assert.ok(loaded, 'installed program must load the seeded profile');
  assert.equal(loaded.tasks.find(task => task.id === 'installer-legacy-task').title, fixture.tasks[0].title);
  assert.deepEqual(loaded.tasks.find(task => task.id === 'installer-legacy-task').steps, fixture.tasks[0].steps);
  const completed = loaded.tasks.find(task => task.id === 'installer-completed-task');
  assert.equal(completed.done, true);
  assert.equal(completed.completedAt, '2026-11-23T08:00:00.000Z');
  assert.equal(completed.steps[0].done, true);
  assert.equal(loaded.notes.find(note => note.id === 'installer-legacy-note').text, fixture.notes[0].text);
  assert.equal(loaded.reviews['2026-11-23'], fixture.reviews['2026-11-23']);
  assert.equal(loaded.focusSessions.find(item => item.id === 'installer-legacy-focus').minutes, 25);
  assert.equal(loaded.settings.dayOverrides['2026-11-26'], 'rest');
  if (mode === 'seed') await page.evaluate(() => window.workbench.saveApiKey('installer-qa-test-only-key'));
  assert.equal(await page.evaluate(() => window.workbench.hasApiKey()), true);
  assert.equal(JSON.stringify(loaded).includes('installer-qa-test-only-key'), false);
  // Allow the normal renderer load/save effect to finish before shutting down.
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(evidenceDir, `installed-${mode}.png`), fullPage: true });
  assert.deepEqual(errors, []);
  result.status = 'PASS';
  result.version = version;
  result.legacyRecordsPreserved = true;
  result.historicalCompletionPreserved = true;
  result.encryptedKeyPresent = true;
}
main().catch(async error => {
  result.failure = error.stack || String(error);
  if (page && !page.isClosed()) await page.screenshot({ path: path.join(evidenceDir, `installed-${mode}-failure.png`), fullPage: true }).catch(() => {});
  console.error(result.failure);
  process.exitCode = 1;
}).finally(async () => {
  if (app) await app.close().catch(() => {});
  fs.writeFileSync(path.join(evidenceDir, `installed-${mode}.json`), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
});
