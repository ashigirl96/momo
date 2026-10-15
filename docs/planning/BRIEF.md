# Product brief — Workspace分離型パーソナルBotプラットフォーム

作成日: 2026-10-15 / 改訂: r2（domain別Drizzle・Repository層なし） / 状態: **実装前の提案。未実装・未検証**

## 目的

NanoClawを参照しながら、新しいリポジトリでスクラッチ開発する。OneCLIを依存として導入せず、Vault、外部サービス認証、Gateway、規則、承認を自前の製品機能として実装する。暗号・TLS・OAuthの標準やライブラリ、OSの鍵保管、コンテナランタイムまで独自発明するという意味ではない。

利用者が示したGrok Bot風の操作、つまりBot追加、Botごとのグループチャット、Botから届く接続依頼をWeb UIで実現する。Grokの内部実装や画面の完全複製は要件としない。

## 固定するユーザー要件

1. 個人用、会社A用など、内部Workspaceを分けてBotと外部接続を管理できる。
2. Botごとの永続記憶があり、他Workspaceや別Botの記憶が暗黙に混ざらない。
3. Web UIからBotを追加し、そのBotを参加させた会話・グループチャットを作れる。
4. Botが「この接続が必要」と要求でき、人が接続先・アカウント・付与範囲を選べる。
5. Slack、Gmail、Google Calendarに接続できる。SlackはBot TokenとUser Tokenの両方に対応する。
6. 外部サービスの秘密情報をBotのプロンプト、実行環境、ファイル、ツール結果に渡さない。
7. OneCLI相当の資格情報注入Gatewayと規則・承認を作る。型付きツールだけで終わらせず、HTTPS CONNECT/TLS終端経路も完成範囲に入れる。
8. TypeScriptとRustを使い分ける。Claude Agent SDKの統合はTypeScript。Bun側とRust側を配布可能な実行物にする。
9. 構成は `apps/<app>`、`packages/<domain>`、`crates/<crate>` を基本とする。
10. DBを所有する各 `packages/<domain>` にDrizzle schema・migration・設定を置く。TypeScriptのdomain処理はDrizzleを直接使い、Repository interface/実装や共通CRUD抽象化を設けない。共通 `packages/storage` にschema・migrationを集約しない。

## 推奨する初期前提 — 変更可能な設計判断

- 初版はmacOS上で一人が使うlocal-firstアプリ。会社用Workspaceは別のデータ・権限境界であり、会社の人全員がログインするSaaSではない。
- Web UIはブラウザで開く。初期はlocalhostでbackendと同一originにする。「Web UI」と「クラウド実行基盤」は分けて考える。
- SQLite＋ローカルファイルを採用。domain別のコード配置と物理DB分割は別で、通常のdomainはbackend所有の `app.db` を共有する。D1/R2への同期・移行のためのRepository抽象化は先回りで作らない。
- migrationの配置・変更責任は各domain、適用の取りまとめはDB所有アプリとする。共通化が必要なのは接続・具体的なDrizzle DB/transaction型・適用順の配線だけであり、別の永続化層ではない。Rust側DBのDrizzle生成SQLの扱いはROADMAP 1.5に従う。
- Bun backendは制御・会話・ジョブ・Web API、Rust securitydは鍵・認可・承認の実行判断・OAuth token処理・外部HTTPを担当する。
- Agent SDKはホストbackend内ではなく隔離されたagent-runnerで動かす。最初のランタイム候補はDocker。macOSでの通信境界とパッケージングはP0で実測する。
- 初期のグループチャットは「自分＋主担当Bot」、次に同一Workspace内で複数Bot。複数の人間ユーザーを招待する権限管理は後続。
- 送信・更新は原則、人による一回承認から始める。安定後に明示的な継続規則を追加する。
- Slackアプリを自分で用意するBYO方式から始める。内部Botごとに専用Slackアプリを自動発行することは初版の必須条件ではない。

## 変えてはいけない安全上の不変条件

- 接続済みであることと、Botに使用権限があることは別。Grantがゼロなら拒否する。
- Workspace ID / Bot IDをLLMの引数だけから信用しない。信頼側が発行した実行identityから照合する。
- Slack Bot権限が不足してもUser Tokenへ自動的に切り替えない。
- Google/SlackのOAuth同意、Botへの権限付与、一回の操作承認、SDKのツール許可を区別する。
- 承認後に宛先・本文・実行主体・接続・Workspaceが変われば別リクエストとして再評価する。
- プロンプトの指示や `HTTPS_PROXY` の設定だけをセキュリティ境界にしない。
- 秘密を隠しても、許可済みAPIからデータを外へ送れる。持ち出し先・操作・対象も制御する。
- 実サービスの応答を失った書き込みを無条件で再送しない。結果不明を正直に扱う。
- テストを通していない分離・復旧・バイナリ配布を「実現済み」と記録しない。

## 初版の完成シナリオ

個人用Workspaceで旅行Botを追加し、専用会話を開く。BotからGoogle接続依頼が届き、自分のアカウントを接続する。Calendarの読み取りだけを付与して予定を調べさせる。予定作成は別途承認する。

会社A用Workspaceでは仕事Botに会社のSlackを接続する。Slack Botとしての投稿と、自分のSlack Userとしての操作を明示的に選べる。個人用の会話・記憶・Google接続は利用できない。UIを閉じてもbackend上の処理は管理され、再起動後に会話・承認待ち・記憶を復元できる。

## 文書の使い方

このBRIEFは要件の入口。設計・順序は [ROADMAP.md](ROADMAP.md)、安全性の受入項目は [SECURITY-ACCEPTANCE.md](SECURITY-ACCEPTANCE.md)、調査根拠は [SOURCES.md](SOURCES.md)。変更判断は実際のtracker/ADRに記録し、この文書を追従させる。
