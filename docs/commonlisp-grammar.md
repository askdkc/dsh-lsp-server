# Common Lisp grammar

`src/structure/grammars/tree-sitter-commonlisp.wasm` is built from the MIT-licensed
`tree-sitter-grammars/tree-sitter-commonlisp` parser at commit
`32323509b3d9fe96607d151c2da2c9009eb13a2f`. Its ABI is 14. The upstream license
is shipped alongside the WASM. Normal package builds and consumer installations
use the checked-in asset, without downloading or compiling a grammar.

The build checks the asset's SHA-256 and loads it with the installed
`web-tree-sitter` to verify ABI compatibility. npm-distributed grammars retain
their additional comparison with the installed upstream npm asset.

## Rebuilding

Use a temporary directory. Download these inputs from the pinned repositories
(the hashes below are Git blob SHA-1 values, checked with `git hash-object`):

| Repository / commit | Path | Git blob SHA-1 |
| --- | --- | --- |
| tree-sitter-grammars/tree-sitter-commonlisp @ 32323509b3d9fe96607d151c2da2c9009eb13a2f | src/parser.c | 5c77ec728498c60dfdaa9662cb294eac00702e7d |
| same | src/tree_sitter/parser.h | 799f599bd4e292e95565f90733c59fa422899eae |
| tree-sitter/tree-sitter @ 1211d705caa438e2ff255cb55a968440c042ce79 | crates/language/wasm/include/stdint.h | 10cc35dc7fe4775133bab03cc45a9b7ec1928b36 |
| same | crates/language/wasm/include/stdlib.h | 41a32e8e4ce93f768c82975ea98385c7fea62378 |

Preserve `src/parser.c` and `src/tree_sitter/parser.h`; place the two standard
headers in `include/`. No external scanner is required. From that directory:

```sh
clang --target=wasm32 -fPIC -Os -nostdlib -fvisibility=hidden \
  -I include -I src -c src/parser.c -o parser.o
wasm-ld --shared --no-entry --allow-undefined \
  --export=tree_sitter_commonlisp parser.o -o tree-sitter-commonlisp.wasm
```

The checked-in asset was built with Apple clang 21.0.0
(`clang-2100.4.1.1`) and LLD 23.1.1 from the installed Rust toolchain.
Other compatible LLVM toolchains can produce different bytes. After an
intentional rebuild, update the asset SHA-256 in the manifest and run:

```sh
npm run typecheck
npm test
npm run build
npm run test:package
```

## Supported behavior

`.lisp`, `.lsp`, `.cl`, and `.asd` use the Common Lisp parser. The shared
snapshot API supports outlines, enclosing syntax nodes, bounded source spans,
and the registered `declarations` and `imports` queries. Function definitions
include `defun`, `defmacro`, `defgeneric`, and `defmethod`, including SETF names.
Generic list patterns cover uppercase/mixed-case definitions, classes,
structures, variables, constants, types, conditions, and packages.
Package forms (`defpackage`, `in-package`, `require`) are syntax matches;
they do not resolve dependencies. There is no `calls` query because an arbitrary
Lisp list is not necessarily a function call. No Lisp is evaluated, and this
does not provide semantic completion, references, or macro expansion.

The upstream grammar is not a complete Common Lisp reader. Reader extensions
and implementation-specific syntax may produce a partial parse; syntax errors
remain visible through the existing snapshot/structure result contract.
