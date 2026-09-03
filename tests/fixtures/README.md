# Fixtures

`fixture-server.ts` is a stdio JSON-RPC fixture used by lifecycle, retry, cancellation, and protocol tests. It intentionally performs no workspace writes. Real language-server E2E fixtures remain opt-in because PHPantom and Tailwind versions are environment-dependent.
