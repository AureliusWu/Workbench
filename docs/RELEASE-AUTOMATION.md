# Unified Windows release pipeline

The release workflow is agent-independent. Ordinary push/PR CI has no private key. The manually dispatched production release (or an explicit release request committed to main) invokes the same quality workflow on the selected main commit, downloads that run's verified artifact, signs its manifest, stages a draft, compares uploaded bytes and only then publishes. Existing tags/releases are not overwritten.

## One-time owner configuration

1. In repository Settings → Environments create **production**. Restrict deployments to the main branch. Enable required owner review where available; protect main and the workflow/signing paths through repository rules and review. A secret cannot protect against untrusted code approved to run in its environment.
2. Preserve the existing public key in electron/update-public-key.pem. On the Windows account that originally generated the DPAPI key, use an authenticated GitHub CLI (gh auth login) and run `node scripts/sign-update.cjs --configure-ci`. It verifies the public key and pipes base64 PKCS#8 DER directly to gh secret set, without displaying the private key. Keep an offline recovery backup.
3. If that key is unavailable, do NOT silently change the trust anchor. Check all distributed builds first. The stable 1.0.1/1.1.0 releases predate automatic updates; any privately distributed 1.2.0 candidate with the old public key would need manual reinstallation. Only after owner approval, generate a new Ed25519 key on a trusted machine, upload its base64 PKCS#8 DER as production's WORKBENCH_UPDATE_PRIVATE_KEY, and commit only its matching SPKI public PEM. Back up the private key securely. Never paste it into chat or logs.
4. From Actions → Publish signed Windows release → Run workflow, select main. Alternatively, an agent can commit `.github/release-request.json` containing `{"version":"1.2.0","attempt":1}` (increment attempt only for an intentional retry, never during ordinary edits). This path starts the same release pipeline without requiring workflow dispatch privileges. Approve the protected environment when requested. The workflow refuses to publish if any tests, artifact checks, signing, upload checks or secret configuration fail.

If a staged draft exists after a failure, review its assets and target commit; do not overwrite or promote an unverified draft. Remove only the failed draft/tag after owner review before rerunning. Windows Authenticode signing is separate and not provided by this manifest signature.

Release acceptance: check the workflow conclusion, the published tag/commit, three release assets, latest download manifest and client verification. Never infer success from source code alone.
