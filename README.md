# @askdkc/dsh-lsp-server

An LSP plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), providing code navigation, diagnostics, and completion without applying edits.

Supports PHP/Blade via **PHPantom**, TypeScript/JavaScript, Svelte, HTML, CSS, and Tailwind.

## Install

Requires Node.js **22.18+**. The DSH LSP packages and Node language servers install with this plugin. For PHP/Blade, install **PHPantom** so `phpantom_lsp` is in `PATH`.

Install from npm and start Web with the same DSH preview channel:

```sh
npx @deepseek-ai/dsh@next plugin --profile web add @askdkc/dsh-lsp-server
npx @deepseek-ai/dsh@next web
```

To install this repository instead:

```sh
npx @deepseek-ai/dsh@next plugin --profile web add github:askdkc/dsh-lsp-server
npx @deepseek-ai/dsh@next web
```

For a DSH source checkout, use `pnpm dsh` in both commands instead of `npx @deepseek-ai/dsh@next`.

[Configuration, tool usage, and troubleshooting](docs/usage.md)

## License

[MIT](LICENSE)
