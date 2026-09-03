# @askdkc/dsh-lsp-webstack
A read-only composite LSP provider for DeepSeek Harness web stacks. It routes PHP/Blade, TypeScript/JavaScript, Svelte, HTML, CSS, and Tailwind requests to package-local language servers while keeping edits out of the provider contract.

## Install

```sh
pnpm add @askdkc/dsh-lsp-webstack
# or
npm install @askdkc/dsh-lsp-webstack
```

The package requires Node.js 20.11 or newer. Bundled servers are installed as runtime dependencies. PHPantom is an external executable and must be installed separately (normally `phpantom_lsp` in `PATH`).

## DSH composition

The package ships a Cordis patch at `cordis.patch.yml`. Register the provider and its optional `lsp_extra` tool through the normal DSH bundle configuration. A local override can replace a patch row without modifying this package:

```yaml
patch:
  - package: '@askdkc/dsh-lsp-webstack'
    override:
      providerId: 'my-lsp'
      missingServerPolicy: warn
```

## Configuration

Configuration is validated and defaulted at the provider boundary. Important keys include `servers.<id>.enabled`, `servers.<id>.mode` (`bundled` or `path`), `servers.<id>.command`, `limits`, `timeouts`, `tailwind.queryStrategy` (`candidate` or `always`), `routing.bladeSuffixes`, and `missingServerPolicy` (`warn` or `error`). Never place credentials in server environment values supplied to user-facing output.

PHP and Blade use PHPantom; `.blade.php` has Blade precedence over `.php`. TypeScript Language Server handles `.ts`, `.tsx`, `.js`, and `.jsx`; Svelte and HTML use their corresponding servers. Tailwind is an auxiliary hover/completion provider and is queried only for candidates unless configured otherwise.

## Diagnostics, hover, completion

Navigation is primary-server-only. Hover merges primary content first and may append Tailwind content. Diagnostics and completion preserve server provenance, deduplicate deterministically, and report truncation metadata. Auxiliary failures do not discard a successful primary result. Completion returns data only: the provider never applies `textEdit` or other file mutations.

## Doctor

After building, run:

```sh
pnpm exec dsh-lsp-webstack --json
pnpm exec dsh-lsp-webstack --deep
```

`doctor` reports enabled/available servers, missing dependencies, and composition issues. JSON output is stable and safe for automation; commands and filesystem paths are redacted. `--deep` remains read-only and does not create files, launch persistent servers, or apply edits.

## Development and release checks

```sh
pnpm install
pnpm check       # typecheck, full tests, build
pnpm test:e2e    # opt-in real-server suites
pnpm pack        # package contents and prepack checks
```

Real PHPantom and Tailwind v3/v4 E2E suites are environment-dependent and are skipped unless their fixture dependencies are available. Protocol, security, lifecycle, cancellation, merge, and provider behavior are covered by deterministic tests. CI runs typecheck, tests, build, and pack on supported Node versions.

## Read-only safety

This package reads workspace documents and communicates with language servers. It does not write source files, apply completion edits, execute project scripts, or modify project configuration. Process cleanup is bounded and language-server failures are surfaced as stable service errors.
