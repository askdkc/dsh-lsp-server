# @askdkc/dsh-lsp-server

An LSP plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), providing code navigation, diagnostics, and completion without applying edits.

Supports PHP/Blade via **PHPantom**, TypeScript/JavaScript, Svelte, HTML, CSS, and Tailwind.

## Install

Requires Node.js **22.19+ (22.x) or 24+** and DSH **0.2.0-rc.2**. The DSH LSP packages and Node language servers install with this plugin. For PHP/Blade, install **PHPantom** so `phpantom_lsp` is in `PATH`.

Install from npm into the Web profile:

```sh
dsh plugin --profile web add @askdkc/dsh-lsp-server@latest
```

Do not install this plugin with `github:askdkc/dsh-lsp-server`. Git installs must build the untracked `lib` files through `prepare`, which pnpm blocks unless the exact Git dependency is allowed in the Web profile's `allowBuilds`. The published npm package includes the built files.

If `plugin add` stops with `ERR_PNPM_IGNORED_BUILDS` for `core-js`, set the build decision in the **Web profile's** `~/.dsh/profiles/web/pnpm-workspace.yaml`. Running `pnpm approve-builds` from the harness project does not configure that profile. To skip the script, add or update:

```yaml
allowBuilds:
  core-js: false
```

If the failed add already wrote the dependency, remove it with `dsh plugin --profile web remove @askdkc/dsh-lsp-server`, then repeat the add command using the same `dsh` launcher (for example, `pnpm dsh`). A dependency alone does not activate the plugin: confirm `@askdkc/dsh-lsp-server` appears in `dsh.profile.bundles` in the profile's `package.json`. See [installation troubleshooting](docs/usage.md#install) for details.

Version `0.1.9` is skipped on DSH 0.2.0-rc.2 because it declares DSH `0.2.0-rc.1` host peers. After installing a compatible release, use the explicit `@latest` above to update an existing dependency; an unqualified `plugin add @askdkc/dsh-lsp-server` can leave its locked old version installed with `Already up to date`. The version exemption is not a compatibility fix. Start or restart Web with `dsh web`.

[Configuration, tool usage, and troubleshooting](docs/usage.md)

## License

[MIT](LICENSE)
