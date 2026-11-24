// Verifies the exact self-extracting EXE without requiring its wrapper to forward Node debugger output.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const executable = path.resolve(process.argv[2] || path.join(root, 'release', `Workbench-${require('../package.json').version}-win-x64.exe`));
const evidence = path.join(root, 'artifacts', `portable-${Date.now()}`);
const dataDir = path.join(evidence, 'isolated-data');
const result = { executable, launchMs: [], evidence, version: null };
fs.mkdirSync(dataDir, { recursive: true });
let child;
let browser;
let page;
let childOutput = '';

async function until(check, description, timeout = 60000) {
  const start = performance.now();
  while (performance.now() - start < timeout) {
    const value = await check();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out: ${description}`);
}

async function launch() {
  const portFile = path.join(dataDir, 'DevToolsActivePort');
  if (fs.existsSync(portFile)) fs.unlinkSync(portFile);
  const env = { ...process.env, WORKBENCH_DATA_DIR: dataDir };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.WORKBENCH_DEV_URL;
  const started = performance.now();
  child = spawn(executable, ['--remote-debugging-port=0'], { cwd: path.dirname(executable), env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', value => { childOutput += value.toString(); });
  child.stderr.on('data', value => { childOutput += value.toString(); });
  child.on('error', error => { result.spawnError = error.message; });
  const port = await until(() => {
    if (!fs.existsSync(portFile)) return null;
    const firstLine = fs.readFileSync(portFile, 'utf8').split(/\r?\n/)[0];
    return /^\d+$/.test(firstLine) ? Number(firstLine) : null;
  }, 'portable EXE to extract and expose its Chromium test port');
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  page = await until(() => browser.contexts()[0].pages().find(candidate => candidate.url().includes('index.html')), 'packaged main page');
  await page.getByTestId('calendar-view').waitFor({ state: 'visible', timeout: 30000 });
  result.launchMs.push(Math.round(performance.now() - started));
  result.version = await page.evaluate(() => window.workbench.version());
}

async function stop() {
  if (browser) await browser.close().catch(() => {});
  browser = undefined;
  if (child && child.exitCode === null) {
    await new Promise(resolve => {
      const kill = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      kill.on('exit', resolve); kill.on('error', resolve);
    });
  }
  child = undefined;
}

async function main() {
  if (!fs.existsSync(executable)) throw new Error(`EXE not found: ${executable}`);
  await launch();
  if (result.version !== require('../package.json').version) throw new Error(`Wrong packaged version: ${result.version}`);
  await page.getByRole('button', { name: '新建待办', exact: true }).click();
  await page.getByTestId('task-title-input').fill('便携发行包启动与保存验证');
  await page.getByTestId('add-task-submit').click();
  await page.getByTestId('task-item').filter({ hasText: '便携发行包启动与保存验证' }).waitFor();
  await until(async () => (await page.evaluate(() => window.workbench.load()))?.tasks.some(task => task.title === '便携发行包启动与保存验证'), 'portable save');
  await page.screenshot({ path: path.join(evidence, 'portable-first-launch.png'), fullPage: true });
  await stop();
  await launch();
  await page.getByTestId('task-item').filter({ hasText: '便携发行包启动与保存验证' }).waitFor();
  await page.screenshot({ path: path.join(evidence, 'portable-restart.png'), fullPage: true });
  result.status = 'PASS';
  result.persistenceAfterRestart = true;
  console.log(JSON.stringify(result, null, 2));
}

main().catch(async error => {
  result.status = 'FAIL'; result.failure = error.stack || String(error);
  if (page && !page.isClosed()) await page.screenshot({ path: path.join(evidence, 'failure.png'), fullPage: true }).catch(() => {});
  console.error(result.failure); process.exitCode = 1;
}).finally(async () => {
  await stop();
  fs.writeFileSync(path.join(evidence, 'results.json'), JSON.stringify(result, null, 2));
  fs.writeFileSync(path.join(evidence, 'process.log'), childOutput);
});
