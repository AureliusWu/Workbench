'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const updater=require('../electron/updater.cjs');

test('production signer requires the configured key and signs only the matching installer',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'workbench-signer-'));
  try {
    fs.mkdirSync(path.join(root,'scripts'));
    fs.mkdirSync(path.join(root,'electron'));
    for(const file of ['scripts/sign-update.cjs','electron/updater.cjs'])fs.copyFileSync(path.join(__dirname,'..',file),path.join(root,file));
    const version='9.8.7';
    fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({version}));
    const keys=crypto.generateKeyPairSync('ed25519');
    const publicKey=keys.publicKey.export({type:'spki',format:'pem'});
    fs.writeFileSync(path.join(root,'electron','update-public-key.pem'),publicKey);
    const installer=path.join(root,'Workbench-Setup-'+version+'-win-x64.exe');
    const payload=Buffer.from('test fixture, never a real installer');
    fs.writeFileSync(installer,payload);
    const output=path.join(root,'workbench-update.json');
    const env={...process.env,GITHUB_ACTIONS:'true'};
    delete env.WORKBENCH_UPDATE_PRIVATE_KEY;
    const run=(key)=>spawnSync(process.execPath,[path.join(root,'scripts','sign-update.cjs'),installer,output],{encoding:'utf8',env:key?{...env,WORKBENCH_UPDATE_PRIVATE_KEY:key.export({format:'der',type:'pkcs8'}).toString('base64')}:env});
    const absent=run();
    assert.notEqual(absent.status,0);
    assert.match(absent.stderr,/secret is missing/);
    assert.equal(fs.existsSync(output),false);
    const wrong=run(crypto.generateKeyPairSync('ed25519').privateKey);
    assert.notEqual(wrong.status,0);
    assert.match(wrong.stderr,/does not match/);
    assert.equal(fs.existsSync(output),false);
    const success=run(keys.privateKey);
    assert.equal(success.status,0,success.stderr);
    const manifest=JSON.parse(fs.readFileSync(output,'utf8'));
    assert.equal(updater.verifyManifest(manifest,publicKey).version,version);
    assert.equal(manifest.sha256,crypto.createHash('sha256').update(payload).digest('hex'));
    assert.equal(manifest.size,payload.length);
    assert.equal((success.stdout+success.stderr).includes(keys.privateKey.export({format:'der',type:'pkcs8'}).toString('base64')),false);
    assert.notEqual(run(keys.privateKey).status,0,'existing signed manifest must never be overwritten');
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
