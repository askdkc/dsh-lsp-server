# Diagnostic aggregation verification

Verified 2026-11-13 (JST), macOS arm64 / Node v26.13.0.
Base revision: `6c9616303f90948b0a6f34638f7065311d5522a4`.
Changes are local and uncommitted. No running DSH profile was modified.

## Verified behavior

- Healthy primary diagnostics survive a silent auxiliary server, including an
  equal 700ms caller deadline and a shorter custom extra-tool deadline.
- Both healthy servers contribute diagnostics; explicit primary-only selection works.
- Auxiliary failures carry timeout/unavailable reasons while preserving the
  backward-compatible `omittedServers` list.
- Subsequent files skip the failed auxiliary during cooldown, concurrent files
  avoid duplicate probes, and successful retry restores auxiliary diagnostics.
- Stop remains AbortError and does not start cooldown. Strict diagnostic timeout
  remains an error, now identified as TimeoutError.
- Snapshot semantic queries report partial status and retain primary diagnostics.
- The real DSH native tool executor returns the partial diagnostic result.
- The bundled TypeScript server retains error 2322 with a silent auxiliary LSP.
- Installed consumer packages resolve independently, including mixed versions and
  hidden manifest exports. Published consumers resolve per-package tags; no
  fixed DSH-version gate remains in the consumer test.

## Commands and outcomes

| Check | Outcome |
| --- | --- |
| `npm run typecheck` | Passed |
| `npm test` | 21 files, 107 tests passed |
| `npm run build` | Passed |
| `npm exec vitest run -- --config vitest.e2e.config.ts tests/e2e/tailwind.e2e.ts -t 'retains bundled TypeScript'` | New regression passed; 2 unrelated tests excluded |
| `npm run test:e2e` | 5 passed, 5 failed, 1 skipped (PHPantom opt-in) |
| `npm run test:package` | Blocked resolving published tags: registry.npmjs.org ENOTFOUND |
| Current installed DSH profile consumer | Blocked: @deepseek-ai/dsh-working-directory missing from the selected dsh-cli profile |
| `git diff --check` | Passed |

The five full-E2E failures are three existing Svelte tests (LSP stdout closes)
and the existing Tailwind v3/v4 hover tests (no hover contents). An isolated
pre-change source copy reproduces all five. Their causes are not established
by this change. PHPantom was not enabled.

The new equal-deadline regression fails with AbortError against the pre-change
runtime. The new bundled-TypeScript regression also fails against that runtime
at the external deadline. Both pass with the changed source.

Running the full unit suite concurrently with other process-heavy suites exposed
startup delays beyond the fixture's short deadline (initialize was cancelled
before didOpen). Unit-test worker concurrency is now bounded to four, and the
Stop/concurrent-probe tests use longer startup budgets. The final full suite
passed after this adjustment; the equal-deadline regression remains 700ms.

The installed profile resolved DSH tools/app-boot to 0.2.2-rc.2 and Cordis plugin
group to 1.1.0 before the missing working-directory package was detected. These
are observations, not version requirements. Neither published-host admission nor
current-profile smoke execution completed. The historical three-minute stall
and the installed runtime's correspondence to this checkout remain unverified.

## Artifact identity

SHA-256 after the successful build:

- `src/runtime/webstack-runtime.ts`: `a106857b4fc7ce4e4639102ca35b78ad0e104622e240d0c900de14239567ae05`
- `src/extra-tool.ts`: `d90bd70217267501174d123f76f7749edab08712806ccd46d6f5627d43173b26`
- `lib/provider.js`: `bbeb0ae073eb940d1e28043f868b6672cc7d869d76c6c91bbf3056d136d99122`
- `lib/extra-tool.js`: `cc0f3fbd624a011f695b0e68213268f63898e26048bccb99f99f765d7529dc13`

Source-backed integration tests and the build succeeded. Fresh isolated package
installation and deployed-runtime execution are not established by those passes.

## CI consumer resolution correction

The subsequent CI run on `bcc26825692e0fea6156848403701a6c65582b10`
([run 43391739537](https://github.com/askdkc/dsh-lsp-server/actions/runs/43391739537),
job 131773076122) passed all 107 unit/integration tests and the build, then
failed the published consumer smoke test. The selected `dsh-tools` latest tag
was 0.0.1-rc.1, while the executor was 0.2.2-alpha.2. The executor's import of
`dsh-tools/pipeline` failed with `ERR_PACKAGE_PATH_NOT_EXPORTED`. These numbers
are the observed failed configuration, not requirements or selection rules.

The default resolver now compares SemVer precedence across each package's
latest/next/rc/beta/alpha tag targets. Explicit package-specific tag overrides
still take precedence. It does not treat the presence of latest as evidence
that latest is the newest version. Installed-profile resolution is unchanged.

Regression tests reproduced the stale-latest selection before the correction
(7 failures), then passed after it. Numeric major/minor and prerelease ordering,
stable releases, build metadata, mixed package channels and explicit overrides
are covered. Final `npm run typecheck` and `npm test` passed (21 files, 116 tests).
`git diff --check` passed. Fresh registry installation and a new hosted CI run
remain unverified; registry access from the execution host is unavailable.
