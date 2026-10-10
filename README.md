# @askdkc/dsh-lsp-server

A read-only LSP plugin for DeepSeek Harness. It provides code navigation, diagnostics, and completion for PHP/Blade, TypeScript/JavaScript, Svelte, HTML, CSS, and Tailwind.

Markdown and other unsupported documents return an explicit `skipped` diagnostic result, not a tool error or a clean-file claim. `lsp_extra status` reports routing suffixes and server availability. See [diagnostic behavior](docs/usage.md#tools).

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

### Apply a newly published update immediately

Bypass pnpm's release-age delay for this operation, including its dependencies:

```sh
pnpm dsh plugin --profile web add @askdkc/dsh-lsp-server@latest --config.minimum-release-age=0
```

The flag reaches the pnpm process running inside the Web profile and overrides its release-age setting without changing global configuration. Reuse this command for every release. See [pnpm's release-age settings](https://pnpm.io/settings/dependency-resolution#minimumreleaseage).

An `incompatible with dsh` rejection is a separate check. DSH supports only exact plugin/runtime exemptions; there is no wildcard grant that survives upgrades. If you deliberately accept the compatibility risk (crashes or data loss), run this reusable block from the DSH project root. It reads both versions automatically, grants that exact pair, and installs the same plugin version, so a moving `latest` tag cannot select a different release between approval and installation:

```sh
(
  set -eu
  plugin='@askdkc/dsh-lsp-server'
  profile='web'
  plugin_version=$(pnpm view "$plugin@latest" version)
  dsh_version=$(pnpm --silent dsh --version)
  pnpm dsh plugin --profile "$profile" allow-version "$plugin@$plugin_version" \
    --dsh-version "$dsh_version" --accept-risk
  pnpm dsh plugin --profile "$profile" add "$plugin@$plugin_version" --config.minimum-release-age=0
)
```

Change `plugin` and `profile` to reuse it for another plugin or profile. It still creates an exact exemption on each run; it does not make an incompatible plugin compatible. See [DSH's compatibility exemption rules](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/boot/plugin-manager/README.md#version-compatibility-and-exemptions).

Start or restart Web without opening a browser, from the same project root:

```sh
pnpm dsh web --no-open
```

Install the published npm package, not a Git dependency. The npm package includes its built files; a Git install must build them during `prepare` and may be blocked by the Web profile's `allowBuilds` policy. For install recovery and configuration, see [Usage and configuration](docs/usage.md).

## License

[MIT](LICENSE)
