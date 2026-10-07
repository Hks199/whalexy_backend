# Verifying source contracts

`npm run parity` is independent of successful tests of the new API. No original contract is automatically considered converted because a Node route or Prisma model exists.

Run `npm run test:evidence` to generate the executed Vitest JSON report. Each reviewed entry in `verified-contracts.json` is keyed by `source:line:method:localPath` from `source-inventory.json` and needs:

- `nodeEndpoint`: the implemented method and path.
- `reviewedLegacyBehavior`: true only after checking the source authorization, validation, response and side effects, including failure cases.
- `sourceSha256`: the SHA-256 digest of the original route file used in the review.
- `testFile`: a test file within this project.
- `testNames`: exact `fullName` strings of passing tests from the executed report.
- `nodeFiles`: an array of `{ "path": "src/...", "sha256": "..." }` entries for the reviewed implementation.

The gate checks current source/implementation hashes, named passing tests and report freshness. Updating a mapping without running its tests is insufficient. Manual source review is still required; this gate cannot prove semantic equivalence by itself.

Route declarations include views and maintenance helpers. Review each declaration deliberately; frontend view contracts and intentionally removed unsafe helpers need an explicit compatibility decision. Run `npm run migration:routes` for [the source route inventory](legacy-route-inventory.json), which follows route includes and records enclosing prefixes, explicit ANY/MATCH methods, source hashes and stable declaration IDs. This is a source inventory; conditional and package-generated routes still require a runtime review. [Contract progress](contract-progress.json) records partial adapters separately from accepted verification evidence.

The four conditions in `acceptance.json` remain false. Set them true only after recording supporting database import/round-trip evidence, original frontend compatibility, provider contract checks and review of all domain workflows. Completing route mappings alone does not pass the global acceptance gate.
