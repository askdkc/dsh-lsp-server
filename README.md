# @askdkc/dsh-lsp-server

An LSP plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), providing code navigation, diagnostics, and completion without applying edits.

Supports PHP/Blade via **PHPantom**, TypeScript/JavaScript, Svelte, HTML, CSS, and Tailwind.

## Install

Requires Node.js **22.18+**. The DSH LSP packages and Node language servers install with this plugin. For PHP/Blade, install **PHPantom** so `phpantom_lsp` is in `PATH`.

Install from npm into the Web profile:

```sh
dsh plugin --profile web add @askdkc/dsh-lsp-server
```

Or install from GitHub:

```sh
dsh plugin --profile web add github:askdkc/dsh-lsp-server
```

Start or restart Web with `dsh web`.

[Configuration, tool usage, and troubleshooting](docs/usage.md)

## License

[MIT](LICENSE)
