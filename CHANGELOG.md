# Changelog

## Unreleased

- Give auxiliary diagnostics an independent deadline, retain primary results with explicit omission reasons, and back off per workspace before probing recovery. Keep Stop distinct from diagnostic timeouts and reserve tool-result delivery time.
- Resolve consumer-test host packages dynamically from published tags or an installed DSH profile, record each resolved version, and verify frozen-lockfile reinstall without fixed host-version gates.

- Wait for all TypeScript diagnostic passes via correlated tsserver responses instead of accepting an early empty push notification. Update TypeScript Language Server to 4.4.1 for its read-only tsserver request API.
- Update bundled LSP packages and development services to DSH `0.2.2-rc.1`, Cordis 4.1, and Schemastery 3.19; require Node.js 24.9+.
- Preserve patched Undici 8.12.3 and Zod 4.6.7 in this repository’s dependency resolution when upstream pins older versions.
- Follow DSH’s effective session working directory for diagnostics, completion, snapshots, structure, and semantic queries, including directory recovery.
- Exercise the current native tool executor, working-directory changes, and packed bundle against DSH `0.2.2-rc.1`; older host versions are no longer covered.

- Expand bundled Tree-sitter structure support from 4 grammars to 21: Bash, C, C#, C++, CSS, Go, Haskell,
  HTML, Java, JSON, Julia, OCaml, OCaml interface, Python, QL DBScheme, Ruby, Rust, and Scala, alongside the
  existing JavaScript, TypeScript, TSX, and PHP. Each grammar is pinned by version, upstream commit, ABI, and
  SHA-256, and registers `declarations` queries with selective `imports`/`calls` coverage.
- Align the LSP service, tool, host peers, and development dependencies with DSH `0.2.0-rc.2` so the plugin loads on that runtime.
- Require Node.js 22.19+ or 24+ to match DSH 0.2.0.
- Use the same DSH launcher for plugin installation and Web startup.

## 0.1.5

- Support DSH `0.1.7-rc.2` by updating the bundled LSP packages, host peer ranges, and isolated package verification.

## 0.1.3

- Install the required DSH LSP service and tool automatically; require DSH `^0.1.3-alpha.2` and validate against `0.1.3-alpha.2`.
- Connect the provider and extra tool to actual DSH services, schemas, session workspaces, and plugin disposal.
- Implement real navigation, diagnostics, completion, document synchronization, configuration replies, timeouts, and bounded process cleanup.
- Add CSS routing, Tailwind candidate ranking, executable availability checks, and working packaged CLI/declarations.
- Replace skipped placeholders with real DSH and language-server tests, including isolated packed-artifact loading.

## 0.1.0-alpha.1

- Added bounded JSON-RPC framing, cancellation, retries, workspace containment, and server lifecycle management.
- Added deterministic multi-language routing, Blade precedence, normalized locations/hover/diagnostics/completions, and provenance-preserving merges.
- Added the read-only `lsp_extra` service surface and doctor diagnostics.
- Added focused protocol, security, lifecycle, routing, merge, and provider tests.
