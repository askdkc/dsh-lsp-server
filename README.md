# @askdkc/dsh-lsp-server

An LSP plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), providing code navigation, diagnostics, and completion without applying edits.

Supports PHP/Blade via **PHPantom**, TypeScript/JavaScript, Svelte, HTML, CSS, and Tailwind.

## Install

Requires Node.js **22.18+**. For PHP/Blade, install **PHPantom** with `phpantom_lsp` in `PATH`. The other language servers are included.

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
