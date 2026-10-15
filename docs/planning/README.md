# Workspace分離型Botプラットフォーム — 開発計画一式

**2026-10-15 / r2：domain別Drizzle・Repository層なし / 実装前の提案**

NanoClawを参照しつつ、新規にスクラッチ開発するための計画。OneCLIは組み込まず、Vault・Gateway・外部認証・規則・承認を自作する。UIはWeb、Claude Agent SDKはTypeScript、制御層はBun、秘密と認可の境界はRustを基本案とする。

## 読む順番

| 文書 | 内容 |
|---|---|
| [BRIEF.md](BRIEF.md) | 固定要件、推奨前提、安全上の不変条件 |
| [ROADMAP.md](ROADMAP.md) | アーキテクチャ、domain、P0–P10、依存関係、各gate |
| [SECURITY-ACCEPTANCE.md](SECURITY-ACCEPTANCE.md) | 越境、鍵、承認、egress、復旧の受入試験 |
| [SOURCES.md](SOURCES.md) | 固定コミット、一次情報URL、確認日、未検証事項 |

## r2の変更

各DB-owning `packages/<domain>` にDrizzle schema・migration・設定を置き、TypeScriptのdomain操作からDrizzleを直接使う構成へ更新した。共通 `packages/storage` とRepository層を削除し、BRIEFの固定要件、ROADMAP、SKILLプロンプト、受入試験へ反映した。

migrationの配置はdomain別、適用の取りまとめはDB所有アプリ。`app.db` / `security.db` の実行境界とP0–P10の順序は維持する。Rust側はdomain packageのDrizzle生成SQLをbuild時に受け取り、securitydだけが実DBを開く。これは未実装の設計であり、SQL適用・履歴管理はP2/P3で検証する。

## 推奨する開始点

実装はP2の「Workspaceを追加するとWebに現れ、再起動後も残り、別Workspaceからは読めない」という一枚から。実tokenを使う前にP3の安全な縦切りを通す。

## 特に重要な判断

**ローカルSQLite＋ファイルを初版に採用する案。** Web画面を持つことと、実行環境/DBをクラウドへ置くことを分ける。

**型付きbrokerを先に、HTTPS MITMはP8で必ず実装する案。** brokerだけでOneCLI相当のGatewayが完成したとはしない。

**接続とGrantとApprovalを分ける。** Workspace別に接続を保存するだけでなく、Botごとの使用権限と操作ごとの承認を作る。

**Slack Bot/Userの認証を同一視しない。** 現行desktop PKCEではbot scopesを要求できないため、server OAuthの経路を初期から検証する。根拠はSOURCESを参照。

**SKILLは判断と実装を分けて使う。** wayfinderは判断地図、to-spec/to-ticketsが実装への橋渡し、implement/implement-specが実装。

## 作成・実行の範囲

作成したのはMarkdown計画である。アプリのコード、実行済み試験、インストール済みSKILL、GitHubに登録したissueは含まない。文書内のticketは候補であり、実際のtrackerに登録した識別子ではない。

参照内容は2026-10-15時点。現行仕様・SKILLが変更された場合はSOURCESと実際のインストール済み本文を確認して更新する。
