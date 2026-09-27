# @askdkc/dsh-lsp-server

An LSP plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), providing code navigation, diagnostics, and completion without applying edits.

Supports PHP/Blade via **PHPantom**, TypeScript/JavaScript, Svelte, HTML, CSS, and Tailwind.

## Install

Requires Node.js **22.18+** and DSH **0.1.7-rc.2 or a compatible later 0.1.x release**. Compatibility is tested against **0.1.7-rc.2**; later DSH releases require their own verification. The required `@deepseek-ai/dsh-lsp` and `@deepseek-ai/dsh-tool-lsp` packages are installed automatically. For PHP/Blade, install **PHPantom** with `phpantom_lsp` in `PATH`. The other language servers are included.

From npm:

```sh
npx @deepseek-ai/dsh@0.1.7-rc.2 plugin --profile web add @askdkc/dsh-lsp-server
```

Or from GitHub:

```sh
npx @deepseek-ai/dsh@0.1.7-rc.2 plugin --profile web add github:askdkc/dsh-lsp-server
```

If you run DSH from a source checkout with `pnpm dsh web`, use `pnpm dsh plugin --profile web add ...` instead.

[Configuration, tool usage, and troubleshooting](docs/usage.md)

## License

[MIT](LICENSE)
