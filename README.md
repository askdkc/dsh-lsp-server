# @askdkc/dsh-lsp-server

A read-only LSP plugin for DeepSeek Harness. It provides code navigation, diagnostics, and completion for PHP/Blade, TypeScript/JavaScript, Svelte, HTML, CSS, and Tailwind.

## Requirements

- Node.js 22.19+ (22.x) or 24+
- DSH providing the `fs`, `subprocess`, `tools`, and `systemPrompt` services
- PHPantom for PHP/Blade support (`phpantom_lsp` must be in `PATH`)

This plugin imposes no DSH version range at startup: imports and initialization report actual failures. This does not guarantee compatibility with every future DSH API.

## Install

Run this from the DeepSeek Harness project root, after the updated npm release is available:

```sh
pnpm dsh plugin --profile web add @askdkc/dsh-lsp-server@latest
```

`@latest` selects the npm `latest` tag. Older releases declared exact DSH host peers and can be skipped after a DSH update. Local source changes do not update the published package.

Start or restart Web without opening a browser, from the same project root:

```sh
pnpm dsh web --no-open
```

Install the published npm package, not a Git dependency. The npm package includes its built files; a Git install must build them during `prepare` and may be blocked by the Web profile's `allowBuilds` policy. For install recovery and configuration, see [Usage and configuration](docs/usage.md).

## License

[MIT](LICENSE)
