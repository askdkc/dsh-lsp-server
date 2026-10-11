# PLAN: dsh-lsp-server 内蔵 Tree-sitter と保護 Lisp の統合

## 1. 目的と実装範囲
- `askdkc/dsh-lsp-server` に Tree-sitter を組み込み、構文構造と既存 LSP の意味情報を同じ入口から取得する。
- 配布物は既存の `@askdkc/dsh-lsp-server` 一つ。別プラグイン、別リポジトリ、常駐 RPC サーバーは作らない。
- `kiokuko-dsh` の保護 Lisp には、限定された読み取り専用アダプターだけを追加する。
- 多数ファイルの探索・絞り込み・集計は Lisp 内で実行し、モデルには上限付きの要約と必要なコード範囲だけを返す。
- 変更対象は両リポジトリの実装・テスト・README。今回の文書作成ではリポジトリやユーザー環境を変更しない。
- 編集適用、自動修正、任意 RPC、任意シェル実行、プロジェクト全体の AST 出力は対象外。

## 2. 現状と接続方針
- 実装開始時の基準は dsh-lsp-server v0.1.12 と kiokuko-dsh v0.2.1。作業開始時に対象コードを再確認する。
- 既存の `lsp` は定義・参照・実装・hover、`lsp_extra` は diagnostics・completion・status を担当する。
- provider は `fs`・`lsp`・`subprocess` を注入し、`WebstackLspRuntime(config, fs, subprocess)` を生成する。
- この注入経路を維持し、構造解析を同じ provider のライフサイクルへ追加する。
- 保護 Lisp の既存許可リストは `lsp`／`lsp_extra` を公開していない。現状でそのまま呼べるとは扱わない。
- 既存 bridge の `lisp_status` だけでは接続できないため、専用の型付き bridge 操作と許可判定を実装する。
- Lisp からツール名・サービス名・RPC メソッドを自由指定できる総称的 bridge は追加しない。

## 3. 内部構成と変更箇所
- dsh-lsp-server 内に `structure/runtime`、`structure/grammars`、`structure/queries`、`structure/coordinates` を追加する。
- `DocumentSnapshotStore` を新設し、構造解析と LSP 同期で共用する。既存の文書取得経路をここへ集約する。
- `CodeIntelligenceServiceV1` を新設し、snapshot・structure・semantic・release・capabilities を型付きで提供する。
- `createWebstackLspService` から既存 API を維持しつつ新 API へ委譲し、二重のキャッシュや独立した文書読込を避ける。
- provider はサービス登録・破棄と権限付きコンテキストの受渡しだけを担当する。
- `lsp_extra` に bounded な構造操作を追加し、既存 `lsp`／`lsp_extra` の引数・結果との互換性を保つ。
- kiokuko-dsh には `CodeIntelligenceAdapterV1` と明示的な Lisp primitive 登録を追加する。
- DSH 固有 API は provider と両アダプターへ閉じ込め、解析・座標・集計用データ型から DSH import を排除する。
- ホスト更新時の変更箇所を注入・scope 取得・キャンセル伝搬・サービス登録に限定する。

## 4. Tree-sitter の組み込みと配布
- 第一候補は `web-tree-sitter` と同梱 WASM。Node native addon は初期実装で採用しない。
- runtime、各 grammar、query 定義を固定バージョンで揃え、WASM ABI と実際の読み込み互換性を CI で検証する。
- grammar は上流の commit／version・ライセンス・生成 toolchain・配布 asset の hash をビルド設定で固定する。
- 利用者環境で grammar をコンパイルせず、選定済み asset を npm tarball に含める。
- Tree-sitter CLI は開発・asset 再生成時だけ使用可能とし、利用者の必須依存にしない。
- WASM は package 相対の解決を使い、起動ディレクトリやユーザーのグローバルインストールへ依存しない。
- packed artifact から core WASM と全有効 grammar を読み込むテストで、配布漏れを検出する。
- 同梱 grammar の ABI 不一致・破損・不足は capabilities に明示し、その言語だけを利用不能にする。
- 外部から指定された URL／パスの grammar や query を実行時に読み込む機能は初期版に入れない。
- WASM が必須 OS で成立しない場合だけ native 案を再設計し、配布負担と検証範囲を明示して判断する。

## 5. 文書 snapshot と座標契約
- snapshot は canonical workspace、owner、checkout identity、URI、内容 hash、単調増加 version を結び付ける。
- 内容は呼出元の `fs` と承認済み scope から取得し、モデルや Lisp に workspace root の上書きを許さない。
- unsaved overlay が利用可能なら同じ overlay を両エンジンへ渡す。利用不能なら disk snapshot と明示する。
- ファイルパス・symlink・URI を正規化して scope 内を確認し、外部 checkout や別 owner の内容を参照しない。
- 外部編集は読込時の内容検証で検出する。watcher だけを鮮度判定の根拠にしない。
- 変更された文書は新 version とし、古い handle は `STALE_SNAPSHOT`。暗黙に最新内容へ読み替えない。
- バッチの処理中は snapshot を pin し、同一ファイル内で異なる内容を混在させない。
- 複数ファイルには snapshot 集合の ID を付けるが、ファイルシステム全体の原子的な時点一致は保証しない。
- 一貫した集合が必要な処理は開始／終了時に内容を再検証し、変化があれば bounded retry または stale を返す。
- 正規の公開 range はゼロ始まり・UTF-16・半開区間。既存 completion の一始まり入力は境界で変換する。
- Tree-sitter binding の index／point 単位を固定版で実測し、UTF-8 byte と決めつけない。
- text offset、binding point、LSP position encoding の変換を専用モジュールに集中する。
- LSP の negotiated encoding を尊重し、UTF-8／UTF-16／UTF-32 と内部表現を明示的に変換する。
- 日本語・結合文字・絵文字・surrogate pair・CRLF・空行・EOF を往復変換テストする。
- 増分 parse は旧 snapshot との差分を正しい単位で `edit` に渡す。差分が信用できなければ full parse へ戻す。

## 6. 型付き構造 API と結果の上限
- `snapshot.open(path)` → opaque snapshot handle、version、language、source kind。
- `structure.outline(handle, range?, limit)` → 宣言種別・名前・range・子要約。
- `structure.enclosing(handle, position, kinds?)` → 最寄りの対象 node handle と bounded な祖先情報。
- `structure.query(handle, queryId, range?, limit)` → 登録済み query の capture 群。
- `structure.span(nodeHandle, maxChars)` → 検証済み範囲の本文と省略情報。
- `semantic.query(handle, operation, position?, limits?)` → definition／references／implementation／hover／diagnostics／completion のみ。結果は読み取り専用データとし、status は `capabilities()` で返す。
- `snapshot.release(handle)` と `capabilities()` を用意し、終了時にも自動解放する。
- handle は推測不能で owner・scope・checkout・snapshot version に束縛し、生ポインターや node object を公開しない。
- 結果は固定 schema とし、全 AST、全文書、任意深さの木走査を一括返却しない。
- query は配布済み `queryId` の allowlist。任意 Tree-sitter query、任意 predicate、評価コードは受け付けない。
- 初期上限案は文書 2 MiB、capture 200、outline 100、span 8,000 文字、1応答 32 KiB。
- バッチは最大 100 ファイル・入力合計 16 MiB・同時処理 2 件・出力合計 64 KiB とする。
- 上限は安全な管理側設定で調整できるが、呼出側指定は上限を引き下げる場合だけ受け付ける。
- 結果に `truncated`、処理済み件数、未処理理由を付け、打ち切りを完全な検索結果として扱わない。
- 継続 cursor も snapshot 集合と権限に束縛し、期限切れ・編集・scope 変更で無効化する。

## 7. LSP との同一内容連携
- semantic 呼出時は対象 snapshot の内容を didOpen／didChange で同期し、対象文書単位に順序を直列化する。
- 同期送信と request を同じ queue で順序保証し、結果受領時にも snapshot が current かを確認する。
- LSP 全体の project index が完全に更新されたとの保証はしない。同期不能・鮮度不明は明示的な状態で返す。
- 文書 version を持つ通知は照合し、照合不能な diagnostics は既存の安全な process 分離方式を維持する。
- primary／auxiliary server の成功・失敗を別々に表現し、一部失敗を空の成功結果へ潰さない。
- 構造の候補抽出後に LSP で定義・参照を確認し、名前一致だけで同一シンボルと判断しない。
- Tailwind は class 属性候補を構文で絞り、意味情報は既存 Tailwind server へ委譲する。
- `workspace/applyEdit`、rename、formatting、executeCommand と completion edit の適用は bridge から禁止する。
- 外部参照の URI／path にも scope 制約を適用し、許可外ファイルの本文を結果へ含めない。
- 読み取り専用 API は OS sandbox を意味しない。LSP の設定読込・キャッシュ生成は既存運用条件を維持する。

## 8. 保護 Lisp アダプター
- 公開 primitive は `code-open`、`code-outline`、`code-enclosing`、`code-query`、`code-span`、`code-semantic`、`code-release` とする案。
- 名前・引数・戻り値を schema で固定し、登録前に既存 Lisp naming と非衝突を確認する。
- 実装前に async host call の待機・中断契約を確認し、同期 eval を長時間占有する呼出経路を作らない。
- bridge は呼出元 owner／session／scope／checkout を信頼された host context から受け取る。
- Lisp の引数から owner、root、AbortSignal、サービス名、server command を注入できないようにする。
- host context の lease と snapshot pin を操作開始から finally まで保持し、cancel／例外／切断で必ず解放する。
- scope の失効、checkout 切替、セッション終了後の handle 再利用を拒否する。
- bulk 処理は Lisp の map／filter／集計へ返し、host 側でファイル数・時間・総出力の累積 budget を課す。
- モデルへ返す最後の値も別途制限し、Lisp が複数の小応答を連結して制限を回避できないようにする。
- 典型処理は「候補ファイル列挙 → outline/query → 件数集計 → 必要箇所だけ semantic/span → 短い要約」。
- 汎用 `lsp`／`lsp_extra` を丸ごと許可リストへ追加せず、専用操作の契約テストを通して公開する。
- service が未登録・version 非対応なら capability unavailable を返し、別経路への暗黙フォールバックをしない。

## 9. 言語と混在構文
- 第1段階は TypeScript、JavaScript、TSX、JSX。既存 TypeScript Language Server と組み合わせる。
- 第2段階は PHP、Blade、Svelte、HTML、CSS。各 grammar は品質・ライセンス・WASM 互換性を確認して選定する。
- PHP／Blade の意味情報は外部 PHPantom を使用し、既存導入方法を維持する。
- Svelte／Blade は outer grammar と script/style/PHP 等の領域を明示し、拡張子だけで単一言語と決めない。
- injection は allowlist と深さ・領域数・総 byte 上限を持ち、親範囲内だけを解析する。
- child range と原文 range の対応を保持し、仮想文書の生成文字・欠落部分に逆写像できない位置は返さない。
- 重複領域、境界をまたぐ node、壊れた tag/directive、動的 class は incomplete として扱う。
- grammar が未選定・未検証の混在言語は `unsupported`／`skipped` を返し、全面対応済みとは表示しない。
- Rust は第3段階。Rust grammar と `rust-analyzer` の server 設定・routing・起動確認を同時に実装する。
- 現行プラグインに Rust LSP があるとは扱わず、Rust 構文だけ有効な状態と意味情報利用可能な状態を区別する。
- Rust toolchain／rust-analyzer は外部要件として明示し、初期版の Node server 同梱へ無理に混在させない。

## 10. エラー・キャンセル・資源管理
- 共通状態は ok、partial、unsupported、unavailable、stale、cancelled、timeout、limit_exceeded とする。
- `ERROR` node と missing node を集計し、parse 成功と構文エラーなしを分ける。
- 未対応言語、解析省略、server 不在、timeout、空の diagnostics を「問題なし」として統合しない。
- 文書単位の parse／query は worker に隔離し、初期上限 2 秒、semantic 10 秒、batch 30 秒を設定する。
- 実測で調整するが無制限にしない。同期 WASM が協調中断できない場合は期限で worker を終了する。
- worker pool は初期 2、待機 queue 16、超過は busy。キャンセル済み task を開始しない。
- parser／tree／query object は worker 所有とし、並列 thread 間で mutable object を共有しない。
- cache は初期 32 文書・内容合計 32 MiB を LRU 管理し、tree を含む worker memory 上限も監視する。
- pin 中の entry は勝手に解放せず、上限到達時は新規受付を拒否する。lease 期限と終了処理で pin を回収する。
- eviction、更新、worker 終了、plugin disable 時に tree／parser／WASM 資源を解放する。
- provider dispose は待機 task の破棄、実行中 cancel、worker 終了、LSP process 解放を最後まで行う。

## 11. 実装フェーズと完了条件
### Phase 0: 契約と fixture
- 両 repo の scope／owner／checkout／cancel／pin／async bridge 契約を読み、固定した input/output schema を追加する。
- 同一文書の edits、Unicode、権限違反、混在言語を含む小さな fixture を用意する。
- 完了: DSH 非依存の service contract と、許可／拒否双方の adapter テストが定義される。
### Phase 1: WASM と文書基盤
- TS/JS/TSX/JSX grammar 同梱、snapshot store、座標変換、worker 制限を実装する。
- 完了: npm tarball だけで grammar をロードでき、full／incremental parse の結果が一致する。
### Phase 2: 構造 API と semantic 接続
- outline／enclosing／登録 query／span、version handle、LSP 同期 queue を実装する。
- 完了: 編集直後に stale を検出し、構造と semantic が同じ対象内容を使い、既存 LSP テストも通る。
### Phase 3: 保護 Lisp 接続
- 明示的 bridge、累積 budget、cancel 伝搬、pin 解放、Lisp 内集計を実装する。
- 完了: 実際の保護 Lisp から複数ファイルを処理でき、scope 越境・任意 RPC・別 owner handle を拒否する。
### Phase 4: Web stack と Rust
- PHP/Blade/Svelte/HTML/CSS の grammar と injection、Tailwind 候補抽出を追加する。
- Rust grammar と rust-analyzer の外部設定・プロトコル疎通を別の受入単位として追加する。
- 完了: 言語ごとの構文／意味／未対応領域が capabilities とテストで一致する。
### Phase 5: 実ホスト・OS・配布
- 実際の `askdkc/dsh-cli` と利用対象 DSH profile で両プラグインを有効化し、実 tool invocation を実行する。
- `@deepseek-harness-tui` 等の無関係な package を互換性テストの代用品にしない。
- 完了: clean consumer の install→activation→tool→update→disable が macOS／Ubuntu 26.04／Arch Linux で通る。

## 12. テスト設計
- 単体: coordinate round-trip、query capture、opaque handle、snapshot 失効、cache eviction、schema 上限。
- 差分: full parse と incremental parse の構造結果を固定 corpus と編集列で照合する。
- セキュリティ境界: traversal、symlink escape、異 owner、別 checkout、失効 scope、任意 RPC／query 拒否。
- 非同期: edit と query の競合、cancel during parse、timeout、queue overflow、dispose、worker crash と資源解放。
- LSP: didChange→request 順序、旧 version 通知、診断未到着、primary failure、auxiliary failure、encoding 交渉。
- 混在言語: script/style、Blade directive、壊れた領域境界、注入深さ、原文 range の逆写像。
- 回帰: 既存 navigation／diagnostics／completion／status、unsupported 文書の skipped、PHPantom 不在時の他言語動作。
- 実ホスト: mock のみで終わらせず、正しい profile に登録された実 tool と保護 Lisp の経路を両方確認する。
- 性能: 同じ fixture で時間・peak memory・返却量・LSP 起動回数を比較し、上限超過時の動作もテストする。
- 最小モデル比較: 同一課題・同一モデル設定・同一 fixture で、従来経路と Lisp 集計経路を対にする。
- 比較項目は回答正確性、見落とし、実際の入出力 token、tool 往復数。削減率や精度向上を事前に断定しない。
- API 費用を伴うモデル評価は承認後のみ実施する。未実施でも決定的テストの結果と混同しない。

## 13. README の必須完成形
- macOS、Ubuntu 26.04、Arch Linux を独立した節にし、CPU／OS／Node／pnpm／DSH の実測組合せを掲載する。
- Node 要件は現行 `^22.19.0 || >=24.0.0` を起点に、採用 WASM runtime と合わせて再検証する。
- 各 OS で前提導入→DSH 導入→plugin install→profile activation→確認→更新→無効化を省略せず記す。
- OS の package 名や apt／pacman／brew コマンドは上流と実機で確認したものだけを掲載する。
- 未確認の setup 手順は完成扱いにしない。必要なら同 repo に検証済み setup コマンドを実装して説明する。
- 現行の `pnpm dsh plugin --profile web add @askdkc/dsh-lsp-server@latest` は対応 host/profile で再確認する。
- `pnpm dsh web --no-open`、plugin list、bundle activation の確認を含め、dependency 追加だけを有効化と混同しない。
- CLI profile を使う場合は `askdkc/dsh-cli` 側の実際の起動・設定方法を確認し、web profile 手順を流用しない。
- Node 系 language server は既存 package dependencies を使い、重複した global install を要求しない。
- PHPantom と Rust の外部実行ファイルについて、導入先・version・PATH／明示 path・必要 toolchain を説明する。
- bundled WASM／grammar は利用者による Tree-sitter CLI 導入が不要であることを明記する。
- `lsp_extra status`、構造 query、semantic query、保護 Lisp の集計を実際の引数付きで掲載する。
- doctor の実行ファイル検査だけで完了にせず、実 server handshake と fixture に対する tool 結果を確認する。
- update／disable／remove、重複 provider、ABI mismatch、欠落 server、stale handle、権限拒否、timeout の対処を掲載する。
- consumer に継承されない依存 override、profile の build-script 許可、remote backend の制約も維持して説明する。
- tested-version matrix は DSH CLI/host、profile、両 plugin、Node、OS/arch、WASM/grammar、server を区別する。
- 未実施セルは未検証、失敗セルは非対応として表示し、将来版の模擬 version 判定を実 API 互換性に数えない。

## 14. リリース判定
- 同一 plugin の tarball に runtime・grammar・query・型定義・README が揃い、追加 plugin の導入を要求しない。
- 既存 LSP の動作を保ち、保護 Lisp の限定 bridge から構造と意味情報を安全に組み合わせられる。
- 全対応言語で鮮度・座標・省略・未対応・失敗が区別され、上限とキャンセルが実効的に働く。
- 必須 3 OS と実 DSH profile の受入を満たし、README だけで導入から無効化まで再現できる。
- 未完の Rust／混在領域は capability を有効化せず、実際に検証した範囲だけを公開する。
