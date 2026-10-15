# 一次情報・参照版・未検証事項

確認日: **2026-10-15** / r2でDrizzle一次情報（S17–S19）を追加

URLは調査対象の一次情報。公開日が確認できないページは「公開日未確認」とし、確認日と区別する。GitHubの最終変更日も初回公開日ではない。Web docsは今後変更され得る。

この一式のマイルストーン、DB配置、Rust/Bunの担当、domain、テスト設計は**提案**であり、参照製品の実装をそのまま記述したものではない。

## NanoClaw / OneCLI

### S01 — NanoClaw README

- [固定コミットのREADME](https://github.com/nanocoai/nanoclaw/blob/f2934abaf2d89f5b95b19ac1809a0ddc1eda1f79/README.md)
- 参照コミット: `f2934abaf2d89f5b95b19ac1809a0ddc1eda1f79`。取得時のmain。
- 初回公開日: この調査では確認していない。
- 根拠にした点: ホストと隔離agent、セッション/記憶/スケジュール、Gateway provider境界、Claude Agent SDK利用。現在のREADMEではホストはNode、container側runnerはBunと説明される。
- 注意: READMEの安全性の表現を、この新規実装の保証として使わない。

### S02 — NanoClaw OneCLI導入SKILL

- [add-onecli/SKILL.md](https://github.com/nanocoai/nanoclaw/blob/f2934abaf2d89f5b95b19ac1809a0ddc1eda1f79/.claude/skills/add-onecli/SKILL.md)
- APIが返した最終変更日: **2026-10-05**。
- 根拠にした点: Gateway 1.42.0を対応対象とし、1.43以降のsecret-assignment API変更を理由に非対応とする説明。NanoClaw coreも承認workflowを担当する。

### S03 — バージョン固定の実体

- [add-onecli/versions.json](https://github.com/nanocoai/nanoclaw/blob/f2934abaf2d89f5b95b19ac1809a0ddc1eda1f79/.claude/skills/add-onecli/versions.json)
- APIが返した最終変更日: **2026-10-04**。
- `onecli-gateway: 1.42.0` / `onecli-cli: 2.2.5` / `onecli-sdk: 2.2.1`。
- 注意: rootのversions.jsonはこのGateway pinの場所ではない。製品世代・Gateway version・CLI version・SDK version・REST APIのv1を混同しない。

### S04 — sandbox側のGateway利用契約

- [onecli-gateway/instructions.md](https://github.com/nanocoai/nanoclaw/blob/f2934abaf2d89f5b95b19ac1809a0ddc1eda1f79/.claude/skills/add-onecli/payload/container/skills/onecli-gateway/instructions.md)
- APIが返した最終変更日: **2026-09-23**。
- 根拠にした点: 直接HTTPを呼びproxyで認証を注入する方式、未接続時の接続要求案内、agentへ実tokenを渡さない契約。
- [OneCLI現在のrepo](https://github.com/onecli/onecli) も確認したが、新しい製品世代と混同しない。取得時mainは `9319d08be0b1fe35be39bf899b528a8e43f93027`。
- **調査範囲の限界:** 旧Gateway 1.42.0の全sourceを監査して全機能を列挙したわけではない。P0で、固定版とNanoClaw adapterの操作単位を参照機能matrixへ落とす必要がある。

## mattpocock skills

参照コミット: **`49dd158d1076134a641b33efb035946536778336`**。GitHub上のコミット日時は **2026-10-09**。この版のplugin manifestは `mattpocock-skills` **1.3.1**。

### S05 — 導入・SKILL一覧

- [README](https://github.com/mattpocock/skills/blob/49dd158d1076134a641b33efb035946536778336/README.md)
- [Engineering index](https://github.com/mattpocock/skills/blob/49dd158d1076134a641b33efb035946536778336/skills/engineering/README.md)
- [Setup SKILL](https://github.com/mattpocock/skills/blob/49dd158d1076134a641b33efb035946536778336/skills/engineering/setup-matt-pocock-skills/SKILL.md)
- 根拠: plugin導入コマンド、plugin/standalone重複を避けること、tracker/domainのsetup、現行SKILL名。

### S06 — Wayfinder

- [wayfinder/SKILL.md](https://github.com/mattpocock/skills/blob/49dd158d1076134a641b33efb035946536778336/skills/engineering/wayfinder/SKILL.md)
- APIが返した最終変更日: **2026-10-07**。
- 根拠: 判断のmap、decision ticket、frontier、HITL/AFK、原則一セッション一判断、researchの例外。実装ticket一覧ではない。

### S07 — 仕様化と縦切りチケット

- [to-spec/SKILL.md](https://github.com/mattpocock/skills/blob/49dd158d1076134a641b33efb035946536778336/skills/engineering/to-spec/SKILL.md)
- [to-tickets/SKILL.md](https://github.com/mattpocock/skills/blob/49dd158d1076134a641b33efb035946536778336/skills/engineering/to-tickets/SKILL.md)
- to-ticketsのAPI上の最終変更日: **2026-10-06**。
- 根拠: 合意済み内容のspec化、テストseam、縦切りとblocker、粒度の人の確認、local Markdown trackerの出力形式。

### S08 — 判断を支えるSKILL

- [prototype/SKILL.md](https://github.com/mattpocock/skills/blob/49dd158d1076134a641b33efb035946536778336/skills/engineering/prototype/SKILL.md)
- [research/SKILL.md](https://github.com/mattpocock/skills/blob/49dd158d1076134a641b33efb035946536778336/skills/engineering/research/SKILL.md)
- [grill-with-docs/SKILL.md](https://github.com/mattpocock/skills/blob/49dd158d1076134a641b33efb035946536778336/skills/engineering/grill-with-docs/SKILL.md)
- 根拠: 捨てるprototype、一次情報research、grillingとdomain-modelingの組合せ。prototypeに本番品質やテスト基盤を要求しない。

### S09 — 実装・plugin名・namespace

- [implement/SKILL.md](https://github.com/mattpocock/skills/blob/49dd158d1076134a641b33efb035946536778336/skills/engineering/implement/SKILL.md)
- [implement-spec/SKILL.md](https://github.com/mattpocock/skills/blob/49dd158d1076134a641b33efb035946536778336/skills/engineering/implement-spec/SKILL.md)
- [plugin.json](https://github.com/mattpocock/skills/blob/49dd158d1076134a641b33efb035946536778336/.claude-plugin/plugin.json)
- [Claude Code plugin公式docs](https://code.claude.com/docs/en/plugins)
- implement-specのAPI上の最終変更日: **2026-09-24**。plugin manifest: **2026-10-04**。
- 根拠: TDD/reviewを伴う実装、integration branch/worktreeのgraph処理、manifest名に基づくnamespaced command。
- code-review/diagnosing-bugs/retroの用途説明はS05の現行README/一覧も参照した。ランブック内の製品固有の追加制約は本計画の提案であり、upstream SKILL標準そのものではない。

## Agent SDK / Runtime

以下のWeb docsの初回公開日はこの調査では確認していない。確認日は2026-10-15。

### S10 — SDK overview

- [Claude Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview)
- TypeScript統合、SDKの機能・認証の位置づけの確認。

### S11 — Secure deployment

- [Securely deploying AI agents](https://code.claude.com/docs/en/agent-sdk/secure-deployment)
- 権限gateとsandboxの区別、境界外proxy、資格情報注入、TLS終端、proxy変数の迂回、mountに秘密が混ざるリスク。
- 具体的なこの製品のgrant/approval/checklistは提案であり、公式に監査された構成ではない。

### S12 — Hosting

- [Hosting the Agent SDK](https://code.claude.com/docs/en/agent-sdk/hosting)
- CLI subprocess、永続ディレクトリ、native CLI同梱の説明。選定SDKをBun/compiled executableで動かす実験は未実施。

### S13 — Bun executable

- [Bun standalone executables](https://bun.com/docs/bundler/executables)
- compileされた実行物とruntime assetsの設計を確認する参照先。
- 「すべてのSDK subprocessが自動で単一binaryに収まる」という根拠にはしていない。

## Storage

### S14 — SQLite

- [Appropriate Uses For SQLite](https://www.sqlite.org/whentouse.html)
- ローカル/単一アプリサーバー用途を評価する根拠。今回のDB分割は独自の配置提案。

### S15 — D1

- [Cloudflare D1 docs](https://developers.cloudflare.com/d1/)
- マネージドDBとしての位置づけ。初版で不採用にする理由は配置と複雑性の判断であり、D1の性能不足を測定した結果ではない。

### S16 — R2

- [Cloudflare R2 docs](https://developers.cloudflare.com/r2/)
- オブジェクトストレージとしての位置づけ。DBと同じ選択肢として比較しない。

### S17 — Drizzle config

- [Drizzle Kit configuration file](https://orm.drizzle.team/docs/drizzle-config-file)
- 確認日: 2026-10-15。初回公開日: 未確認。
- schema入力、migration/snapshotのout、複数configを指定できる根拠。
- domainごとのtable所有、共有DBの適用順・履歴分離はこの製品の設計。configを分けただけで自動保証されるとはしていない。

### S18 — Drizzle generate / migrate

- [drizzle-kit generate](https://orm.drizzle.team/docs/drizzle-kit-generate)
- [drizzle-kit migrate](https://orm.drizzle.team/docs/drizzle-kit-migrate)
- 確認日: 2026-10-15。初回公開日: 未確認。
- schema/snapshot差分からSQLを生成し、SQLとDBの適用履歴からmigrationを実行する仕組みの参照。
- SQLiteの選定driver/versionで複数domain履歴を扱う方法、FK生成範囲、再実行、Bun配布は実機検証していない。設定名や履歴形式を版に依存しない保証として扱わない。

### S19 — Drizzle SQLと外部の適用手段

- [Migrations](https://orm.drizzle.team/docs/migrations)
- 確認日: 2026-10-15。初回公開日: 未確認。
- Drizzle生成SQLを外部ツールで適用する選択肢の根拠。
- Rust securitydへのSQL同梱、適用履歴、起動時互換性検査は独自の設計提案であり、公式のRust ORM対応を意味しない。Rustでの適用試験は未実施。

## Slack

以下のWeb docsは2026-10-15に確認。初回公開日は確認していない。

### S20 — OAuthとBot/User identity

- [Installing with OAuth](https://docs.slack.dev/authentication/installing-with-oauth/)
- [oauth.v2.access](https://docs.slack.dev/reference/methods/oauth.v2.access/)
- `scope`/`user_scope`、token応答の主体、外部teamをresponseで確認する必要性、server flowの説明。

### S21 — PKCEのdesktop制約

- [Using PKCE](https://docs.slack.dev/authentication/using-pkce/)
- **desktop redirectではbot scopesを要求できない**。custom URIとPKCE有効時のlocalhostの扱い、public client、設定変更・rotation上の注意。
- この制約のため、初版でBot/User両方に単純なdesktop PKCEだけを採用する案は推奨していない。

### S22 — token種別

- [Tokens](https://docs.slack.dev/authentication/tokens/)
- Bot/User/App-levelの区別。見た目のprefixだけを内部権限の正本にしない。

### S23 — rotation

- [Using token rotation](https://docs.slack.dev/authentication/using-token-rotation/)
- access/refresh更新と失効を設計するための参照。アプリでは固定期限の仮定ではなく応答metadataを用いる。

### S24 — Socket Mode

- [Using Socket Mode](https://docs.slack.dev/apis/events-api/using-socket-mode/)
- 公開HTTP受信endpointを不要にする受信方式、app-level token、接続と配布上の制約。
- OAuth callbackの公開要件とは別の話である点に注意。

## Google

以下のWeb docsは2026-10-15に確認。初回公開日は確認していない。

### S25 — Desktop OAuth

- [OAuth 2.0 for Mobile & Desktop Apps](https://developers.google.com/identity/protocols/oauth2/native-app)
- Desktop client、loopback、PKCE、revoke等。実際のclient登録と選定フローのlive試験は未実施。

### S26 — OAuth全体・token失効

- [Using OAuth 2.0 to Access Google APIs](https://developers.google.com/identity/protocols/oauth2)
- refresh tokenの失効条件、External/Testingでの期限の注意。

### S27 — Gmail scopes

- [Gmail API scopes](https://developers.google.com/workspace/gmail/api/auth/scopes)
- readonlyを含むscope分類、最小権限・利用形態確認の根拠。ユーザーの実際のOAuth審査要否を断定したものではない。

### S28 — Calendar scopes

- [Google Calendar API authorization](https://developers.google.com/workspace/calendar/api/auth)
- 読み取り/イベント操作のscope選択の参照。

## Security standards

### S29 — OAuth security BCP

- [RFC 9700 — Best Current Practice for OAuth 2.0 Security](https://www.rfc-editor.org/rfc/rfc9700.html)
- 発行: **2025-01**。
- OAuthのredirect/PKCE/token保護を検討する標準。provider固有の制約は各社docsと併用する。

## 未検証事項を明示する

この一式で実行したのは公開情報の調査とMarkdown作成であり、アプリのinstall/build/runtime試験はしていない。

特にP0で検証が必要なのは、選定SDK版のBun互換・compiled launcherとassets、macOS上のsandboxからsecuritydへの通信とegress遮断、Slack Bot/User双方の選定OAuth経路、Google client/scope/利用形態、旧OneCLI Gatewayの同等性matrix。r2追加: domain別Drizzle migrationの共有DBへの適用・履歴・依存順、securitydの生成SQL適用と実行時SQLの整合。

セキュリティチェックの列挙は実施済み試験でも完全性の保証でもない。実装時には公式仕様の更新と実際の失敗経路に合わせて更新する。
