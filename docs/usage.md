# Usage and configuration

[Back to README](../README.md)

A composite language-server plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). It provides precise code navigation through DSH's standard `lsp` tool and diagnostics/completion through `lsp_extra`.

| Files | Primary server | Additional support |
|---|---|---|
| PHP, Blade | PHPantom (external executable) | Tailwind for Blade |
| TypeScript, JavaScript, JSX, TSX | TypeScript Language Server | Tailwind |
| Svelte | Svelte Language Server | Tailwind |
| HTML | VS Code HTML Language Server | Tailwind |
| CSS, PCSS | VS Code CSS Language Server | Tailwind |

The five Node language servers and TypeScript are package dependencies. PHPantom must be installed separately as `phpantom_lsp`, or configured with an explicit executable path. Disabling PHPantom does not disable the other languages.

## Install

See the [installation commands](../README.md#install).

The bundle adds `lsp`, `lsp-webstack-provider`, `tool-lsp`, and `tool-lsp-extra` rows. It requires DSH's LSP/tool packages and the profile's `fs`, `subprocess`, `tools`, and `systemPrompt` services. DSH packages are host-provided peers; installing this package alone does not install the harness. If you already enabled another LSP provider for these extensions, remove its overlapping mappings first: DSH intentionally rejects duplicate ownership with `LSP_CONFLICT`. If your profile already declares the `lsp` or `tool-lsp` rows, compose the provider and extra-tool rows manually instead of inserting the whole bundle twice.

These instructions follow [DSH's profile composition](https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/apps/cli/README.md). No user profile is changed by this repository's tests or doctor command.

## Tools

DSH's standard `lsp` tool supports `goToDefinition`, `findReferences`, `goToImplementation`, and `hover`, where the selected language server supports that operation. References include declarations.

Additional tool calls:

```json
{"operation":"status"}
{"operation":"diagnostics","file_path":"src/app.ts","severity":"error"}
{"operation":"completion","file_path":"src/app.ts","line":12,"character":8}
```

Both tools obtain the workspace from the **calling session**. Completion's line and character are **one-based UTF-16**; diagnostic/output ranges are **zero-based UTF-16**. The model cannot supply a different workspace root. The underlying service API uses zero-based positions.

Hover and completion can include Tailwind results. Completion ranks the typed prefix before truncating large catalogs. Diagnostics report omitted auxiliary servers; no publication before the deadline is a failure, not a clean-file result. Unsupported navigation returns `LSP_UNSUPPORTED_OPERATION`.

For servers that publish diagnostics as notifications, each diagnostic query starts a fresh process if the previous process was already used. This prevents delayed notifications from an earlier document close from being mistaken for a clean result. It adds server startup and project indexing cost to repeated diagnostic queries. Servers supporting `textDocument/diagnostic` reuse their process because responses are associated with request IDs.

## Configuration

Override the existing provider row in your profile's `cordis.patch.yml`, using DSH's row-id patch syntax:

```yaml
- id: lsp-webstack-provider
  config:
    missingServerPolicy: warn
    servers:
      phpantom:
        enabled: true
        mode: path
        command: phpantom_lsp
        args: ['--stdio']
      typescript:
        mode: bundled
    tailwind:
      enabled: true
      queryStrategy: candidate
```

`missingServerPolicy: warn` lets available languages work when another executable is missing; status/doctor report availability, and a query to a missing primary server fails. `error` rejects plugin startup if an enabled executable is unavailable. A failed auxiliary hover/completion does not discard a successful primary result.

Each server accepts `enabled`, `mode` (`bundled` or `path`), `command`, `args`, `env`, `initializationOptions`, and `configuration`. In `path` mode, `command` is required except for PHPantom. `env` is passed through DSH's subprocess service and layered onto its scrubbed environment. `workspace/configuration` resolves requested sections from `configuration`.

Other options include `providerId`, `limits.maxDocumentBytes`, `limits.maxMessageBytes`, `limits.maxStderrBytes`, operation-specific `timeouts`, `routing.bladeSuffixes`, and Tailwind `classAttributes`, `classRegex`, `includeLanguages`, and `queryStrategy` (`candidate` or `always`). See [configuration defaults](../src/config.ts) for defaults. Tool row `tool-lsp-extra` accepts `maxDiagnostics`, `maxCompletions`, `maxResultChars`, and `timeoutMs`.

Bundled mode resolves executables on the Node host and is intended for local DSH filesystem/subprocess backends. Remote backends require `path` mode with executables and dependencies installed in that execution environment; remote operation is not covered by this test suite.

## Doctor

```sh
node lib/cli/doctor.js --json
node lib/cli/doctor.js --config ./webstack-config.json --deep
```

The JSON config file contains the provider configuration object above. Doctor checks package binaries and PATH availability without launching servers, and exits nonzero when an enabled server is missing. `--deep` adds an explicit read-only inspection summary; it is **not** a protocol handshake or a check of the running DSH profile. Runtime status is available through `lsp_extra`.

## Verification

Source installs build automatically through `prepare`; npm releases include the built files. `.npmrc` prevents automatic resolution of the published DSH packages’ incomplete peer tree during development and Git builds.

```sh
pnpm install --frozen-lockfile
pnpm check                 # types, deterministic/DSH integration tests, build, packed-artifact smoke test
pnpm test:e2e              # real TS/JS, HTML, CSS, Svelte, Tailwind v3/v4
PHPANTOM_E2E=1 pnpm test:e2e # additionally tests installed PHPantom with PHP and Blade
```

The packed-artifact test extracts the archive into an isolated consumer, supplies DSH peers, imports its public exports, and runs a real TypeScript query. It also checks declaration paths and the executable doctor. E2E needs working OS file watchers; sandboxed macOS watchers may fail with `EMFILE`.

Integration tests run against the published DSH `0.0.1-rc.1` service/tool packages and Cordis 4.0.2. Contracts were also compared with upstream commit `d347e703908d0406b7a7ef80e3a0e594d86b2215` (`0.1.3-alpha.1`). The full Web UI and a source-built upstream application are not exercised here.

### Dependency security

This repository pins Vite to 6.4.3 (which uses patched esbuild 0.25.x) and overrides the Svelte Language Server's fallback compiler to Svelte 5.55.7. These versions address [Vite's Windows path bypass](https://github.com/advisories/GHSA-fx2h-pf6j-xcff) and the [Svelte SSR](https://github.com/advisories/GHSA-pr6f-5x2q-rwfp) / [DOM clobbering](https://github.com/advisories/GHSA-rcqx-6q8c-2c42) advisories. Run `pnpm audit` after dependency updates. The Svelte E2E tests exercise fallback compilation with both legacy and rune syntax, including diagnostics after edits.

The pinned `svelte-language-server` still declares Svelte 4 as its dependency. Repository overrides and `pnpm-lock.yaml` do **not** propagate when this plugin is installed as a dependency. Until upstream changes that dependency, the host installation must apply its own override to obtain the patched fallback compiler. For npm, merge this into the installation root's `package.json`, reinstall, and run `npm audit`:

```json
{
  "overrides": {
    "svelte-language-server": {
      "svelte": "5.55.7"
    }
  }
}
```

For pnpm 9, use `"svelte-language-server>svelte": "5.55.7"` in the installation root's `pnpm.overrides`, reinstall, and run `pnpm audit`. See [npm's root-only override rules](https://docs.npmjs.com/cli/v11/configuring-npm/package-json#overrides). The language server can also load a project's own Svelte compiler; project dependencies need separate updates. A clean repository audit does not establish that installed consumers or projects are clean.

The provider reads current documents through `ctx.fs`, confines sources to the canonical workspace, and starts/cleans up processes through `ctx.subprocess`. It refuses `workspace/applyEdit` and never applies completion edits. Language servers themselves may read project dependencies, evaluate framework configuration, and write caches; this plugin is not an OS sandbox.
