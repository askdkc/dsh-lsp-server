# Fixtures

`harness.ts` mounts the real Cordis, DSH LSP, filesystem, and subprocess services. `protocol-server.mjs` exercises document synchronization, server requests, cancellation, startup timeouts, and crashes. Its traces are written only into each test's temporary workspace.

Bundled-server E2E fixtures are created in temporary directories. Tailwind v3/v4 dependencies are pinned development aliases. PHPantom tests run only with `PHPANTOM_E2E=1` and an installed executable.
