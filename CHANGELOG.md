# Changelog

## Unreleased

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
