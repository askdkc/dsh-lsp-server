# @askdkc/dsh-lsp-server

An LSP plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), providing code navigation, diagnostics, and completion without applying edits.

Supports PHP/Blade via **PHPantom**, TypeScript/JavaScript, Svelte, HTML, CSS, and Tailwind.

## Install

Requires Node.js **22.18+** and DSH **0.1.3-alpha.2 or a compatible later 0.1.x release**. The required `@deepseek-ai/dsh-lsp` and `@deepseek-ai/dsh-tool-lsp` packages are installed automatically. For PHP/Blade, install **PHPantom** with `phpantom_lsp` in `PATH`. The other language servers are included.

From npm:

```sh
pnpm dsh plugin --profile web add @askdkc/dsh-lsp-server
```

Or from GitHub:

```sh
pnpm dsh plugin --profile web add github:askdkc/dsh-lsp-server
```

[Configuration, tool usage, and troubleshooting](docs/usage.md)

## License

[MIT](LICENSE)
