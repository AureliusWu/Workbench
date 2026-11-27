# Workbench agent engineering and release rules

These rules apply equally to chat mode, Work mode, Codex and human developers.

- Inspect main, recent commits, active branches and CI before edits; never overwrite concurrent work. Use focused commits, no force pushes.
- Preserve appId, NSIS GUID, user data directory, schema compatibility and the Ed25519 trust anchor. Never disable signature or SHA-256 checks.
- Run build, unit tests, native tests, Electron E2E and real Windows updater lifecycle. Failed CI is a blocker, not a waiver. Report actual run links/results.
- Use the hash-pinned published v1.2.0 installer as the Windows update baseline for v1.3.0 and later. Verify the helper's relaunched PID, visible window, installed version and protected data hashes in that run.
- Never request secrets in chat, commit secrets, print them, or give normal CI access. The production environment secret is WORKBENCH_UPDATE_PRIVATE_KEY; only the trusted signing step may receive it.
- This is a private-use two-person app; prioritize user feedback and stable updates. Keep one production environment and one explicit release flow; no extra service or enterprise approval chain. Treat workflow, signer and trust-anchor changes as security-sensitive; never bypass configured protections.
- After updating package and lockfile versions, changelog and release notes, trigger Publish signed Windows release on main, or commit an explicit .github/release-request.json with the target version and a positive attempt number. The push trigger is for agents whose connector cannot dispatch workflows. Never modify this request during ordinary development. It tests the same commit, signs the same installer, stages all assets, validates the draft and publishes. Never publish an untested build or overwrite an existing release/tag.
- Missing secret, permissions, approvals or failed checks must be reported explicitly; do not claim release success without verifying the real Release and installer assets.
- Keep README accurate about actual published versions; document limitations and preserve user data. Do not rotate a trusted key without an explicit migration plan.
- Keep reference archives, extracted code, artwork and personal records local. Implement compatible behavior independently with Workbench's own components and data model.
