// Main-process dependency injection is confined to this privileged CI driver.
// Production packages have no environment override for feed URLs or trust keys.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { _electron: electron } = require('playwright');
const [executable, profile, installer, expectedVersion, evidenceDir] = process.argv.slice(2);
if (!executable || !profile || !installer || !expectedVersion || !evidenceDir) throw new Error('Expected <installed-exe> <profile> <final-installer> <version> <evidence>.');
if (process.env.GITHUB_ACTIONS !== 'true' || process.env.RUNNER_ENVIRONMENT !== 'github-hosted' || process.env.RUNNER_OS !== 'Windows') throw new Error('Updater installation tests require an ephemeral GitHub-hosted Windows account.');
const standardProfile = path.join(process.env.APPDATA, 'Workbench');
assert.equal(path.resolve(profile).toLowerCase(), path.resolve(standardProfile).toLowerCase());
const root = path.resolve(__dirname, '..');
const relativeInstall = path.relative(path.join(root, 'artifacts'), path.resolve(executable));
if (relativeInstall === '..' || relativeInstall.startsWith(`..${path.sep}`) || path.isAbsolute(relativeInstall)) throw new Error('Installed executable must remain in the dedicated artifacts test directory.');
assert.equal(path.basename(installer), `Workbench-Setup-${expectedVersion}-win-x64.exe`);
fs.mkdirSync(evidenceDir, { recursive: true });
const report = { status: 'FAIL', expectedVersion, executable, profile, installer, injection: 'Privileged main-process test factory with temporary key and mapped fetch; no production key access' };
const protectedNames = ['workbench.json', 'workbench.json.bak', 'ai-key.bin', 'notification-ledger.json'];
let app, page, closed = false, server, manifestMode = 'tampered';
const requests = [];

async function hashFile(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
async function protectedHashes() {
  const hashes = {};
  for (const name of protectedNames) {
    const file = path.join(profile, name);
    if (fs.existsSync(file)) hashes[name] = await hashFile(file);
  }
  return hashes;
}
async function until(check, description, timeout = 90000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const value = await check();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out: ${description}`);
}

async function main() {
  const payload = { schemaVersion: 1, version: expectedVersion, filename: path.basename(installer), sha256: await hashFile(installer), size: fs.statSync(installer).size };
  const keys = crypto.generateKeyPairSync('ed25519');
  const signature = crypto.sign(null, Buffer.from(JSON.stringify(payload)), keys.privateKey).toString('base64');
  const manifest = { ...payload, signature };
  const tampered = { ...manifest, sha256: payload.sha256 === '0'.repeat(64) ? '1'.repeat(64) : '0'.repeat(64) };
  const publicKey = keys.publicKey.export({ type: 'spki', format: 'pem' });
  server = http.createServer((request, response) => {
    requests.push({ path: request.url, at: new Date().toISOString() });
    if (request.url === '/manifest') {
      const body = Buffer.from(JSON.stringify(manifestMode === 'tampered' ? tampered : manifest));
      response.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': body.length });
      response.end(body);
    } else if (request.url === '/installer') {
      response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': payload.size });
      fs.createReadStream(installer).pipe(response);
    } else { response.writeHead(404); response.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const env = { ...process.env };
  delete env.WORKBENCH_DATA_DIR;
  delete env.WORKBENCH_DEV_URL;
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ executablePath: path.resolve(executable), args: [], cwd: path.dirname(executable), env, timeout: 30000 });
  app.on('close', () => { closed = true; });
  assert.equal(await app.evaluate(({ app }) => app.isPackaged), true);
  assert.equal(path.resolve(await app.evaluate(({ app }) => app.getPath('userData'))).toLowerCase(), path.resolve(profile).toLowerCase());
  page = await app.firstWindow();
  await page.waitForFunction(() => Boolean(window.workbench?.getUpdate), undefined, { timeout: 20000 });
  const productionState = await until(async () => {
    const value = await page.evaluate(() => window.workbench.getUpdate());
    return value.enabled ? value : null;
  }, 'production factory to recognize the actual per-user NSIS installation', 15000);
  report.baselineVersion = productionState.currentVersion;
  assert.notEqual(productionState.currentVersion, expectedVersion);
  // Stop the production scheduler before injecting fixture dependencies into a separate controller.
  await page.evaluate(() => window.workbench.setAutomaticUpdates(false));
  await app.evaluate(async ({ app, BrowserWindow, ipcMain, net }, fixture) => {
    const nodePath = require('node:path');
    const updater = require(nodePath.join(app.getAppPath(), 'electron', 'updater.cjs'));
    const mainWindow = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('index.html'));
    if (!mainWindow) throw new Error('Main workbench window missing.');
    const eligibility = await updater.detectInstalled({ isPackaged: app.isPackaged });
    if (!eligibility.enabled) throw new Error(`Real installed-path check failed: ${eligibility.reason}`);
    const states = [];
    const transport = updater.createElectronFetch(net);
    const fetchImpl = (url, options) => {
      if (url === updater.FEED_URL) return transport(`${fixture.origin}/manifest`, options);
      if (url === updater.installerUrl(fixture.manifest)) return transport(`${fixture.origin}/installer`, options);
      throw new Error(`Unexpected update request: ${url}`);
    };
    const controller = updater.createUpdateController({
      currentVersion: app.getVersion(), publicKey: fixture.publicKey, userDataDirectory: app.getPath('userData'), eligibility, fetchImpl,
      onState: state => { states.push(state); mainWindow.webContents.send('update:state', state); },
      onQuit: () => { setTimeout(() => app.quit(), 150); },
      autoStart: false, initialDelayMs: 500, intervalMs: 60000,
    });
    const assertSender = event => {
      if (event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) throw new Error('Invalid updater test IPC sender.');
    };
    globalThis.__workbenchUpdaterFixture = { controller, states, manualChecks: 0 };
    for (const name of ['update:get', 'update:check', 'update:automatic', 'update:install']) ipcMain.removeHandler(name);
    ipcMain.handle('update:get', event => { assertSender(event); return controller.getState(); });
    ipcMain.handle('update:check', event => { assertSender(event); globalThis.__workbenchUpdaterFixture.manualChecks++; return controller.check(); });
    ipcMain.handle('update:automatic', (event, value) => { assertSender(event); return controller.setAutomatic(value); });
    ipcMain.handle('update:install', event => { assertSender(event); return controller.install(); });
  }, { origin, publicKey, manifest });
  await page.evaluate(() => {
    window.__updaterStates = [];
    window.workbench.onUpdate(state => window.__updaterStates.push(state.status));
  });
  await page.evaluate(() => window.workbench.setAutomaticUpdates(true));
  const rejected = await until(async () => {
    const value = await page.evaluate(() => window.workbench.getUpdate());
    return value.status === 'error' ? value : null;
  }, 'automatic check to reject the tampered signed manifest');
  assert.match(rejected.message, /签名/);
  assert.equal(requests.filter(request => request.path === '/installer').length, 0, 'bad signature must fail before downloading or executing');
  report.tamperedSignatureRejectedBeforeDownload = true;
  manifestMode = 'valid';
  const priorManifestRequests = requests.filter(request => request.path === '/manifest').length;
  await page.evaluate(() => window.workbench.setAutomaticUpdates(true));
  await until(() => requests.filter(request => request.path === '/manifest').length > priorManifestRequests, 'a new scheduled valid-manifest check');
  const ready = await until(async () => {
    const value = await page.evaluate(() => window.workbench.getUpdate());
    if (value.status === 'error') throw new Error(value.message);
    return value.status === 'ready' ? value : null;
  }, 'background download of the authentic final installer', 180000);
  assert.equal(ready.availableVersion, expectedVersion);
  assert.equal(ready.progress, 100);
  assert.equal(ready.downloadedBytes, payload.size);
  const downloaded = path.join(profile, 'updates', payload.filename);
  assert.equal(fs.statSync(downloaded).size, payload.size);
  assert.equal(await hashFile(downloaded), payload.sha256);
  const trace = await app.evaluate(() => ({ states: globalThis.__workbenchUpdaterFixture.states.map(state => state.status), manualChecks: globalThis.__workbenchUpdaterFixture.manualChecks }));
  assert.equal(trace.manualChecks, 0, 'happy path must be triggered by the actual background schedule');
  assert.ok(trace.states.includes('checking') && trace.states.includes('downloading') && trace.states.includes('ready'));
  const rendererStates = await page.evaluate(() => window.__updaterStates);
  assert.ok(rendererStates.includes('downloading') && rendererStates.includes('ready'), 'real sandboxed preload event path must receive progress');
  await page.waitForTimeout(500);
  report.preInstallProtectedHashes = await protectedHashes();
  assert.ok(report.preInstallProtectedHashes['workbench.json'] && report.preInstallProtectedHashes['ai-key.bin']);
  await page.screenshot({ path: path.join(evidenceDir, 'updater-ready.png'), fullPage: true });
  const closePromise = app.waitForEvent('close', { timeout: 90000 });
  await page.evaluate(() => window.workbench.installUpdate()).catch(error => {
    if (!/closed|destroyed|disconnect/i.test(error.message)) throw error;
  });
  await closePromise;
  report.status = 'PASS';
  report.backgroundCheckAndDownload = true;
  report.downloadedInstallerSha256 = payload.sha256;
  report.installerBytes = payload.size;
  report.oldApplicationExitedForInstall = true;
  report.productionIPCAdapterReplacedForFixture = true;
  report.cryptoDownloadAndHandoffUnmodified = true;
  report.productionChromiumTransportUsed = true;
  report.trace = trace;
  report.requests = requests;
}
main().catch(async error => {
  report.failure = error.stack || String(error);
  if (page && !page.isClosed()) await page.screenshot({ path: path.join(evidenceDir, 'updater-failure.png'), fullPage: true }).catch(() => {});
  console.error(report.failure);
  process.exitCode = 1;
}).finally(async () => {
  if (app && !closed) await app.close().catch(() => {});
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  fs.writeFileSync(path.join(evidenceDir, 'updater-results.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
});
