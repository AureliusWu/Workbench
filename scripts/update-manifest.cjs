// Produces metadata only. The production Ed25519 private key is never needed in CI.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const pkg = require('../package.json');
const installer = path.resolve(process.argv[2] || path.join(root, 'release', `Workbench-Setup-${pkg.version}-win-x64.exe`));
const output = path.resolve(process.argv[3] || path.join(path.dirname(installer), 'workbench-update.unsigned.json'));
async function main() {
  if (path.basename(installer) !== `Workbench-Setup-${pkg.version}-win-x64.exe`) throw new Error('Installer filename must match the current stable app version.');
  const stat = fs.statSync(installer);
  if (!stat.isFile() || stat.size < 1024 * 1024) throw new Error('Expected a complete Windows installer.');
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(installer)) hash.update(chunk);
  const manifest = { schemaVersion: 1, version: pkg.version, filename: path.basename(installer), sha256: hash.digest('hex'), size: stat.size };
  fs.writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify({ output, ...manifest }));
}
main().catch(error => { console.error(error.stack || String(error)); process.exitCode = 1; });
