const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { performance } = require('node:perf_hooks');
const { _electron: electron } = require('playwright');

const root = path.resolve(__dirname, '..');
const evidenceDir = path.join(root, 'artifacts', `smoke-${Date.now()}`);
const dataDir = path.join(evidenceDir, 'isolated-data');
fs.mkdirSync(dataDir, { recursive: true });
const executablePath = process.env.WORKBENCH_E2E_EXE || process.env.WORKBENCH_ELECTRON_BINARY || require('electron');
const env = { ...process.env, WORKBENCH_DATA_DIR: dataDir };
delete env.ELECTRON_RUN_AS_NODE;
delete env.WORKBENCH_DEV_URL;
let app;
let page;
const errors = [];
const measurements = { version: null, target: executablePath, launchMs: [], taskInteractionMs: [], evidenceDir };

async function waitFor(check, description, timeout = 8000) {
  const start = performance.now();
  while (performance.now() - start < timeout) {
    const result = await check();
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out: ${description}`);
}

async function launch() {
  const start = performance.now();
  app = await electron.launch({
    executablePath,
    args: process.env.WORKBENCH_E2E_EXE ? [] : [root],
    cwd: root,
    env,
    timeout: 30000,
  });
  page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.getByTestId('calendar-view').waitFor({ state: 'visible', timeout: 20000 });
  measurements.launchMs.push(Math.round(performance.now() - start));
  measurements.version = await page.evaluate(() => window.workbench.version());
}

async function close() {
  if (app) await app.close();
  app = undefined;
}

async function loadState() {
  return page.evaluate(() => window.workbench.load());
}

async function testShortScreen() {
  const original = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
  await page.setViewportSize({ width: 1000, height: 600 });
  await page.getByRole('button', { name: /^偏好设置/ }).click();
  const settings = page.getByTestId('settings-view');
  await settings.waitFor({ state: 'visible' });
  await page.screenshot({ path: path.join(evidenceDir, 'short-screen-settings.png') });
  await settings.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '日历日程', exact: true }).click();
  await page.getByRole('button', { name: '今日工作台', exact: true }).click();
  await page.screenshot({ path: path.join(evidenceDir, 'short-screen-navigation.png') });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  assert.equal(overflow, false, 'short screen must not introduce horizontal overflow');
  await page.setViewportSize(original);
  measurements.shortScreen = { status: 'PASS', viewport: { width: 1000, height: 600 }, settingsOpenedWithNormalClick: true, navigationReachable: true };
}

async function selectCalendarDate(key) {
  await page.getByRole('button', { name: '日历日程', exact: true }).click();
  const calendar = page.getByTestId('calendar-view');
  const heading = await calendar.locator('h2').textContent();
  const match = heading.match(/(\d+)\s*年\s*(\d+)\s*月/);
  assert.ok(match, `calendar heading was not readable: ${heading}`);
  const desired = key.slice(0, 7).split('-').map(Number);
  const delta = (desired[0] - Number(match[1])) * 12 + desired[1] - Number(match[2]);
  assert.ok(Math.abs(delta) <= 120, 'calendar test date is unexpectedly distant');
  for (let index = 0; index < Math.abs(delta); index++) {
    await calendar.getByRole('button', { name: delta > 0 ? '下个月' : '上个月', exact: true }).click();
  }
  const day = calendar.locator(`button.calendar-day[title^="${key} "]`);
  await day.click();
  return day;
}

async function testCapture() {
  if (process.env.WORKBENCH_E2E_CAPTURE === '0') {
    measurements.capture = 'SKIPPED_BY_ENV (no interactive desktop promised by CI runner)';
    return;
  }
  await page.evaluate(() => window.workbench.capture());
  const overlay = await waitFor(async () => {
    for (const window of app.windows()) {
      if (window === page || window.isClosed()) continue;
      const type = await window.evaluate(async () => window.utility ? (await window.utility.ready()).type : null).catch(() => null);
      if (type === 'capture') return window;
    }
  }, 'native screenshot selection overlay');
  await overlay.locator('#capture').waitFor({ state: 'visible' });
  overlay.on('pageerror', error => errors.push(`capture: ${error.message}`));
  await overlay.evaluate(() => document.addEventListener('pointerup', event => { window.__smokePointerUp = { x: event.clientX, y: event.clientY }; }, true));
  await overlay.mouse.move(80, 100);
  await overlay.mouse.down();
  await overlay.mouse.move(400, 300, { steps: 8 });
  await overlay.screenshot({ path: path.join(evidenceDir, 'capture-selection.png') });
  await overlay.mouse.up().catch(error => {
    if (!/closed|destroyed/i.test(error.message)) throw error;
  });
  let imagePin;
  try { imagePin = await waitFor(async () => {
    for (const window of app.windows()) {
      if (window === page || window.isClosed()) continue;
      const type = await window.evaluate(async () => window.utility ? (await window.utility.ready()).type : null).catch(() => null);
      if (type === 'image') return window;
    }
  }, 'screenshot image pin'); } catch (error) {
    measurements.captureDiagnostics = await app.evaluate(({ BrowserWindow }) => ({ windows: BrowserWindow.getAllWindows().map(window => ({ id: window.id, title: window.getTitle(), visible: window.isVisible(), alwaysOnTop: window.isAlwaysOnTop(), bounds: window.getBounds() })) })).catch(error => ({ error: error.message }));
    if (!overlay.isClosed()) {
      measurements.captureDiagnostics.overlay = await overlay.evaluate(() => ({ hint: document.getElementById('hint').textContent, pointerUp: window.__smokePointerUp }));
      await overlay.screenshot({ path: path.join(evidenceDir, 'capture-failure.png') });
    }
    throw error;
  }
  const clipboardSize = await app.evaluate(async ({ clipboard, nativeImage }) => {
    const items = await clipboard.read();
    const item = items.find(value => value.types.includes('image/png'));
    if (!item) return { width: 0, height: 0 };
    const blob = await item.getType('image/png');
    return nativeImage.createFromBuffer(Buffer.from(await blob.arrayBuffer())).getSize();
  });
  assert.ok(clipboardSize.width >= 300 && clipboardSize.height >= 180, 'capture must populate an actual cropped clipboard image');
  const pinned = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(window => window.isAlwaysOnTop()));
  assert.equal(pinned, true);
  await imagePin.locator('#image').waitFor({ state: 'visible' });
  await imagePin.screenshot({ path: path.join(evidenceDir, 'captured-image-pin.png') });
  measurements.capture = { status: 'PASS', selectionCssPixels: { width: 320, height: 200 }, clipboardSize };
  await imagePin.getByTitle('关闭贴图').click();
}

async function testMockAi() {
  const requests = [];
  const answer = '本地测试建议：下一次专注先处理高优先级事项。';
  const fakeKey = 'workbench-smoke-only-not-a-real-key';
  const server = http.createServer((request, response) => {
    let body = '';
    request.on('data', value => { body += value; });
    request.on('end', () => {
      requests.push({ path: request.url, body: JSON.parse(body), authorization: request.headers.authorization });
      if (request.url.startsWith('/failure/')) {
        response.writeHead(503, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ error: 'controlled test failure' }));
      } else {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ choices: [{ message: { content: answer } }] }));
      }
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal(requests.length, 0);
    await page.evaluate(key => window.workbench.saveApiKey(key), fakeKey);
    assert.equal(await page.evaluate(() => window.workbench.hasApiKey()), true);
    assert.equal(fs.readFileSync(path.join(dataDir, 'ai-key.bin')).includes(Buffer.from(fakeKey)), false, 'key must be encrypted at rest');
    assert.equal(JSON.stringify(await loadState()).includes(fakeKey), false, 'state returned to renderer must exclude API key');
    const result = await page.evaluate(({ endpoint }) => window.workbench.aiReview({ prompt: '测试周复盘，仅使用测试内容。', model: 'local-smoke-model', endpoint: `${endpoint}/v1` }), { endpoint });
    assert.equal(result, answer);
    assert.equal(requests[0].path, '/v1/chat/completions');
    assert.equal(requests[0].body.model, 'local-smoke-model');
    assert.equal(requests[0].authorization, `Bearer ${fakeKey}`);
    await assert.rejects(page.evaluate(({ endpoint }) => window.workbench.aiReview({ prompt: '受控失败测试', model: 'local-smoke-model', endpoint: `${endpoint}/failure` }), { endpoint }), /503/);
    measurements.aiMock = { status: 'PASS', requests: requests.length, externalRequests: 0, encryptedAtRest: true, controlledErrorStatus: 503 };
  } finally {
    await page.evaluate(() => window.workbench.saveApiKey(''));
    await new Promise(resolve => server.close(resolve));
  }
}

async function testFocusCompletion() {
  await page.clock.install();
  await page.reload();
  await page.getByTestId('calendar-view').waitFor();
  await page.getByRole('button', { name: /^偏好设置/ }).click();
  await page.locator('label.field').filter({ hasText: '专注时长' }).locator('input').fill('1');
  await page.getByRole('button', { name: '保存设置', exact: true }).click();
  assert.equal((await page.locator('.timer').textContent()).replace(/\s/g, ''), '01:00', 'idle timer must follow newly saved focus duration');
  await page.getByTestId('focus-start').click();
  await page.clock.runFor(61000);
  await waitFor(async () => (await loadState())?.focusSessions.length === 1, 'one completed focus session');
  const sessions = (await loadState()).focusSessions;
  assert.equal(sessions[0].minutes, 1);
  assert.equal((await page.locator('.timer').textContent()).replace(/\s/g, ''), '01:00', 'completed timer must reset for the next session');
  await page.getByTestId('focus-start').click();
  await page.clock.runFor(1000);
  assert.equal((await loadState()).focusSessions.length, 1, 'restarting must not instantly credit a second full session');
  await page.getByTestId('focus-start').click();
  await page.getByRole('button', { name: '重置计时', exact: true }).click();
  await page.clock.resume();
  measurements.focusRegression = { status: 'PASS', completedSessions: 1, minutes: 1, duplicateSessions: 0 };
}

async function testFiles() {
  const folder = path.join(evidenceDir, 'office-fixtures');
  fs.mkdirSync(path.join(folder, '会议材料'), { recursive: true });
  fs.writeFileSync(path.join(folder, '采购清单.docx'), 'test fixture');
  fs.writeFileSync(path.join(folder, '参考图片.png'), 'test fixture');
  await app.evaluate(({ dialog }, selected) => {
    globalThis.__smokeOpenDialog = dialog.showOpenDialog;
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] });
  }, folder);
  try {
    const selected = await page.evaluate(() => window.workbench.selectFolder());
    assert.equal(selected.toLowerCase(), folder.toLowerCase());
    const entries = await page.evaluate(folder => window.workbench.listFiles(folder), folder);
    assert.equal(entries.find(file => file.name === '采购清单.docx').category, '文档');
    assert.equal(entries.find(file => file.name === '参考图片.png').category, '图片');
    assert.equal(entries.find(file => file.name === '会议材料').isDirectory, true);
    await assert.rejects(page.evaluate(folder => window.workbench.listFiles(folder), evidenceDir), /授权|选择文件夹/);
    measurements.files = { status: 'PASS', entries: entries.length, rejectedOutsideSelectedFolder: true };
  } finally {
    await app.evaluate(({ dialog }) => { dialog.showOpenDialog = globalThis.__smokeOpenDialog; delete globalThis.__smokeOpenDialog; });
  }
}

async function testBackup() {
  const backup = path.join(evidenceDir, 'exported-backup.json');
  const invalid = path.join(evidenceDir, 'invalid-backup.json');
  fs.writeFileSync(invalid, '{broken JSON');
  await app.evaluate(({ dialog }, filename) => {
    globalThis.__smokeBackupDialogs = { save: dialog.showSaveDialog, open: dialog.showOpenDialog, message: dialog.showMessageBox };
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: filename });
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filename] });
    dialog.showMessageBox = async () => ({ response: 1 });
  }, backup);
  try {
    assert.equal(await page.evaluate(() => window.workbench.exportData()), true);
    const exported = JSON.parse(fs.readFileSync(backup, 'utf8'));
    assert.equal(exported.tasks.length, 3);
    assert.equal(exported.settings.apiKey, undefined);
    const changed = structuredClone(exported);
    changed.notes[0].text = 'Temporary mutation before restoring the backup';
    await page.evaluate(state => window.workbench.save(state), changed);
    const restored = await page.evaluate(() => window.workbench.importData());
    assert.equal(restored.notes[0].text, exported.notes[0].text);
    assert.equal((await loadState()).notes[0].text, exported.notes[0].text);
    await app.evaluate(({ dialog }, filename) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filename] }); }, invalid);
    await assert.rejects(page.evaluate(() => window.workbench.importData()), /JSON|position|Expected|property|token/i);
    assert.equal((await loadState()).notes[0].text, exported.notes[0].text, 'malformed import must preserve current data');
    measurements.backup = { status: 'PASS', exportImportRoundTrip: true, malformedImportPreservesData: true, excludesKey: true };
  } finally {
    await app.evaluate(({ dialog }) => {
      dialog.showSaveDialog = globalThis.__smokeBackupDialogs.save;
      dialog.showOpenDialog = globalThis.__smokeBackupDialogs.open;
      dialog.showMessageBox = globalThis.__smokeBackupDialogs.message;
      delete globalThis.__smokeBackupDialogs;
    });
  }
}

async function main() {
  await launch();
  assert.equal(measurements.version, require('../package.json').version);
  const initial = await loadState();
  assert.ok(!initial || initial.tasks.length === 0, 'fresh profile must not have invented tasks');
  await testShortScreen();

  const titles = ['准备办公物资清单', '核对会议室预约', '整理本周报销材料'];
  for (const title of titles) {
    const start = performance.now();
    await page.getByRole('button', { name: '新建待办', exact: true }).click();
    await page.getByTestId('task-title-input').fill(title);
    if (title === titles[1]) {
      await page.getByRole('textbox', { name: /拆成小步骤/ }).fill('确认参会人数\n检查投影设备');
      await page.locator('label.field').filter({ hasText: '优先级' }).locator('select').selectOption('high');
    }
    await page.getByTestId('add-task-submit').click();
    const item = page.getByTestId('task-item').filter({ hasText: title });
    await item.waitFor({ state: 'visible' });
    measurements.taskInteractionMs.push(Math.round(performance.now() - start));
  }
  await waitFor(async () => (await loadState())?.tasks.length === 3, 'three tasks saved');
  const firstTask = page.getByTestId('task-item').filter({ hasText: titles[0] });
  await firstTask.getByRole('checkbox').first().check();
  await waitFor(async () => (await loadState())?.tasks.find(task => task.title === titles[0])?.done, 'task completion saved');

  const steppedTask = page.getByTestId('task-item').filter({ hasText: titles[1] });
  await steppedTask.getByRole('button', { name: '展开任务步骤' }).click();
  await steppedTask.getByRole('checkbox', { name: '确认参会人数', exact: true }).check();
  await waitFor(async () => (await loadState())?.tasks.find(task => task.title === titles[1])?.steps[0]?.done, 'subtask completion saved');
  await page.getByTestId('note-input').fill('下次会议提前十分钟检查投影。');
  await page.getByTestId('save-note').click();
  await waitFor(async () => (await loadState())?.notes.some(note => note.text === '下次会议提前十分钟检查投影。'), 'note saved from UI');

  await page.getByTestId('focus-start').click();
  await page.getByTestId('focus-start').filter({ hasText: '暂停' }).waitFor({ state: 'visible' });
  await page.getByTestId('focus-start').click();
  await page.getByRole('button', { name: '重置计时', exact: true }).click();
  await testFocusCompletion();

  const holiday = await selectCalendarDate('2026-09-26');
  assert.equal(await holiday.locator('.work-badge').textContent(), '休', 'official holiday must win over month-end Saturday');
  const monthEndSaturday = await selectCalendarDate('2026-11-28');
  assert.equal(await monthEndSaturday.locator('.work-badge').textContent(), '班', 'ordinary last Saturday must be a workday');
  await page.getByTestId('calendar-view').getByRole('button', { name: '今天', exact: true }).click();
  await page.getByRole('button', { name: '今日工作台', exact: true }).click();

  const weeklyDate = await page.evaluate(() => {
    const date = new Date(); date.setDate(date.getDate() + 1);
    return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  });
  await page.getByRole('button', { name: '新建待办', exact: true }).click();
  await page.getByTestId('task-title-input').fill('每周例会准备');
  await page.locator('input[type="date"]').fill(weeklyDate);
  await page.locator('label.field').filter({ hasText: '重复' }).locator('select').selectOption('weekly');
  await page.getByTestId('add-task-submit').click();
  await page.getByRole('button', { name: /^待办清单/ }).click();
  const weeklyTask = page.getByTestId('task-item').filter({ hasText: '每周例会准备' });
  await weeklyTask.waitFor({ state: 'visible' });
  page.once('dialog', dialog => dialog.accept());
  await weeklyTask.getByRole('button', { name: '删除待办' }).click();
  await waitFor(async () => !(await loadState())?.tasks.some(task => task.title === '每周例会准备'), 'weekly future task visible and removable');
  await page.getByRole('button', { name: '今日工作台', exact: true }).click();

  // Complete just today's occurrence, then inspect and delete the series from tomorrow.
  const recurringTitle = '每日检查公共邮箱';
  await page.getByRole('button', { name: '新建待办', exact: true }).click();
  await page.getByTestId('task-title-input').fill(recurringTitle);
  await page.locator('label.field').filter({ hasText: '重复' }).locator('select').selectOption('daily');
  await page.getByTestId('add-task-submit').click();
  await page.getByTestId('task-item').filter({ hasText: recurringTitle }).getByRole('checkbox').first().check();
  await waitFor(async () => (await loadState())?.tasks.some(task => task.title === recurringTitle && task.repeat === 'none' && task.done), 'today recurrence snapshot saved');
  const tomorrow = await page.evaluate(() => {
    const date = new Date();
    date.setDate(date.getDate() + 1);
    return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  });
  await page.getByRole('button', { name: '日历日程', exact: true }).click();
  // The last day of a month may need next month's calendar.
  if (!(await page.locator(`button.calendar-day[title^="${tomorrow} "]`).count())) {
    await page.getByRole('button', { name: '下个月', exact: true }).click();
  }
  await page.locator(`button.calendar-day[title^="${tomorrow} "]`).click();
  const tomorrowTask = page.getByTestId('task-item').filter({ hasText: recurringTitle });
  assert.equal(await tomorrowTask.getByRole('checkbox').first().isChecked(), false, 'future recurrence must remain unchecked');
  page.once('dialog', dialog => dialog.accept());
  await tomorrowTask.getByRole('button', { name: '删除待办' }).click();
  await waitFor(async () => !(await loadState())?.tasks.some(task => task.title === recurringTitle), 'recurring series deletion persisted');
  await page.getByRole('button', { name: '今日工作台', exact: true }).click();

  await page.screenshot({ path: path.join(evidenceDir, 'dashboard.png'), fullPage: true });

  // Exercise the privileged bridge through the same isolated renderer used by the application.
  const state = await loadState();
  assert.equal(state.schemaVersion, 1);
  assert.equal(state.settings.lastSaturdayWork, true);
  await page.evaluate(value => window.workbench.save(value), state);
  const roundTrip = await loadState();
  assert.equal(roundTrip.tasks[1].steps[0].title, '确认参会人数');
  assert.equal(roundTrip.notes[0].text, '下次会议提前十分钟检查投影。');
  await assert.rejects(page.evaluate(() => window.workbench.save({ schemaVersion: 999 })), /备份|版本|数据|schemaVersion/);
  assert.equal((await loadState()).tasks.length, 3, 'rejected state must preserve existing records');

  await page.evaluate(() => window.workbench.pinNote('E2E 置顶便笺验证'));
  const pinWindow = await waitFor(async () => {
    const windows = app.windows();
    for (const window of windows) {
      if (window !== page && (await window.locator('body').textContent())?.includes('E2E 置顶便笺验证')) return window;
    }
  }, 'native pinned note window');
  const alwaysOnTop = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(window => window.isAlwaysOnTop()));
  assert.equal(alwaysOnTop, true);
  await pinWindow.screenshot({ path: path.join(evidenceDir, 'pinned-note.png') });
  await pinWindow.getByTitle('关闭贴图').click();
  await testCapture();
  await testMockAi();
  await testFiles();
  await testBackup();

  await close();
  await launch();
  const afterRestart = await loadState();
  assert.equal(afterRestart.tasks.length, 3);
  assert.equal(afterRestart.tasks.find(task => task.title === titles[0]).done, true);
  assert.equal(afterRestart.tasks[1].steps[0].title, '确认参会人数');
  assert.equal(afterRestart.notes[0].text, '下次会议提前十分钟检查投影。');
  await page.screenshot({ path: path.join(evidenceDir, 'restart.png'), fullPage: true });
  await close();
  await launch();
  assert.equal((await loadState()).tasks.length, 3);

  assert.deepEqual(errors, [], 'renderer must not emit runtime errors');
  const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  measurements.summary = {
    launchMedianMs: median(measurements.launchMs),
    launchWorstMs: Math.max(...measurements.launchMs),
    taskMedianMs: median(measurements.taskInteractionMs),
    taskWorstMs: Math.max(...measurements.taskInteractionMs),
    baseline: 'Initial release; no prior-release comparison is available',
    budgetMs: 3000,
    samples: 3,
  };
  // Desktop boot includes process startup. The deterministic task interaction is the release gate.
  assert.ok(measurements.summary.taskWorstMs < 3000, 'task interaction exceeds the 3-second budget');
  console.log(JSON.stringify({ status: 'PASS', ...measurements }, null, 2));
}

main().catch(async error => {
  measurements.failure = error.stack || String(error);
  if (page && !page.isClosed()) await page.screenshot({ path: path.join(evidenceDir, 'failure.png'), fullPage: true }).catch(() => {});
  console.error(measurements.failure);
  process.exitCode = 1;
}).finally(async () => {
  await close().catch(() => {});
  fs.writeFileSync(path.join(evidenceDir, 'results.json'), JSON.stringify(measurements, null, 2));
});
