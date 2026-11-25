const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { canonicalPayload, stableVersion, verifyManifest, MAX_INSTALLER_BYTES } = require('../electron/updater.cjs');

const root = path.resolve(__dirname, '..');
const publicFile = path.join(root, 'electron', 'update-public-key.pem');

function protectedPrivateKey(mode, keyBytes) {
  if (process.platform !== 'win32' || !process.env.LOCALAPPDATA) {
    throw new Error('The release signing key requires its Windows user profile.');
  }
  const keyFile = path.join(process.env.LOCALAPPDATA, 'WorkbenchReleaseSigning', 'update-ed25519.dpapi');
  const script = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$target = $env:WORKBENCH_RELEASE_SIGNER_STORAGE
$scope = [System.Security.Cryptography.DataProtectionScope]::CurrentUser
$entropy = [Text.Encoding]::UTF8.GetBytes('AureliusWu/Workbench update signer v1')
if ($env:WORKBENCH_RELEASE_SIGNER_MODE -eq 'create') {
  $bytes = [Convert]::FromBase64String([Console]::In.ReadToEnd().Trim())
  try {
    $encrypted = [System.Security.Cryptography.ProtectedData]::Protect($bytes, $entropy, $scope)
    [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target)) | Out-Null
    $stream = [IO.File]::Open($target, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write)
    try { $stream.Write($encrypted, 0, $encrypted.Length); $stream.Flush($true) } finally { $stream.Dispose() }
  } finally { [Array]::Clear($bytes, 0, $bytes.Length) }
} else {
  $bytes = [System.Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($target), $entropy, $scope)
  try { [Console]::Write([Convert]::ToBase64String($bytes)) } finally { [Array]::Clear($bytes, 0, $bytes.Length) }
}`;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    input: keyBytes?.toString('base64') ?? '',
    encoding: 'utf8',
    windowsHide: true,
    timeout: 20000,
    env: { ...process.env, WORKBENCH_RELEASE_SIGNER_STORAGE: keyFile, WORKBENCH_RELEASE_SIGNER_MODE: mode },
  });
  if (result.error || result.status !== 0) {
    throw new Error(`Could not ${mode === 'create' ? 'protect' : 'read'} the local release signing key. Check the Windows account and key storage.`);
  }
  return Buffer.from(result.stdout.trim(), 'base64');
}

function readKey() {
  const bytes = protectedPrivateKey('read');
  try { return crypto.createPrivateKey({ key: bytes, format: 'der', type: 'pkcs8' }); }
  finally { bytes.fill(0); }
}

function assertTrusted(key) {
  const actual = crypto.createPublicKey(key).export({ format: 'der', type: 'spki' });
  const expected = crypto.createPublicKey(fs.readFileSync(publicFile)).export({ format: 'der', type: 'spki' });
  if (!actual.equals(expected)) throw new Error('The protected signing key does not match the public key in Workbench.');
  return crypto.createHash('sha256').update(expected).digest('hex');
}

function initialize() {
  if (fs.existsSync(publicFile)) {
    console.log(`Update public key SHA-256 ${assertTrusted(readKey())}`);
    return;
  }
  const protectedPath = path.join(process.env.LOCALAPPDATA || '', 'WorkbenchReleaseSigning', 'update-ed25519.dpapi');
  let key;
  if (fs.existsSync(protectedPath)) key = readKey();
  else {
    const pair = crypto.generateKeyPairSync('ed25519');
    key = pair.privateKey;
    const bytes = key.export({ format: 'der', type: 'pkcs8' });
    try { protectedPrivateKey('create', bytes); }
    finally { bytes.fill(0); }
  }
  fs.writeFileSync(publicFile, crypto.createPublicKey(key).export({ format: 'pem', type: 'spki' }), { flag: 'wx' });
  console.log(`Update public key SHA-256 ${assertTrusted(key)}`);
}

async function signUpdate(installer, output) {
  const version = require('../package.json').version;
  stableVersion(version);
  const filename = `Workbench-Setup-${version}-win-x64.exe`;
  if (path.basename(installer) !== filename || path.basename(output) !== 'workbench-update.json') {
    throw new Error(`Expected ${filename} and workbench-update.json.`);
  }
  const key = readKey();
  assertTrusted(key);
  const { size } = fs.statSync(installer);
  if (size < 1 || size > MAX_INSTALLER_BYTES) throw new Error('The installer size is outside the update limit.');
  const sha256 = crypto.createHash('sha256');
  let bytesRead = 0;
  for await (const chunk of fs.createReadStream(installer)) {
    sha256.update(chunk);
    bytesRead += chunk.length;
  }
  if (bytesRead !== size) throw new Error('The installer changed while reading it.');
  const payload = { schemaVersion: 1, version, filename, sha256: sha256.digest('hex'), size };
  const signature = crypto.sign(null, canonicalPayload(payload), key).toString('base64');
  const signed = verifyManifest({ ...payload, signature }, fs.readFileSync(publicFile));
  fs.writeFileSync(output, `${JSON.stringify(signed, null, 2)}\n`, { flag: 'wx' });
  console.log(`Signed ${filename} (${payload.sha256})`);
}

async function main() {
  const [installer, output] = process.argv.slice(2);
  if (installer === '--init') initialize();
  else if (installer && output) await signUpdate(installer, output);
  else throw new Error('Use --init once, or pass the verified installer and workbench-update.json output path.');
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
