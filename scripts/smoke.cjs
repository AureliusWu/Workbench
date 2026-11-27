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
  await page.getByTestId('week-calendar').waitFor({ state: 'visible', timeout: 20000 });
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
  await page.getByTestId('week-calendar').waitFor();
  await page.getByRole('button', { name: /^偏好设置/ }).click();
  await page.locator('label.field').filter({ hasText: '专注时长' }).locator('input').fill('1');
  await page.getByRole('button', { name: '保存设置', exact: true }).click();
  await page.locator('.workspace-tools summary').click();
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
  await page.locator('.workspace-tools summary').click();
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
    await openView('文件速达');
    await page.getByRole('button', { name: '选择文件夹' }).click();
    await page.locator('.file-entry').filter({ hasText: '会议材料' }).press('Enter');
    await page.getByRole('button', { name: '返回上一级文件夹' }).waitFor();
    assert.match(await page.locator('.folder-path').textContent(), /会议材料/);
    await page.getByRole('button', { name: '返回上一级文件夹' }).click();
    await page.locator('.file-entry').filter({ hasText: '采购清单.docx' }).waitFor();
    await openView('今日工作台');
    measurements.files = { status: 'PASS', entries: entries.length, rejectedOutsideSelectedFolder: true, keyboardFolderNavigation: true };
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

function shiftDate(key, days) {
  const date = new Date(`${key}T12:00:00`);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

async function openView(name) {
  await page.getByRole('navigation').getByRole('button', { name }).click();
}

async function testWorkspaceUpgrade() {
  const livePath = path.join(dataDir, 'workbench.json');
  const legacyPath = path.join(evidenceDir, 'legacy-backup.json');
  const upgradedPath = path.join(evidenceDir, 'current-backup.json');
  const markdownPath = path.join(evidenceDir, 'weekly-review.md');
  const currentWeek = (await page.getByTestId('dashboard-week').textContent()).slice(0, 10);
  const historicalWeek = shiftDate(currentWeek, -14);
  const historicalEnd = shiftDate(historicalWeek, 6);
  const historicalTitle = '旧版已完成的归档排期';
  const historicalReview = '旧版复盘：会议资料已经整理完成。';
  const legacy = await loadState();
  legacy.tasks.push({ ...legacy.tasks[0], id: 'legacy-history', title: historicalTitle, date: historicalWeek, time: '', reminder: false, steps: [], done: true, repeat: 'none' });
  legacy.reviews[historicalWeek] = historicalReview;
  delete legacy.noteTags;
  for (const note of legacy.notes) delete note.tagIds;
  const legacyJson = JSON.stringify(legacy, null, 2);
  await close();
  fs.writeFileSync(livePath, legacyJson);
  fs.writeFileSync(legacyPath, legacyJson);
  const previousRecoveryCopy = fs.readFileSync(`${livePath}.bak`, 'utf8');
  await launch();
  assert.equal((await loadState()).reviews[historicalWeek], historicalReview);
  assert.deepEqual((await loadState()).notes[0].tagIds, []);
  assert.equal(fs.readFileSync(livePath, 'utf8'), legacyJson, 'startup should not eagerly rewrite existing data');
  assert.equal(fs.readFileSync(`${livePath}.bak`, 'utf8'), previousRecoveryCopy, 'startup should not rotate the recovery copy');

  // Import a previous-format backup using the application's normal entry point.
  await app.evaluate(({ dialog }, filename) => {
    globalThis.__legacyDialogs = { open: dialog.showOpenDialog, message: dialog.showMessageBox, save: dialog.showSaveDialog };
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filename] });
    dialog.showMessageBox = async () => ({ response: 1 });
  }, legacyPath);
  await page.getByRole('button', { name: /^偏好设置/ }).click();
  await page.getByRole('button', { name: '导入备份', exact: true }).click();
  await page.getByTestId('settings-view').waitFor({ state: 'hidden' });
  assert.ok(fs.readdirSync(path.join(dataDir, 'backups')).some(name => name.startsWith('before-import-')));

  const quick = page.getByRole('textbox', { name: '一句话创建待办' });
  await quick.fill('明天下午三点开会');
  await quick.press('Enter');
  const tomorrowKey = shiftDate(await page.evaluate(() => new Date().toLocaleDateString('sv-SE')), 1);
  await waitFor(async () => (await loadState()).tasks.some(task => task.title === '开会' && task.date === tomorrowKey && task.time === '15:00'), 'natural language date and time persisted');
  const taskButton = page.getByTestId('week-calendar').getByRole('button', { name: new RegExp(`${tomorrowKey} 15:00.*开会`) });
  await taskButton.waitFor();
  await taskButton.click();
  assert.equal(await page.getByTestId('task-title-input').inputValue(), '开会');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  const taskItem = page.getByTestId('task-item').filter({ hasText: '开会' });
  await page.getByTestId('week-calendar').locator('.wb-week-task').filter({ has: page.getByRole('button', { name: new RegExp(`${tomorrowKey} 15:00.*开会`) }) }).getByRole('checkbox').check();
  const hasStrike = locator => locator.evaluate(node => getComputedStyle(node).textDecorationLine.includes('line-through'));
  assert.equal(await hasStrike(taskButton.locator('.wb-week-task-title')), true);
  assert.equal(await hasStrike(taskItem.locator('.task-title')), true);

  await quick.fill('下周找时间打电话');
  await quick.press('Enter');
  assert.match(await page.locator('#quick-task-feedback').textContent(), /明确|具体/);
  assert.ok(!(await loadState()).tasks.some(task => task.title.includes('打电话')));
  await quick.fill('核对采购订单');
  await quick.press('Enter');
  await waitFor(async () => (await loadState()).tasks.some(task => task.title === '核对采购订单' && !task.date && !task.time), 'undated task persisted');
  await page.getByTestId('task-item').filter({ hasText: '核对采购订单' }).waitFor();
  assert.equal(await page.getByTestId('week-calendar').getByText('核对采购订单', { exact: true }).count(), 0);
  await page.getByRole('button', { name: '本周', exact: true }).click();
  await page.getByRole('button', { name: '上一周', exact: true }).click();
  await page.getByRole('button', { name: '上一周', exact: true }).click();
  await page.getByTestId('week-calendar').getByText(historicalTitle, { exact: true }).waitFor();
  await page.getByRole('button', { name: '下一周', exact: true }).click();
  assert.match(await page.getByTestId('dashboard-week').textContent(), new RegExp(shiftDate(currentWeek, -7)));
  await page.getByRole('button', { name: '本周', exact: true }).click();
  assert.match(await page.getByTestId('dashboard-week').textContent(), new RegExp(currentWeek));

  await openView('周度复盘');
  const writing = page.getByRole('textbox', { name: '写给这一周的自己' });
  await writing.fill('当前周新复盘');
  await page.getByLabel('历史复盘周').selectOption(historicalWeek);
  assert.equal(await writing.inputValue(), historicalReview);
  await app.evaluate(({ dialog }, filename) => {
    dialog.showSaveDialog = async (_window, options) => {
      globalThis.__weeklyFilename = options.defaultPath;
      return { canceled: false, filePath: filename };
    };
  }, markdownPath);
  await page.getByTestId('export-review').click();
  await waitFor(() => fs.existsSync(markdownPath), 'selected history exported');
  const markdown = fs.readFileSync(markdownPath, 'utf8');
  for (const text of [historicalWeek, historicalEnd, historicalTitle, historicalReview, '未完成待办', '累计专注']) assert.ok(markdown.includes(text), text);
  assert.ok(!markdown.includes('当前周新复盘'));
  assert.equal(await app.evaluate(() => globalThis.__weeklyFilename), `周总结_${historicalWeek}_至_${historicalEnd}.md`);
  await page.getByLabel('选择复盘日期').fill(currentWeek);
  assert.equal(await writing.inputValue(), '当前周新复盘');

  await openView('灵感便签');
  await page.getByRole('button', { name: '管理标签' }).click();
  for (const name of ['会议', '复盘']) {
    await page.getByLabel('标签名称').fill(name);
    await page.getByRole('button', { name: '新建标签', exact: true }).click();
  }
  await page.getByRole('button', { name: '编辑标签 复盘', exact: true }).click();
  await page.getByLabel('标签名称').fill('周复盘');
  await page.getByRole('button', { name: '保存标签名称', exact: true }).click();
  await page.getByRole('button', { name: '关闭标签管理' }).click();
  const noteTitle = '新便笺：整理投影设备和复盘材料。';
  await page.getByTestId('note-input').fill(noteTitle);
  await page.getByRole('checkbox', { name: '会议', exact: true }).check();
  await page.getByRole('checkbox', { name: '周复盘', exact: true }).check();
  await page.getByTestId('save-note').click();
  let note = page.getByTestId('note-card').filter({ hasText: noteTitle });
  const meetingTag = (await loadState()).noteTags.find(tag => tag.name === '会议').id;
  await page.getByLabel('按标签筛选').selectOption(meetingTag);
  assert.equal(await page.getByTestId('note-card').count(), 1);
  await note.getByRole('button', { name: '归档便笺', exact: true }).click();
  await note.waitFor({ state: 'hidden' });
  await page.locator('.notes-toolbar').getByRole('button', { name: /^归档便笺/ }).click();
  await note.waitFor();
  await waitFor(async () => Boolean((await loadState()).notes.find(item => item.text === noteTitle)?.archivedAt), 'archived note persisted');

  await app.evaluate(({ dialog }, filename) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: filename }); }, upgradedPath);
  assert.equal(await page.evaluate(() => window.workbench.exportData()), true);
  const upgraded = JSON.parse(fs.readFileSync(upgradedPath, 'utf8'));
  assert.equal(upgraded.schemaVersion, 1);
  assert.equal(upgraded.noteTags.length, 2);
  assert.equal(upgraded.notes.find(item => item.text === noteTitle).tagIds.length, 2);
  assert.ok(upgraded.notes.find(item => item.text === noteTitle).archivedAt);
  assert.equal(upgraded.reviews[historicalWeek], historicalReview);

  await close();
  await launch();
  note = page.getByTestId('note-card').filter({ hasText: noteTitle });
  const restarted = await loadState();
  assert.equal(restarted.tasks.find(task => task.id === 'legacy-history').done, true);
  assert.equal(restarted.reviews[historicalWeek], historicalReview);
  assert.equal(restarted.reviews[currentWeek], '当前周新复盘');
  await openView('灵感便签');
  await note.waitFor({ state: 'hidden' });
  await page.locator('.notes-toolbar').getByRole('button', { name: /^归档便笺/ }).click();
  assert.match(await note.textContent(), /会议.*周复盘/);
  await note.getByRole('button', { name: '恢复便笺' }).click();
  await page.getByRole('button', { name: '当前便笺', exact: true }).click();
  await note.waitFor();
  await page.getByRole('button', { name: '管理标签' }).click();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: '删除标签 会议', exact: true }).click();
  await page.getByRole('button', { name: '关闭标签管理' }).click();
  await waitFor(async () => (await loadState()).notes.find(item => item.text === noteTitle)?.tagIds.length === 1, 'tag removed without removing note');
  assert.match(await note.textContent(), /周复盘/);
  assert.equal(await note.getByText('会议', { exact: true }).count(), 0);

  await openView('今日工作台');
  await page.keyboard.press('Control+k');
  const search = page.getByRole('dialog', { name: '搜索工作台' });
  await search.getByRole('textbox', { name: '搜索待办和便笺' }).fill('检查投影设备');
  await search.getByRole('textbox', { name: '搜索待办和便笺' }).press('Enter');
  assert.equal(await page.getByTestId('task-title-input').inputValue(), '核对会议室预约');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '搜索工作台', exact: true }).click();
  await search.getByRole('textbox', { name: '搜索待办和便笺' }).fill(noteTitle);
  await search.getByRole('button', { name: new RegExp(noteTitle) }).click();
  assert.equal(await page.getByTestId('note-input').inputValue(), noteTitle);
  await page.getByRole('button', { name: '取消编辑', exact: true }).click();
  await openView('今日工作台');
  await page.getByRole('button', { name: '应用更新', exact: true }).click();
  const updateDialog = page.getByRole('dialog', { name: '应用更新' });
  await updateDialog.waitFor();
  assert.match(await updateDialog.textContent(), new RegExp(require('../package.json').version.replaceAll('.', '\\.')));
  await page.keyboard.press('Escape');
  await updateDialog.waitFor({ state: 'hidden' });
  await page.setViewportSize({ width: 1366, height: 768 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 1), true, 'dashboard should fit the desktop viewport');
  assert.equal(await page.getByTestId('week-calendar').locator('.wb-week-column').count(), 7);
  await page.screenshot({ path: path.join(evidenceDir, 'workbench-1366x768.png') });
  measurements.workspaceUpgrade = { status: 'PASS', legacyStartupUnchanged: true, legacyImport: true, naturalTask: true, inlineCalendarCompletion: true, historicalMarkdown: true, tagsArchiveRestart: true, globalSearch: true, updateDialog: true, desktopViewport: '1366x768' };
}

async function testDayAgenda() {
  const open = () => page.getByRole('button', { name: '两日清单', exact: true }).click();
  const today = page.getByTestId('agenda-today');
  const tomorrow = page.getByTestId('agenda-tomorrow');
  const row = (panel, title) => panel.getByTestId('task-item').filter({ hasText: title });
  const movingTitle = '核对下次会议资料';
  const backlogTitle = '归类共享文件';
  const templateTitle = '下月例会筹备';
  const historical = (await loadState()).tasks.find(task => task.id === 'legacy-history');
  assert.equal(historical.done, true);

  await open();
  const todayKey = await today.locator('time').getAttribute('datetime');
  const tomorrowKey = await tomorrow.locator('time').getAttribute('datetime');
  assert.ok(todayKey < tomorrowKey);
  const todayInput = today.getByRole('textbox', { name: '今天待办名称' });
  await todayInput.fill(movingTitle);
  await todayInput.press('Enter');
  const initial = await waitFor(async () => (await loadState()).tasks.find(task => task.title === movingTitle), 'agenda add persists');
  assert.equal(initial.date, todayKey);
  await row(today, movingTitle).getByRole('button', { name: `移到明天 ${movingTitle}`, exact: true }).click();
  await row(tomorrow, movingTitle).waitFor();
  assert.equal(await row(today, movingTitle).count(), 0);
  const moved = await waitFor(async () => (await loadState()).tasks.find(task => task.id === initial.id && task.date === tomorrowKey), 'agenda move preserves ID');
  assert.deepEqual(moved, { ...initial, date: tomorrowKey });
  await row(tomorrow, movingTitle).getByRole('checkbox').check();
  const completed = await waitFor(async () => (await loadState()).tasks.find(task => task.id === initial.id && task.done), 'completion saved on the planned date');
  assert.equal(completed.date, tomorrowKey);
  assert.equal(await row(tomorrow, movingTitle).getByRole('button', { name: /^移到今天/ }).count(), 0);
  assert.match(await row(tomorrow, movingTitle).getAttribute('class'), /\bdone\b/);

  await page.getByRole('button', { name: '新建待办', exact: true }).click();
  let modal = page.getByRole('dialog', { name: '新建待办' });
  await modal.getByTestId('task-title-input').fill(backlogTitle);
  await modal.getByLabel(/安排日期/).fill('');
  await modal.getByTestId('add-task-submit').click();
  const backlog = page.getByTestId('agenda-backlog');
  await backlog.locator('summary').click();
  const unscheduled = await waitFor(async () => (await loadState()).tasks.find(task => task.title === backlogTitle), 'backlog task persists');
  assert.equal(unscheduled.date, '');
  await row(backlog, backlogTitle).getByRole('button', { name: `移到今天 ${backlogTitle}`, exact: true }).click();
  await row(today, backlogTitle).waitFor();
  await waitFor(async () => (await loadState()).tasks.some(task => task.id === unscheduled.id && task.date === todayKey), 'explicit backlog scheduling persists');

  await page.getByRole('button', { name: '新建待办', exact: true }).click();
  modal = page.getByRole('dialog', { name: '新建待办' });
  await modal.getByTestId('task-title-input').fill(templateTitle);
  await modal.getByLabel(/拆成小步骤/).fill('确认议题和参会人\n自定义安排');
  await modal.getByLabel(/预计用时/).fill('55');
  await modal.getByLabel(/待办模板/).selectOption('准备会议');
  await modal.getByTestId('add-task-submit').click();
  const templated = await waitFor(async () => (await loadState()).tasks.find(task => task.title === templateTitle), 'template preserves custom draft');
  assert.equal(templated.estimate, 55);
  assert.deepEqual(templated.steps.map(step => step.title), ['确认议题和参会人', '自定义安排', '预订会议室或建立会议链接', '发送议程和材料']);

  await page.screenshot({ path: path.join(evidenceDir, 'two-day-agenda.png') });
  await page.setViewportSize({ width: 1000, height: 600 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await tomorrow.getByRole('textbox', { name: '明天待办名称' }).focus();
  assert.equal(await tomorrow.getByRole('textbox', { name: '明天待办名称' }).evaluate(element => element === document.activeElement), true);
  await close();
  await launch();
  await open();
  const restartedTask = row(page.getByTestId('agenda-tomorrow'), movingTitle);
  await restartedTask.waitFor();
  assert.equal(await restartedTask.getByRole('checkbox').isChecked(), true);
  assert.deepEqual((await loadState()).tasks.find(task => task.id === historical.id), historical);
  measurements.dayAgenda = { status: 'PASS', quickEntry: true, rescheduleRetainedOriginalId: true, completedKeptPlannedDate: true, backlogExplicit: true, templatePreservedDraft: true, historicalRecordUnchanged: true, restart: true, narrowViewport: '1000x600' };
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

  await page.locator('.workspace-tools summary').click();
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

  await testWorkspaceUpgrade();
  await testDayAgenda();

  assert.deepEqual(errors, [], 'renderer must not emit runtime errors');
  const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  measurements.summary = {
    launchMedianMs: median(measurements.launchMs),
    launchWorstMs: Math.max(...measurements.launchMs),
    taskMedianMs: median(measurements.taskInteractionMs),
    taskWorstMs: Math.max(...measurements.taskInteractionMs),
    baseline: 'Test timings depend on the current Windows runner and window size',
    budgetMs: 3000,
    samples: measurements.launchMs.length,
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
