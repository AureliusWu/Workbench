// Fast visual inspection of the production frontend when a native binary is being prepared.
// Native-function acceptance is performed separately by smoke.cjs.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');
const output = path.join(root, 'artifacts', `visual-${Date.now()}`);
fs.mkdirSync(output, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
const server = http.createServer((request, response) => {
  const requested = new URL(request.url, 'http://127.0.0.1').pathname;
  const file = path.resolve(dist, requested === '/' ? 'index.html' : `.${decodeURIComponent(requested)}`);
  if (file !== dist && !file.startsWith(`${dist}${path.sep}`)) { response.writeHead(403); response.end(); return; }
  fs.readFile(file, (error, value) => {
    if (error) { response.writeHead(404); response.end(); return; }
    response.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    response.end(value);
  });
});
let browser;
async function main() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const candidates = [process.env.WORKBENCH_CHROME, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'];
  const executablePath = candidates.find(candidate => candidate && fs.existsSync(candidate));
  browser = await chromium.launch({ executablePath, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 940 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByTestId('week-calendar').waitFor();
  await page.screenshot({ path: path.join(output, 'empty-desktop.png'), fullPage: true });
  for (const title of ['整理本周报销材料', '确认会议室预约', '准备办公用品采购单']) {
    await page.getByRole('button', { name: '新建待办', exact: true }).click();
    await page.getByTestId('task-title-input').fill(title);
    await page.getByTestId('add-task-submit').click();
  }
  await page.getByTestId('task-item').filter({ hasText: '确认会议室预约' }).getByRole('checkbox').first().check();
  await page.screenshot({ path: path.join(output, 'populated-desktop.png'), fullPage: true });
  await page.getByRole('button', { name: '新建待办', exact: true }).click();
  await page.screenshot({ path: path.join(output, 'task-modal.png'), fullPage: true });
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.setViewportSize({ width: 1000, height: 700 });
  await page.screenshot({ path: path.join(output, 'minimum-window.png'), fullPage: true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  if (overflow) throw new Error('Horizontal overflow at minimum native window size');
  await page.setViewportSize({ width: 1000, height: 600 });
  await page.getByRole('button', { name: /^偏好设置/ }).click();
  await page.getByTestId('settings-view').waitFor({ state: 'visible' });
  await page.screenshot({ path: path.join(output, 'short-screen-settings.png') });
  await page.getByTestId('settings-view').getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '日历日程', exact: true }).click();
  await page.getByRole('button', { name: '今日工作台', exact: true }).click();
  await page.screenshot({ path: path.join(output, 'short-screen-navigation.png') });
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(JSON.stringify({ status: 'PASS', output, errors, shortScreenSettingsAndNavigation: true, note: 'Browser frontend preview only; native acceptance remains separate.' }));
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
});
