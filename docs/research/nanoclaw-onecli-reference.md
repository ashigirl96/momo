# NanoClaw と OneCLI Gateway 1.42.0 の参照機能一覧

確認日は 2026-10-15。ticket は [#2](https://github.com/ashigirl96/momo/issues/2)、map は [#1](https://github.com/ashigirl96/momo/issues/1)。下の「読んだ版」の source、docs、release note を読んだだけで、install、build、test の実行、signup、実 token の利用はしていない。

## 問い

NanoClaw `f2934ab` の core と、`.claude/skills/add-onecli/` の adapter が使う OneCLI Gateway 1.42.0（CLI 2.2.5 / SDK 2.2.1）は、それぞれ何をどの単位で提供しているか。「初版の同等性と対象外」([#12](https://github.com/ashigirl96/momo/issues/12)) で、行ごとに含める・後に回す・作らないを選べる粒度で並べる。

## 要点

1. NanoClaw core は資格情報の gateway を実装していない。core が持つのは provider の契約（seam）と、どの gateway でも同じ人間の承認フローで、OneCLI は `/add-onecli` skill が差し込む provider の 1 つにすぎない。provider が 1 つも登録されていなければ host は起動しない。
2. OneCLI adapter が実行時に呼ぶ OneCLI の操作は 4 つだけ。agent の作成（`ensureAgent`）、container 設定の取得（`getContainerConfig`）、承認待ちの long-poll と判定の送信（`ApprovalClient`）、`/v1/health` の 5 秒ごとの死活監視。secret の登録と CLI を使うのは setup と他の skill だけ。
3. 1.43 で消えた「agent の secret-assignment API」は `GET/PUT /v1/agents/:id/secrets`（CLI の `onecli agents secrets` と `onecli agents set-secrets`）。adapter 本体の `onecli.ts` はこれを呼ばない。使うのは `/add-onecli` の provider credential の手順（SKILL.md の文章）、`/add-vercel`、`/add-dial-tool` で、1.43 では policy v2 の allow rule に置き換わり、旧 route は 410 を返す。
4. OneCLI 1.42.0 の source は公開されている（Apache-2.0）。tag `v1.42.0` は commit `3912c74` を指し、NanoClaw の `gateway-compat/onecli-summary/upstream.json` も同じ commit を固定している。閉じているのは cloud edition 用の overlay（Redis の承認 store、KMS など）で、local に入る OSS build には含まれない。
5. 承認は二段に分かれる。OneCLI は policy rule（`allow` に `requireApproval` を付けたもの）に当たった要求を止めて long-poll に出す。NanoClaw core は承認者の解決、card、click の認可、期限、fail-closed を持つ。OneCLI 側の承認待ちは in-memory で、180 秒たつと自動で deny になる。
6. OneCLI に型付き操作はない。`HTTPS_PROXY` と MITM を使い、host と path の pattern ごとに資格情報を注入する汎用 transport である。型に近いものは承認 card 用の app 別の要約（Gmail、Google Calendar、GitHub など）だけで、NanoClaw はこの要約を OneCLI と一致させることを不変条件にしている。
7. 隔離の境界は Docker container。container は session ごとに 1 つ立ち、agent は container の中で `bypassPermissions` で動く。egress は既定で開いており、`NANOCLAW_EGRESS_LOCKDOWN=true` のときだけ gateway 以外への通信を塞ぐ。

## 読んだ版

| 対象 | repo | tag | commit | 備考 |
|---|---|---|---|---|
| NanoClaw | [nanocoai/nanoclaw](https://github.com/nanocoai/nanoclaw/tree/f2934abaf2d89f5b95b19ac1809a0ddc1eda1f79) | なし（取得時の main） | `f2934abaf2d89f5b95b19ac1809a0ddc1eda1f79` | 2026-10-15 の commit |
| OneCLI（gateway と Web API） | [onecli/onecli](https://github.com/onecli/onecli/tree/3912c74d7029505f0f5389745568111d643adc68) | `v1.42.0`（2026-07-23） | `3912c74d7029505f0f5389745568111d643adc68` | Rust の gateway と TypeScript の Web API が 1 つの image に入る |
| OneCLI（比較用） | onecli/onecli | `v1.43.0`（2026-07-25） | `4471c4636e7702568cbb14bf6d4b0025b67e046d` | secret-assignment の削除を確かめるためだけに読んだ |
| `@onecli-sh/sdk` | [onecli/node-sdk](https://github.com/onecli/node-sdk/tree/790eb9c74fe5eaff4ca849ab123d6d6757599291) | `v2.2.1`（2026-06-04） | `790eb9c74fe5eaff4ca849ab123d6d6757599291` | npm の tarball の route 文字列も tag の source と一致 |
| `onecli` CLI | [onecli/onecli-cli](https://github.com/onecli/onecli-cli/tree/33c558c3e8c92e15f6798391dff95d3cf309328d) | `v2.2.5`（2026-06-10） | `33c558c3e8c92e15f6798391dff95d3cf309328d` | Go |

版の固定は NanoClaw の [`.claude/skills/add-onecli/versions.json`](https://github.com/nanocoai/nanoclaw/blob/f2934abaf2d89f5b95b19ac1809a0ddc1eda1f79/.claude/skills/add-onecli/versions.json) にある（`"onecli-gateway": "1.42.0"`, `"onecli-cli": "2.2.5"`, `"onecli-sdk": "2.2.1"`）。

1.42.0 の image と source の対応は次で確かめた。

- [`gateway-compat/onecli-summary/upstream.json`](https://github.com/nanocoai/nanoclaw/blob/f2934abaf2d89f5b95b19ac1809a0ddc1eda1f79/gateway-compat/onecli-summary/upstream.json) に `"version": "1.42.0", "commit": "3912c74d7029505f0f5389745568111d643adc68"` とある。
- `ghcr.io/onecli/onecli:1.42.0` の OCI label `org.opencontainers.image.revision` が同じ commit を指す（registry の manifest を匿名で読んだ）。tag の push で動く [publish workflow](https://github.com/onecli/onecli/blob/3912c74d7029505f0f5389745568111d643adc68/.github/workflows/publish.yml#L1-L6) の [run](https://github.com/onecli/onecli/actions/runs/29992779484) もこの commit で成功している。
- [`docker/Dockerfile`](https://github.com/onecli/onecli/blob/3912c74d7029505f0f5389745568111d643adc68/docker/Dockerfile#L21-L25) は feature を付けずに `cargo build --release` する。edition は Cargo の feature で切り替わり、feature なしが OSS になる（[`apps/gateway/Cargo.toml`](https://github.com/onecli/onecli/blob/3912c74d7029505f0f5389745568111d643adc68/apps/gateway/Cargo.toml#L88-L99)）。
- cloud 用の部分は stub だけが公開されている。[`apps/gateway/src/ee/approval.rs`](https://github.com/onecli/onecli/blob/3912c74d7029505f0f5389745568111d643adc68/apps/gateway/src/ee/approval.rs#L1-L4) は "EE approval stub — replaced by the EE overlay." "The real implementation lives in the cloud repo." と書く。

## 1. NanoClaw core

「場所」は `f2934ab` の path。行 ID は #12 で含める・後に回す・作らないを書き込むための番号。「単位」はその機能がどの粒度で設定・分離・実行されるかを表す。

### 1.1 host の routing と権限

| ID | 機能 | 場所 | 単位 | 備考 |
|---|---|---|---|---|
| NC-01 | agent group、messaging group、wiring の entity model | [`src/db/schema.ts` L8-63](https://github.com/nanocoai/nanoclaw/blob/f2934abaf2d89f5b95b19ac1809a0ddc1eda1f79/src/db/schema.ts#L8-L63) | agent group / chat × adapter instance / その組 | agent group が workspace、記憶、CLAUDE.md、container 設定を持つ。wiring は `engage_mode`（pattern、mention、mention-sticky）、`engage_pattern`、`sender_scope`（all、known）、`session_mode`（shared、per-thread、agent-shared）、`priority` を持つ。`priority` は fan-out の順序だけで、engage した wiring はすべて受け取る |
| NC-02 | user、role、member | [`src/db/schema.ts` L65-109](https://github.com/nanocoai/nanoclaw/blob/f2934abaf2d89f5b95b19ac1809a0ddc1eda1f79/src/db/schema.ts#L65-L109)、[`src/modules/permissions/access.ts` L21-28](https://github.com/nanocoai/nanoclaw/blob/f2934abaf2d89f5b95b19ac1809a0ddc1eda1f79/src/modules/permissions/access.ts#L21-L28) | user | user id は `<channel>:<handle>` で、channel をまたぐ同一人物の紐付けはない。owner は常に global、admin は global か agent group 単位。権限は agent group ではなく user が持つ |
| NC-03 | inbound の routing | [`src/router.ts` L215-455](https://github.com/nanocoai/nanoclaw/blob/f2934abaf2d89f5b95b19ac1809a0ddc1eda1f79/src/router.ts#L215-L455) | inbound event | interceptor → messaging group の解決（mention か DM のときだけ自動作成）→ 未 wiring なら channel 登録の承認 card → wiring ごとに thread policy、engage 判定、access gate、sender scope → inbound.db に書いて起こすか、溜めるか、捨てる |
| NC-04 | 管理 command の gate | [`src/command-gate.ts` L17-49](https://github.com/nanocoai/nanoclaw/blob/f2934abaf2d89f5b95b19ac1809a0ddc1eda1f79/src/command-gate.ts#L17-L49) | message × agent group | `/clear` などは `user_roles` を直接見て判定する。未知の slash command は素通り |
| NC-05 | 未知の送信者と未登録 chat の承認 | `src/modules/permissions/`（[`channel-approval.ts`](https://github.com/nanocoai/nanoclaw/blob/f2934abaf2d89f5b95b19ac1809a0ddc1eda1f79/src/modules/permissions/channel-approval.ts)、`sender-approval.ts`） | messaging group（× 送信者） | `unknown_sender_policy` は strict、request_approval、decline_notify、public。承認した送信者は member になり、保留した message が再生される。deny list はない |
| NC-06 | 捨てた message の記録 | [`src/db/dropped-messages.ts`](https://github.com/nanocoai/nanoclaw/blob/f2934abaf2d89f5b95b19ac1809a0ddc1eda1f79/src/db/dropped-messages.ts) | channel × platform id | 件数と初回・最終の時刻を集計し、`ncl dropped-messages list` で読む |
| NC-07 | 3 段階の隔離 | [`docs/isolation-model.md`](https://github.com/nanocoai/nanoclaw/blob/f2934abaf2d89f5b95b19ac1809a0ddc1eda1f79/docs/isolation-model.md) | 設計 | agent-shared は複数の chat で 1 session、shared と per-thread は folder を共有して session を分ける、別 agent group は何も共有しない |

### 1.2 session

| ID | 機能 | 場所 | 単位 | 備考 |
|---|---|---|---|---|
| NC-10 | session の解決 | [`src/session-manager.ts` L85-160](https://github.com/nanocoai/nanoclaw/blob/f2934abaf2d89f5b95b19ac1809a0ddc1eda1f79/src/session-manager.ts#L85-L160) | agent group × messaging group × thread | schedule の task は `system:tasks:<series>` の別 session で動く |
| NC-11 | 2 つの SQLite による mailbox | [`src/mailbox/sqlite/schema.ts`](https://github.com/nanocoai/nanoclaw/blob/f2934abaf2d89f5b95b19ac1809a0ddc1eda1f79/src/mailbox/sqlite/schema.ts) | session | inbound.db は host だけが、outbound.db は container だけが書く。host と container の間の IO はこの 2 file だけ。seq は host が偶数、container が奇数。`journal_mode=DELETE` |
| NC-12 | heartbeat と host の sweep | [`src/host-sweep.ts`](https://github.com/nanocoai/nanoclaw/blob/f2934abaf2d89f5b95b19ac1809a0ddc1eda1f79/src/host-sweep.ts)、[`src/reconcile-session.ts` L128-201](https://github.com/nanocoai/nanoclaw/blob/f2934abaf2d89f5b95b19ac1809a0ddc1eda1f79/src/reconcile-session.ts#L128-L201) | install（60 秒周期） | `processing_ack` の同期、期日の来た message での起床、停止の検出（heartbeat 30 分）、再試行（最大 5 回）、繰り返し task の再設定 |
| NC-13 | 再起動と `on_wake` | [`src/container-restart.ts`](https://github.com/nanocoai/nanoclaw/blob/f2934abaf2d89f5b95b19ac1809a0ddc1eda1f79/src/container-restart.ts) | session | `on_wake` の行は新しい container の最初の poll にしか見えない |
| NC-14 | session の受け入れ停止と crash の遮断 | [`src/container-runner.ts` L140-252](https://github.com/nanocoai/nanoclaw/blob/f2934abaf2d89f5b95b19ac1809a0ddc1eda1f79/src/container-runner.ts#L140-L252)、[`src/circuit-breaker.ts`](https://github.com/nanocoai/nanoclaw/blob/f2934abaf2d89f5b95b19ac1809a0ddc1eda1f79/src/circuit-breaker.ts) | install | gateway を失うと新しい session を受け付けず、動いている container も止める。起動の失敗が続くと 1 時間の窓で段階的に待つ |
| NC-15 | 1 回の prompt にまとめる message 数 | `container/agent-runner/src/db/messages-in.ts` | agent group | `maxMessagesPerPrompt`、既定 10 |

### 1.3 承認と guard

| ID | 機能 | 場所 | 単位 | 備考 |
|---|---|---|---|---|
| NC-20 | 承認の primitive | [`src/modules/approvals/primitive.ts` L139-304](https://github.com/nanocoai/nanoclaw/blob/f2934abaf2d89f5b95b19ac1809a0ddc1eda1f79/src/modules/approvals/primitive.ts#L139-L304) | agent group / session | 承認者は scoped admin → global admin → owner の順。同じ channel の DM を優先する。card は Approve、Reject、Reject with reason。送れなければ行を消して agent に伝える |
| NC-21 | click の認可と確定 | [`src/modules/approvals/response-handler.ts` L127-144](https://github.com/nanocoai/nanoclaw/blob/f2934abaf2d89f5b95b19ac1809a0ddc1eda1f79/src/modules/approvals/response-handler.ts#L127-L144) | 承認の行 | 承認者を名指しした行はその user だけが確定できる。approve は compare-and-set。却下理由は 280 文字、入力待ちは 5 分 |
| NC-22 | `guard(action, input)` | [`src/guard/guard.ts`](https://github.com/nanocoai/nanoclaw/blob/f2934abaf2d89f5b95b19ac1809a0ddc1eda1f79/src/guard/guard.ts#L15-L20) | action | allow、hold、deny を返す。未知の action と例外は deny。承認済みの再実行は grant として hold だけを満たし、検査は再実行時にもう一度走る |
| NC-23 | 配送時の guard | [`src/delivery-guard.ts`](https://github.com/nanocoai/nanoclaw/blob/f2934abaf2d89f5b95b19ac1809a0ddc1eda1f79/src/delivery-guard.ts) | system action | guard なしで action を登録し直すと例外 |
| NC-24 | gateway の承認 coordinator | [`src/gateway-approval-coordinator.ts`](https://github.com/nanocoai/nanoclaw/blob/f2934abaf2d89f5b95b19ac1809a0ddc1eda1f79/src/gateway-approval-coordinator.ts#L87-L88) | install | action 名は `gateway_request`。既定の期限 120 秒、承認待ちの上限 32 件、provider が求める期限は 1 時間で頭打ち、60 秒ごとに期限切れを掃除。`runtimeIdentity`（`<slug>/<group>/<session>`）と生きた session を照合する。前の host が残した行は期限切れにして card を書き換える。購読が切れたら 1 → 60 秒の backoff で張り直す |
| NC-25 | card なしで通す読み取り | [`src/gateway-read-policy.ts`](https://github.com/nanocoai/nanoclaw/blob/f2934abaf2d89f5b95b19ac1809a0ddc1eda1f79/src/gateway-read-policy.ts) | install（.env） | `NANOCLAW_GATEWAY_READ_ONLY_HOSTS`（GET と HEAD だけ）と `NANOCLAW_GATEWAY_UNCREDENTIALED_READS`。どちらも既定で無効。`trigger: default` の hold にだけ効く |
| NC-26 | model の通信の自動承認 | [`docs/gateway-seam.md` L127-160](https://github.com/nanocoai/nanoclaw/blob/f2934abaf2d89f5b95b19ac1809a0ddc1eda1f79/docs/gateway-seam.md#L127-L160) | session の provider | provider が宣言した model の domain への `default` hold は自動で承認する。OneCLI の hold は常に `policy` なので対象外 |
| NC-27 | 承認 card の描画 | [`src/gateway-approval-summary.ts`](https://github.com/nanocoai/nanoclaw/blob/f2934abaf2d89f5b95b19ac1809a0ddc1eda1f79/src/gateway-approval-summary.ts)、`src/gateway-approval-presentation.ts` | request | agent、action、resource、reason、details を正規化して escape する。表示用で、認可には使わない |

承認で止まる操作は次のとおり（[`src/guard/`](https://github.com/nanocoai/nanoclaw/tree/f2934abaf2d89f5b95b19ac1809a0ddc1eda1f79/src/guard) と各 module の `guard.ts` から）。

- self-modification（`install_packages`、`add_mcp_server`）は常に止まる。
- agent から呼ぶ `ncl` の作成・更新・削除系はすべて止まる。mount の verb は承認があっても host 以外から実行できない。`tasks` の verb は止まらない。
- `create_agent` は呼び出し元の `cli_scope` が `global` でなければ止まる。
- agent 間の送信（`a2a.send`）は destination があれば通り、なければ deny。approver を名指しした policy の行があるときだけ止まる。
- gateway の要求は gateway が hold したときに止まる。

### 1.4 gateway seam

| ID | 機能 | 場所 | 単位 | 備考 |
|---|---|---|---|---|
| NC-30 | provider の契約 | [`src/gateway-providers/gateway-provider-registry.ts` L119-161](https://github.com/nanocoai/nanoclaw/blob/f2934abaf2d89f5b95b19ac1809a0ddc1eda1f79/src/gateway-providers/gateway-provider-registry.ts#L119-L161) | install | `kind`、`agentSkills`、`sessions.ensure / reapOrphans`、`approvals.subscribe / legacyActions / durable / listPending / decide / credentialScope`、`connections.connect`、`availability.publish / read` |
| NC-31 | provider の選択と起動拒否 | [`src/gateway-providers/index.ts` L15-43](https://github.com/nanocoai/nanoclaw/blob/f2934abaf2d89f5b95b19ac1809a0ddc1eda1f79/src/gateway-providers/index.ts#L15-L43) | install | `NANOCLAW_GATEWAY_PROVIDER` で 1 つ選ぶ。DB を開く前に解決する |
| NC-32 | session の lease | [`src/container-runner.ts` L557-596](https://github.com/nanocoai/nanoclaw/blob/f2934abaf2d89f5b95b19ac1809a0ddc1eda1f79/src/container-runner.ts#L557-L596) | session | `ensure` は作成と引き継ぎで冪等。contribution は `env`、`mounts`、`containers`、`labels`、`networkAccess` の型付きの値で、生の docker 引数は受け取らない。`onUnavailable` が来たら container を止める |
| NC-33 | 別 process での可用性の共有 | `src/gateway-availability.ts` | install | 承認を受ける process だけが health を書き、他は 1 秒ごとに読む。読めなければ使えないとみなす |
| NC-34 | account 接続への誘導 | `src/gateway-connections.ts`、[`docs/gateway-seam.md` L349-365](https://github.com/nanocoai/nanoclaw/blob/f2934abaf2d89f5b95b19ac1809a0ddc1eda1f79/docs/gateway-seam.md#L349-L365) | agent group | `ncl groups connect --host <hostname>` は読み取り専用で、gateway が返す `connect_url` か `unsupported` を渡すだけ。資格情報、grant、network rule は書けない |
| NC-35 | mount class `gateway-trust` | [`docs/gateway-seam.md` L273-283](https://github.com/nanocoai/nanoclaw/blob/f2934abaf2d89f5b95b19ac1809a0ddc1eda1f79/docs/gateway-seam.md#L273-L283)、`src/drivers/types.ts` | session | MITM 用の公開 CA だけを read-only で agent に mount できる。path を固定して秘密鍵の混入を防ぐ |
| NC-36 | model の資格情報の store | [`setup/gateways/credential-store.ts` L64-71](https://github.com/nanocoai/nanoclaw/blob/f2934abaf2d89f5b95b19ac1809a0ddc1eda1f79/setup/gateways/credential-store.ts#L64-L71) | install（setup 時） | `has`、`save`、`connection(target)` の `find / save / keep`、`modelEndpoint`。OAuth の profile は `chatgpt` だけ |
| NC-37 | gateway の catalog と install | `setup/gateways/catalog.ts`、`setup/gateways/install.ts` | install | `.claude/skills/*/gateway.json` で見つけ、default はちょうど 1 つ。OneCLI と Iron Proxy の 2 つがある |

### 1.5 schedule

| ID | 機能 | 場所 | 単位 | 備考 |
|---|---|---|---|---|
| NC-40 | task の保存 | [`src/mailbox/sqlite/tasks.ts`](https://github.com/nanocoai/nanoclaw/blob/f2934abaf2d89f5b95b19ac1809a0ddc1eda1f79/src/mailbox/sqlite/tasks.ts#L1-L12) | series | task は task session の inbound.db にある `kind='task'` の行で、scheduler 専用の table はない |
| NC-41 | `ncl tasks` | [`src/cli/resources/tasks.ts`](https://github.com/nanocoai/nanoclaw/blob/f2934abaf2d89f5b95b19ac1809a0ddc1eda1f79/src/cli/resources/tasks.ts) | agent group | list、get、create、update、cancel、pause、resume、delete、run、append-log。承認は不要で、agent が操作できるのは自分の agent group だけ |
| NC-42 | cron と一回実行と回数制限 | [`src/modules/scheduling/create.ts`](https://github.com/nanocoai/nanoclaw/blob/f2934abaf2d89f5b95b19ac1809a0ddc1eda1f79/src/modules/scheduling/create.ts#L9) | series | cron か `--process-after`。`MAX_DAILY_FIRES = 4` を超える頻度は script を付けるか明示の override が要る |
| NC-43 | timezone | `src/container-config.ts` | agent group | group の上書き → install の既定。container の `TZ` にも入る |
| NC-44 | 繰り返しと失敗時の扱い | `src/modules/scheduling/recurrence.ts` | series | 実行後に次回を積む。script の失敗は 2 → 60 分の backoff、8 回続くと自動で一時停止 |
| NC-45 | 実行前の script による起床判定 | `container/agent-runner/src/scheduling/task-script.ts` | 1 回の実行 | bash、30 秒、出力 1 MB。最後の行の `wakeAgent` で agent を起こすか決める。container の環境変数を引き継ぐ |
| NC-46 | 実行 log | `container/agent-runner/src/scheduling/run-log.ts` | series | `groups/<folder>/tasks/<series>.md` に追記 |

### 1.6 container の起動と隔離

| ID | 機能 | 場所 | 単位 | 備考 |
|---|---|---|---|---|
| NC-50 | session ごとの container | [`src/container-runner.ts` L329-501](https://github.com/nanocoai/nanoclaw/blob/f2934abaf2d89f5b95b19ac1809a0ddc1eda1f79/src/container-runner.ts#L329-L501)、[L552](https://github.com/nanocoai/nanoclaw/blob/f2934abaf2d89f5b95b19ac1809a0ddc1eda1f79/src/container-runner.ts#L552) | session | `activeContainers.set(sessionId, runtime)`。名前は `ncl-<slug>-<sessionId>`（[`src/drivers/docker-driver.ts` L695-700](https://github.com/nanocoai/nanoclaw/blob/f2934abaf2d89f5b95b19ac1809a0ddc1eda1f79/src/drivers/docker-driver.ts#L695-L700)）。root の CLAUDE.md は「per-agent-group」と書くが、code は session 単位 |
| NC-51 | runtime の driver | `src/drivers/` | install | `NANOCLAW_RUNTIME_DRIVER`、既定は docker |
| NC-52 | container の hardening | `src/drivers/docker-driver.ts`（`hardeningArgs`）、[`CHANGELOG.md` L166](https://github.com/nanocoai/nanoclaw/blob/f2934abaf2d89f5b95b19ac1809a0ddc1eda1f79/CHANGELOG.md#L166) | session | capability を全部外し、`no-new-privileges`、init、PID 上限 2048。CPU と memory は既定で無制限。agent の root fs は書き込める |
| NC-53 | mount | [`src/container-runner.ts` L1023-1234](https://github.com/nanocoai/nanoclaw/blob/f2934abaf2d89f5b95b19ac1809a0ddc1eda1f79/src/container-runner.ts#L1023-L1234) | session / agent group | session の dir（rw）、agent group の folder（rw）、Claude の状態 dir（rw、agent group 単位）、agent-runner の source と container skill（ro）、許可した追加 mount、gateway の mount |
| NC-54 | 追加 mount の allowlist | `src/modules/mount-security/` | install | repo の外の設定 file。file がなければ追加 mount はすべて拒否。`.ssh` などは既定で拒否 |
| NC-55 | container 設定 | [`src/db/container-configs.ts`](https://github.com/nanocoai/nanoclaw/blob/f2934abaf2d89f5b95b19ac1809a0ddc1eda1f79/src/db/container-configs.ts) | agent group | provider、model、image、skill、MCP server、apt と npm の package、追加 mount、`cli_scope`、timezone など |
| NC-56 | 環境変数 | [`src/container-runner.ts` L1286-1298](https://github.com/nanocoai/nanoclaw/blob/f2934abaf2d89f5b95b19ac1809a0ddc1eda1f79/src/container-runner.ts#L1286-L1298)、`src/drivers/types.ts` L512-587 | session | host の環境変数は渡さない。秘密に見える key や値は拒否する |
| NC-57 | egress の封鎖 | [`src/egress-lockdown.ts` L20-30](https://github.com/nanocoai/nanoclaw/blob/f2934abaf2d89f5b95b19ac1809a0ddc1eda1f79/src/egress-lockdown.ts#L20-L30)、[`src/config.ts` L106](https://github.com/nanocoai/nanoclaw/blob/f2934abaf2d89f5b95b19ac1809a0ddc1eda1f79/src/config.ts#L106) | install | 既定は無効。有効にすると agent を `--internal` の Docker network に置き、gateway の container だけをつなぐ。作れなければ起動を拒否する |
| NC-58 | image | `container/Dockerfile`、`container/build.sh` | install / agent group | `install_packages` を承認すると agent group 用の派生 image を作る |
| NC-59 | 孤児の引き継ぎと回収 | [`src/container-runner.ts` L792-916](https://github.com/nanocoai/nanoclaw/blob/f2934abaf2d89f5b95b19ac1809a0ddc1eda1f79/src/container-runner.ts#L792-L916) | install | `nanoclaw-role=gateway` の container には触れない |

### 1.7 channel と配送

| ID | 機能 | 場所 | 単位 | 備考 |
|---|---|---|---|---|
| NC-60 | channel adapter の interface | [`src/channels/adapter.ts` L209-308](https://github.com/nanocoai/nanoclaw/blob/f2934abaf2d89f5b95b19ac1809a0ddc1eda1f79/src/channels/adapter.ts#L209-L308) | adapter instance | 必須は setup、teardown、deliver など。typing、DM を開く、thread title などは任意 |
| NC-61 | registry と channel の既定値 | `src/channels/channel-registry.ts`、`src/channels/channel-defaults.ts` | install / adapter / wiring | 既定値は adapter の宣言と wiring 作成時の上書きの 2 段だけ |
| NC-62 | trunk に入っている channel | [`src/channels/index.ts`](https://github.com/nanocoai/nanoclaw/blob/f2934abaf2d89f5b95b19ac1809a0ddc1eda1f79/src/channels/index.ts) | install | trunk は local の CLI（Unix socket）だけ。Slack などは `channels` branch から `/add-<channel>` skill で入れる |
| NC-63 | Chat SDK bridge | `src/channels/chat-sdk-bridge.ts` | adapter | mention と DM の判定、card の action、添付の取得 |
| NC-64 | webhook server | [`src/webhook-server.ts` L188](https://github.com/nanocoai/nanoclaw/blob/f2934abaf2d89f5b95b19ac1809a0ddc1eda1f79/src/webhook-server.ts#L188) | install | `/webhook/<instance>`、`0.0.0.0` の 3000 番で待ち受ける |
| NC-65 | 配送 | [`src/delivery.ts`](https://github.com/nanocoai/nanoclaw/blob/f2934abaf2d89f5b95b19ac1809a0ddc1eda1f79/src/delivery.ts) | session | outbound.db を 1 秒（動作中）と 60 秒（sweep）で読む。3 回まで再試行。system 行は action registry へ、通常の行は destination の ACL を通して adapter へ |
| NC-66 | typing 表示 | `src/modules/typing/` | session | heartbeat が新しい間だけ出す |
| NC-67 | destination | `src/modules/agent-to-agent/`、`container/agent-runner/src/destinations.ts` | agent group | agent が送れる宛先の一覧。container 側の一覧は参考で、host が配送時に検査し直す |
| NC-68 | agent 間の送信と agent の作成 | `src/modules/agent-to-agent/` | agent group の組 | `create_agent` は双方向の destination を作り、子は provider を引き継ぐ |

### 1.8 記憶と会話履歴

| ID | 機能 | 場所 | 単位 | 備考 |
|---|---|---|---|---|
| NC-70 | file による記憶 | [`docs/memory.md` L3-6](https://github.com/nanocoai/nanoclaw/blob/f2934abaf2d89f5b95b19ac1809a0ddc1eda1f79/docs/memory.md#L3-L6) | agent group | `groups/<folder>/memory/` の Markdown。"There is no database and no embedding store." |
| NC-71 | Claude の自動記憶を切る | `src/migrate-claude-memory-settings.ts` | agent group | `autoMemoryEnabled:false` と PreCompact hook |
| NC-72 | 指示文の合成 | [`src/project-doc-compose.ts` L189-247](https://github.com/nanocoai/nanoclaw/blob/f2934abaf2d89f5b95b19ac1809a0ddc1eda1f79/src/project-doc-compose.ts#L189-L247) | agent group（起動ごとに作り直す） | persona、共通の指示、module、skill、MCP の指示を 1 file にまとめて read-only で mount する |
| NC-73 | 会話の継続と保存 | `container/agent-runner/src/providers/claude.ts` | session（継続）/ agent group（transcript） | SDK の resume。compact の前に transcript を Markdown で保存する |
| NC-74 | session をまたぐ文脈 | `src/modules/cross-session-context/` | messaging group | 同じ chat の他の session に短い写しを置く。`ncl sessions history` で過去を引く |
| NC-75 | 記憶の検索と要約 | なし | なし | core にはない。`add-mnemon` などの skill が担う |

### 1.9 container の中の agent-runner

| ID | 機能 | 場所 | 単位 | 備考 |
|---|---|---|---|---|
| NC-80 | poll loop | `container/agent-runner/src/poll-loop.ts` | session | 動作中 0.5 秒、待機中 1 秒で inbound.db を読む |
| NC-81 | agent の provider | `container/agent-runner/src/providers/types.ts` | container | trunk は Claude（Claude Agent SDK）だけ。他は `providers` branch から入れる |
| NC-82 | Claude の実行方針 | [`container/agent-runner/src/providers/claude-config.ts` L80-107](https://github.com/nanocoai/nanoclaw/blob/f2934abaf2d89f5b95b19ac1809a0ddc1eda1f79/container/agent-runner/src/providers/claude-config.ts#L80-L107) | container | `permissionMode: 'bypassPermissions'`。cron、AskUserQuestion などの組み込み tool は禁止 |
| NC-83 | agent に渡す MCP tool | `container/agent-runner/src/mcp-tools/` | session | `send_message`、`send_file`、`edit_message`、`add_reaction`、`ask_user_question`、`send_card`、`create_agent`、`install_packages`、`add_mcp_server`。schedule の tool はなく `ncl tasks` を使う |
| NC-84 | container skill | `container/skills/` | 全 session（ro） | agent-browser、frontend-engineer、self-customize、welcome と、選んだ gateway の skill |

### 1.10 管理 CLI `ncl` と UI

| ID | 機能 | 場所 | 単位 | 備考 |
|---|---|---|---|---|
| NC-90 | host からの `ncl` | `src/cli/socket-server.ts` | install | mode 0600 の Unix socket。socket に届いたこと自体を host の認証とみなす |
| NC-91 | container からの `ncl` | `container/agent-runner/src/cli/ncl.ts` | session | outbound.db に `cli_request` を書き、応答を待つ |
| NC-92 | `cli_scope` | [`src/cli/guard.ts` L49-119](https://github.com/nanocoai/nanoclaw/blob/f2934abaf2d89f5b95b19ac1809a0ddc1eda1f79/src/cli/guard.ts#L49-L119) | agent group | disabled、group（既定。自分の group の groups、sessions、destinations、members、tasks だけ）、global |
| NC-93 | `ncl` の resource | `src/cli/resources/` | なし | groups、messaging-groups、wirings、users、roles、members、destinations、policies、sessions、tasks、user-dms、dropped-messages、approvals、status |
| NC-94 | Web UI | なし | なし | trunk にはない。dashboard は skill（`add-dashboard` など） |

### 1.11 運用

| ID | 機能 | 場所 | 単位 | 備考 |
|---|---|---|---|---|
| NC-95 | setup wizard | `nanoclaw.sh`、`setup/auto.ts` | install | Node、pnpm、Docker、gateway、container image、最初の channel までを対話で進める |
| NC-96 | 常駐 service | `setup/service.ts` | install | macOS は launchd、Linux は systemd の user unit |
| NC-97 | 複数 copy の共存 | `src/install-slug.ts` | install | checkout の path から slug を作り、image、label、service、uninstall の範囲を分ける |
| NC-98 | 中央 DB の migration | `src/db/migrations/` | install | session の DB は版を持たない |
| NC-99 | uninstall、update、skill engine | `setup/uninstall/`、`/update-nanoclaw`、`scripts/skill-apply.ts` | install | skill の `nc:` directive を journal 付きで冪等に適用する |

## 2. NanoClaw の OneCLI adapter（`/add-onecli`）

場所の基準は [`.claude/skills/add-onecli/`](https://github.com/nanocoai/nanoclaw/tree/f2934abaf2d89f5b95b19ac1809a0ddc1eda1f79/.claude/skills/add-onecli)。`payload/` の file は install 時に `src/` と `container/` に複製される。

| ID | 機能 | 場所 | 単位 | 備考 |
|---|---|---|---|---|
| OA-01 | provider の登録 | [`payload/src/gateway-providers/onecli.ts` L233-256](https://github.com/nanocoai/nanoclaw/blob/f2934abaf2d89f5b95b19ac1809a0ddc1eda1f79/.claude/skills/add-onecli/payload/src/gateway-providers/onecli.ts#L233-L256) | install | `kind: 'onecli'`、`agentSkills: ['onecli-gateway']`、`legacyActions: ['onecli_credential']` |
| OA-02 | session ごとの agent と container 設定 | [`onecli.ts` L121-137](https://github.com/nanocoai/nanoclaw/blob/f2934abaf2d89f5b95b19ac1809a0ddc1eda1f79/.claude/skills/add-onecli/payload/src/gateway-providers/onecli.ts#L121-L137) | agent group（OneCLI の agent）、起動ごと | `ensureAgent({ name: groupName, identifier: agentGroupId })` の後に `getContainerConfig({ agent: agentGroupId })`。network は `host.docker.internal` 経由で `onecli` container に向ける |
| OA-03 | CA と credential stub の配置 | [`payload/src/gateway-providers/onecli-files.ts`](https://github.com/nanocoai/nanoclaw/blob/f2934abaf2d89f5b95b19ac1809a0ddc1eda1f79/.claude/skills/add-onecli/payload/src/gateway-providers/onecli-files.ts) | 内容の hash ごと | CA、system の CA と結合した bundle（`SSL_CERT_FILE`、`DENO_CERT`）、stub を `data/onecli/` に置いて 1 file ずつ ro で mount する。dir は 0700、stub は 0600 |
| OA-04 | model の endpoint | [`onecli.ts` L68-74](https://github.com/nanocoai/nanoclaw/blob/f2934abaf2d89f5b95b19ac1809a0ddc1eda1f79/.claude/skills/add-onecli/payload/src/gateway-providers/onecli.ts#L68-L74) | install | 独自の base URL があれば `ANTHROPIC_BASE_URL` と `ANTHROPIC_AUTH_TOKEN: 'gateway-managed'`（実 token ではない目印）を渡す |
| OA-05 | 死活監視 | [`onecli.ts` L81-119](https://github.com/nanocoai/nanoclaw/blob/f2934abaf2d89f5b95b19ac1809a0ddc1eda1f79/.claude/skills/add-onecli/payload/src/gateway-providers/onecli.ts#L81-L119) | install（生きた lease 全体で 1 つ） | 5 秒ごとに `GET /v1/health`。失敗したらすべての lease に通知し、core が session を止める |
| OA-06 | 承認の購読 | [`onecli.ts` L139-184](https://github.com/nanocoai/nanoclaw/blob/f2934abaf2d89f5b95b19ac1809a0ddc1eda1f79/.claude/skills/add-onecli/payload/src/gateway-providers/onecli.ts#L139-L184) | install | 他の install の要求には例外を投げて判定を出さない。購読開始より前の要求と変換の失敗は deny |
| OA-07 | 承認要求の変換 | [`onecli.ts` L186-231](https://github.com/nanocoai/nanoclaw/blob/f2934abaf2d89f5b95b19ac1809a0ddc1eda1f79/.claude/skills/add-onecli/payload/src/gateway-providers/onecli.ts#L186-L231) | request | `trigger: 'policy'`、宛先は host と method、agent group は `agent.externalId`、要約は OneCLI の `summary` を正規化。`bodyPreview` は渡さない |
| OA-08 | account 接続への誘導 | [`onecli.ts` L233-252](https://github.com/nanocoai/nanoclaw/blob/f2934abaf2d89f5b95b19ac1809a0ddc1eda1f79/.claude/skills/add-onecli/payload/src/gateway-providers/onecli.ts#L233-L252) | agent group | `ONECLI_CONSOLE_URL` があれば `operator_console` として返し、なければ `unsupported` |
| OA-09 | agent への指示 | [`payload/container/skills/onecli-gateway/SKILL.md`](https://github.com/nanocoai/nanoclaw/blob/f2934abaf2d89f5b95b19ac1809a0ddc1eda1f79/.claude/skills/add-onecli/payload/container/skills/onecli-gateway/SKILL.md) | 全 session | 本物の API URL を直接呼ぶ。401、403、`app_not_connected` では `connect_url` を user に見せる。policy の 403 は回避しない。stub の値は `"onecli-managed"` |
| OA-10 | gateway と CLI の install | [`scripts/setup.ts`](https://github.com/nanocoai/nanoclaw/blob/f2934abaf2d89f5b95b19ac1809a0ddc1eda1f79/.claude/skills/add-onecli/scripts/setup.ts) | install | 公式 installer を `ONECLI_VERSION` 付きで実行、CLI は release を直接取得、既存の gateway は版を確かめずに再利用、remote の gateway にも対応、local の gateway は `NO_PROXY` に足す |
| OA-11 | Claude の資格情報の登録 | [`scripts/auth.ts`](https://github.com/nanocoai/nanoclaw/blob/f2934abaf2d89f5b95b19ac1809a0ddc1eda1f79/.claude/skills/add-onecli/scripts/auth.ts)、`scripts/register-claude-token.sh` | install | `onecli secrets create --type anthropic --host-pattern api.anthropic.com`。subscription は `claude setup-token` の出力を拾う。`.env` に残った古い key は vault に移して消す |
| OA-12 | model provider の資格情報 | [`scripts/provider-credentials.ts`](https://github.com/nanocoai/nanoclaw/blob/f2934abaf2d89f5b95b19ac1809a0ddc1eda1f79/.claude/skills/add-onecli/scripts/provider-credentials.ts)、`scripts/credential-store.ts` | install | `/v1/secrets` を直接 GET、POST、PATCH する。metadata の食い違いは拒否し、応答の中身は表示しない。Codex は CLI で file から登録 |
| OA-13 | secret の割り当て | [`SKILL.md` L49-56](https://github.com/nanocoai/nanoclaw/blob/f2934abaf2d89f5b95b19ac1809a0ddc1eda1f79/.claude/skills/add-onecli/SKILL.md#L49-L56) | OneCLI の agent | code ではなく文章の手順。`onecli agents secrets` で読んでから `onecli agents set-secrets` で書く |
| OA-14 | gateway の upgrade と rollback | [`payload/docs/onecli-upgrades.md`](https://github.com/nanocoai/nanoclaw/blob/f2934abaf2d89f5b95b19ac1809a0ddc1eda1f79/.claude/skills/add-onecli/payload/docs/onecli-upgrades.md) | install | 実行時の版の検査はない。手順は検出、upgrade、確認、rollback |
| OA-15 | 検出と削除 | `scripts/detect.ts`、`REMOVE.md` | install | `.env` の `ONECLI_URL` で検出。削除はこの install の agent group と同じ identifier の agent だけ |

## 3. NanoClaw が使う OneCLI Gateway 1.42.0 の機能

場所は OneCLI `v1.42.0`（`3912c74`）の path。1 つの image に Web API（10254 番、Hono、`/v1` と別名の `/api`）と Rust の gateway（10255 番）が入る（[`docker/Dockerfile` L113-116](https://github.com/onecli/onecli/blob/3912c74d7029505f0f5389745568111d643adc68/docker/Dockerfile#L113-L116)）。

| ID | 機能 | 場所 | 単位 | NanoClaw から | 備考 |
|---|---|---|---|---|---|
| GW-01 | API の認証 | [`packages/api/src/middleware/auth.ts`](https://github.com/onecli/onecli/blob/3912c74d7029505f0f5389745568111d643adc68/packages/api/src/middleware/auth.ts) | project | adapter、setup の script | `Authorization: Bearer <API key>` と `X-Project-Id` |
| GW-02 | health | [`packages/api/src/routes/health.ts` L6-11](https://github.com/onecli/onecli/blob/3912c74d7029505f0f5389745568111d643adc68/packages/api/src/routes/health.ts#L6-L11) | install | adapter の監視、setup、`/add-dial-tool` の版の確認 | `GET /v1/health` は `{status, version, timestamp}` |
| GW-03 | agent | [`packages/api/src/routes/agents.ts`](https://github.com/onecli/onecli/blob/3912c74d7029505f0f5389745568111d643adc68/packages/api/src/routes/agents.ts) | project の中の agent | SDK の `ensureAgent`、CLI の `agents list / delete` | `POST /v1/agents` は既存なら 409（SDK は `created: false` として扱う）。identifier は `^[a-z0-9][a-z0-9-]{0,49}$` |
| GW-04 | agent ごとの proxy token | [`packages/api/src/routes/container-config.ts` L111](https://github.com/onecli/onecli/blob/3912c74d7029505f0f5389745568111d643adc68/packages/api/src/routes/container-config.ts#L111)、[`apps/gateway/src/gateway.rs` L610](https://github.com/onecli/onecli/blob/3912c74d7029505f0f5389745568111d643adc68/apps/gateway/src/gateway.rs#L610) | agent | container の環境変数として | `` `http://x:${agent.accessToken}@${GATEWAY_BASE_URL}` `` を `HTTPS_PROXY` にする。gateway は `Proxy-Authorization` から agent を特定する。container は vendor token は持たないが、この proxy token は持つ |
| GW-05 | container 設定 | [`container-config.ts` L61-225](https://github.com/onecli/onecli/blob/3912c74d7029505f0f5389745568111d643adc68/packages/api/src/routes/container-config.ts#L61-L225) | agent | SDK の `getContainerConfig` | `env`（proxy、`NODE_EXTRA_CA_CERTS`、`NODE_USE_ENV_PROXY`、git の設定、model key の置き換え用の目印）、`caCertificate`、`caCertificateContainerPath`、`credentialStubs`（Codex だけ）。未登録の identifier は 404 `AGENT_NOT_FOUND` |
| GW-06 | CONNECT と TLS 終端 | [`apps/gateway/src/gateway.rs`](https://github.com/onecli/onecli/blob/3912c74d7029505f0f5389745568111d643adc68/apps/gateway/src/gateway.rs)、`gateway/mitm.rs`、[`ca.rs` L1-28](https://github.com/onecli/onecli/blob/3912c74d7029505f0f5389745568111d643adc68/apps/gateway/src/ca.rs#L1-L28) | install | adapter が CA を mount する | CA は ECDSA P-256 で 10 年、leaf は 24 時間 |
| GW-07 | secret の CRUD | [`packages/api/src/validations/secret.ts` L183-212](https://github.com/onecli/onecli/blob/3912c74d7029505f0f5389745568111d643adc68/packages/api/src/validations/secret.ts#L183-L212)、`routes/secrets.ts` | project | CLI の `secrets list / create`、`provider-credentials.ts` の直接 HTTP | `type: z.enum(["anthropic", "openai", "generic"])`。`valueSource` は inline と onepassword。`hostPattern`、`pathPattern`、`injectionConfig`（header、query param、path template、path の正規表現の 4 形） |
| GW-08 | 資格情報の注入 | `apps/gateway/src/secret_inject.rs` L16-110、`inject.rs`、`policy_engine/inject_select.rs` | request | 暗黙（proxy を通る通信すべて） | anthropic は `sk-ant-oat` なら `Authorization: Bearer`、それ以外は `x-api-key`。openai の OAuth は Bearer と `chatgpt-account-id`。generic は `injectionConfig` に従う |
| GW-09 | 保存時の暗号化 | `apps/gateway/src/crypto.rs` L1-7 | install | 使わない（gateway の内部） | AES-256-GCM。鍵は `SECRET_ENCRYPTION_KEY`、なければ volume の file。NanoClaw の upgrade 手順は「DB の dump だけでは secret を戻せない」と書く（[`onecli-upgrades.md` L58](https://github.com/nanocoai/nanoclaw/blob/f2934abaf2d89f5b95b19ac1809a0ddc1eda1f79/.claude/skills/add-onecli/payload/docs/onecli-upgrades.md#L58)） |
| GW-10 | secret mode と secret の割り当て | [`routes/agents.ts` L145-182](https://github.com/onecli/onecli/blob/3912c74d7029505f0f5389745568111d643adc68/packages/api/src/routes/agents.ts#L145-L182)、`services/agent-service.ts` L300-344 | agent | CLI の `agents secrets / set-secrets / set-secret-mode`（skill の手順だけ） | `PATCH /v1/agents/:id/secret-mode`（all、selective）、`GET/PUT /v1/agents/:id/secrets`。自動で作った agent は all（[NanoClaw `docs/v1-to-v2-changes.md` L83](https://github.com/nanocoai/nanoclaw/blob/f2934abaf2d89f5b95b19ac1809a0ddc1eda1f79/docs/v1-to-v2-changes.md#L83)）。1.43 で削除 |
| GW-11 | policy v2 | [`packages/api/src/validations/policy.ts` L58-113](https://github.com/onecli/onecli/blob/3912c74d7029505f0f5389745568111d643adc68/packages/api/src/validations/policy.ts#L58-L113)、`routes/policy.ts` L93-205 | project の rule（first-match） | `/add-dial-tool` の `dial-policy.ts` だけ | `action` は allow と block。`requireApproval` と `rateLimit`（minute、hour、day）は allow にだけ付く（"rate-limit and approval modifiers require action = allow"）。identity は最大 100、OSS が照合するのは agent だけ。target は app、connection、secret、network（host、path、method） |
| GW-12 | 承認待ち | [`apps/gateway/src/approval.rs` L1-23](https://github.com/onecli/onecli/blob/3912c74d7029505f0f5389745568111d643adc68/apps/gateway/src/approval.rs#L1-L23)、[`gateway.rs` L249-253](https://github.com/onecli/onecli/blob/3912c74d7029505f0f5389745568111d643adc68/apps/gateway/src/gateway.rs#L249-L253)、`gateway/forward.rs` L99 | request | SDK の `ApprovalClient` | 承認の rule に当たった要求を gateway が止める。`GET /v1/gateway-url` で gateway を見つけ、`GET /v1/approvals/pending?exclude=` を 30 秒の long-poll で読み、`POST /v1/approvals/{id}/decision` に approve か deny を送る。OSS は in-memory の `DashMap`、`APPROVAL_TIMEOUT_SECS: u64 = 180`、本文は先頭 16 KiB だけ見る |
| GW-13 | 承認 card 用の app 別要約 | `apps/gateway/src/summary.rs` L53-64、`summary/gmail.rs`、`summary/google_calendar.rs`、`summary/generic.rs`、`apps.rs` | request | `summary` を card に使う。Iron の adapter は同じ source を build して使う | `{action, details:[{label, value}]}`。NanoClaw は "Approval action descriptions, selected details, application coverage, and generic fallback must match the pinned OneCLI gateway."（[`docs/gateway-seam.md` L425-431](https://github.com/nanocoai/nanoclaw/blob/f2934abaf2d89f5b95b19ac1809a0ddc1eda1f79/docs/gateway-seam.md#L425-L431)） |
| GW-14 | 未接続と policy の error | `apps/gateway/src/gateway/response.rs` L140-143 | request | container skill が agent に扱いを教える | `app_not_connected` は `connect_url` を持つ。policy の拒否は JSON の 403 |

### 3.1 1.42.0 にあるが NanoClaw の adapter が使わない機能

| ID | 機能 | 場所 | 備考 |
|---|---|---|---|
| GX-01 | OAuth app の接続 | `packages/api/src/apps/`、`/v1/connections`、`/v1/apps` | 約 40 の provider。`app_not_connected` の `connect_url` の行き先。NanoClaw は誘導だけをする |
| GX-02 | 外部 vault | `apps/gateway/src/vault/`、`/v1/vault/{provider}/pair`、`/v1/vaults` | 1Password と Bitwarden |
| GX-03 | dashboard | `apps/web` | Next.js の管理画面 |
| GX-04 | 通信 log と監査 | `apps/gateway/src/telemetry.rs`（`request_logs`） | |
| GX-05 | agent の token 再発行と既定 agent | `routes/agents.ts` | `regenerate-token`、`set-default` |
| GX-06 | その他の API | `/v1/migrate/export`、`/v1/skill/gateway`、`/v1/counts`、`/v1/user` | CLI の `auth login` は `/v1/user` を呼ぶ |
| GX-07 | cloud edition | 非公開の overlay | Redis の承認 store、KMS、budget、組織の policy engine など。local の OSS build には入らない |

### 3.2 SDK 2.2.1 と CLI 2.2.5 の呼び出しと route の対応

| NanoClaw の呼び出し | 使う場所 | HTTP |
|---|---|---|
| SDK `ensureAgent` | `onecli.ts` | `POST /v1/agents`（409 は既存とみなす）。[`src/agents/index.ts` L83-100](https://github.com/onecli/node-sdk/blob/790eb9c74fe5eaff4ca849ab123d6d6757599291/src/agents/index.ts#L83-L100) |
| SDK `getContainerConfig` | `onecli.ts` | `GET /v1/container-config?agent=`。[`src/container/index.ts` L79-80](https://github.com/onecli/node-sdk/blob/790eb9c74fe5eaff4ca849ab123d6d6757599291/src/container/index.ts#L79-L80) |
| SDK `ApprovalClient.start / stop` | `onecli.ts` | `GET /v1/gateway-url` → `GET {gateway}/v1/approvals/pending?exclude=`（35 秒で timeout）→ `POST {gateway}/v1/approvals/{id}/decision`。失敗時は 5 秒後に再試行。[`src/approvals/index.ts`](https://github.com/onecli/node-sdk/blob/790eb9c74fe5eaff4ca849ab123d6d6757599291/src/approvals/index.ts) |
| `fetch` | `onecli.ts`、`scripts/setup.ts` | `GET /v1/health`、`GET /api/health` |
| `fetch` | `scripts/provider-credentials.ts` | `GET/POST /v1/secrets`、`PATCH /v1/secrets/:id` |
| `fetch` | `/add-dial-tool` の `dial-policy.ts` | `/v1/agents`、`/v1/secrets`、`/v1/policy/rules`、`/v1/policy/rules/order`、`/v1/policy/default`、`/v1/policy/publish` |
| CLI `version` | `scripts/setup.ts` | `GET /v1/health` |
| CLI `config get/set api-host` | `scripts/setup.ts` | なし（local の設定 file） |
| CLI `auth login --api-key` | `scripts/setup.ts`（remote） | `GET /v1/user` |
| CLI `secrets list / create` | `scripts/auth.ts`、`scripts/credential-store.ts`、`register-claude-token.sh` | `GET/POST /v1/secrets` |
| CLI `agents list / delete` | `REMOVE.md` | `GET /v1/agents`、`DELETE /v1/agents/:id` |
| CLI `agents secrets / set-secrets` | `SKILL.md` の文章、`/add-vercel`、`/add-dial-tool` | `GET/PUT /v1/agents/:id/secrets`。`set-secrets` は続けて secret mode を selective にする（[`cmd/onecli/agents.go` L204-235](https://github.com/onecli/onecli-cli/blob/33c558c3e8c92e15f6798391dff95d3cf309328d/cmd/onecli/agents.go#L204-L235)） |
| CLI `agents set-secret-mode` | `/debug` skill | `PATCH /v1/agents/:id/secret-mode` |

SDK 2.2.1 の `ApprovalRequest` 型は `summary` を持たないので、adapter は `request as ApprovalRequest & { summary?: ApprovalSummary }` と cast している（[`onecli.ts` L196](https://github.com/nanocoai/nanoclaw/blob/f2934abaf2d89f5b95b19ac1809a0ddc1eda1f79/.claude/skills/add-onecli/payload/src/gateway-providers/onecli.ts#L196)）。

## 4. 1.42.0 から 1.43.0 で変わったこと

- 1.42.0 の release note は "unified first-match policy engine with automatic migration (#436)"（[v1.42.0](https://github.com/onecli/onecli/releases/tag/v1.42.0)）。policy v2 はこの版で入った。`/add-dial-tool` が 1.42 未満を拒むのはこのため。
- 1.43.0 の release note は "drop the legacy policy model, convert to v2 rules on boot (#448)"（[v1.43.0](https://github.com/onecli/onecli/releases/tag/v1.43.0)）。
- [PR #448](https://github.com/onecli/onecli/pull/448) は "Per-agent credential grants, per-connection agent access, the app blocklist and the org `policyMode` toggle are gone as separate concepts — they are all expressible as v2 rules." と書き、それらの route は "now answer **410 Gone** with a pointer to `/v1/policy`" になる。同じ PR は `Agent.secretMode` を "live, not legacy" とする。
- 1.43.0 の [`packages/api/src/routes/removed-routes.ts` L88-93](https://github.com/onecli/onecli/blob/4471c4636e7702568cbb14bf6d4b0025b67e046d/packages/api/src/routes/removed-routes.ts#L88-L93) は "/v1/agents/:agentId/secrets was removed: grant a secret with an allow rule naming the agent and targeting the secret." を返す。
- NanoClaw 側の記述は [`SKILL.md` L43](https://github.com/nanocoai/nanoclaw/blob/f2934abaf2d89f5b95b19ac1809a0ddc1eda1f79/.claude/skills/add-onecli/SKILL.md#L43) の "OneCLI 1.43 and later remove the agent secret-assignment API used below, so 1.43+ is not supported for now." と、[`onecli-upgrades.md` L7](https://github.com/nanocoai/nanoclaw/blob/f2934abaf2d89f5b95b19ac1809a0ddc1eda1f79/.claude/skills/add-onecli/payload/docs/onecli-upgrades.md#L7) の "(`onecli agents set-secrets`)"。1.45.0 から 1.42.0 へ戻すと起動時に DB の error が出たことも同じ文書の L66 に記録されている。

## 5. 確認した事実の引用

- NanoClaw core と承認: [`SKILL.md` L12](https://github.com/nanocoai/nanoclaw/blob/f2934abaf2d89f5b95b19ac1809a0ddc1eda1f79/.claude/skills/add-onecli/SKILL.md#L12) "NanoClaw core owns the approval workflow."
- gateway がないときの扱い: [`CLAUDE.md` L169](https://github.com/nanocoai/nanoclaw/blob/f2934abaf2d89f5b95b19ac1809a0ddc1eda1f79/CLAUDE.md#L169) "With none registered the host refuses to start — there is no implicit default and no open-egress fallback."。code は [`src/gateway-providers/index.ts` L22](https://github.com/nanocoai/nanoclaw/blob/f2934abaf2d89f5b95b19ac1809a0ddc1eda1f79/src/gateway-providers/index.ts#L22) の "No gateway provider is registered in this build"。
- provider と core の分担: [`docs/gateway-seam.md` L115-118](https://github.com/nanocoai/nanoclaw/blob/f2934abaf2d89f5b95b19ac1809a0ddc1eda1f79/docs/gateway-seam.md#L115-L118) "Approvals are a subscription, not a workflow." "It never talks to a channel, never touches `pending_approvals`, and never decides anything itself."、[L178](https://github.com/nanocoai/nanoclaw/blob/f2934abaf2d89f5b95b19ac1809a0ddc1eda1f79/docs/gateway-seam.md#L178) "No failure path approves."
- OneCLI の hold の種類: [`docs/gateway-seam.md` L159-160](https://github.com/nanocoai/nanoclaw/blob/f2934abaf2d89f5b95b19ac1809a0ddc1eda1f79/docs/gateway-seam.md#L159-L160) "OneCLI's native approval events are explicit policy holds; Iron's generic network holds are default holds."
- 他の install の承認に触れない: [`onecli.ts` L165-171](https://github.com/nanocoai/nanoclaw/blob/f2934abaf2d89f5b95b19ac1809a0ddc1eda1f79/.claude/skills/add-onecli/payload/src/gateway-providers/onecli.ts#L165-L171) "Throwing from the pinned SDK callback submits no decision and leaves the request pending."
- agent の identifier: [`onecli.ts` L122-123](https://github.com/nanocoai/nanoclaw/blob/f2934abaf2d89f5b95b19ac1809a0ddc1eda1f79/.claude/skills/add-onecli/payload/src/gateway-providers/onecli.ts#L122-L123) "The OneCLI agent identifier is always the agent group id"
- cache に頼らない: [`onecli-upgrades.md` L147-149](https://github.com/nanocoai/nanoclaw/blob/f2934abaf2d89f5b95b19ac1809a0ddc1eda1f79/.claude/skills/add-onecli/payload/docs/onecli-upgrades.md#L147-L149) "the provider never falls back to a cached credential configuration."
- 1.42.0 の既知の制約: [`references/chatgpt-oauth-refresh.md` L6-8](https://github.com/nanocoai/nanoclaw/blob/f2934abaf2d89f5b95b19ac1809a0ddc1eda1f79/.claude/skills/add-onecli/references/chatgpt-oauth-refresh.md#L6-L8) "NanoClaw's OneCLI 1.42.0 pin cannot refresh the ChatGPT OAuth credentials a provider imports"
- 隔離の境界: [`claude-config.ts` L81-83](https://github.com/nanocoai/nanoclaw/blob/f2934abaf2d89f5b95b19ac1809a0ddc1eda1f79/container/agent-runner/src/providers/claude-config.ts#L81-L83) "Claude runs unrestricted inside the container: NanoClaw's container isolation and the OneCLI allow-list are the security boundary"
- egress の封鎖: [`src/egress-lockdown.ts` L27](https://github.com/nanocoai/nanoclaw/blob/f2934abaf2d89f5b95b19ac1809a0ddc1eda1f79/src/egress-lockdown.ts#L27) "Refusing to spawn with open egress."。有効になるのは [`src/config.ts` L106](https://github.com/nanocoai/nanoclaw/blob/f2934abaf2d89f5b95b19ac1809a0ddc1eda1f79/src/config.ts#L106) で `NANOCLAW_EGRESS_LOCKDOWN` が `'true'` のときだけ。
- grant の再検査: [`src/guard/guard.ts` L15-20](https://github.com/nanocoai/nanoclaw/blob/f2934abaf2d89f5b95b19ac1809a0ddc1eda1f79/src/guard/guard.ts#L15-L20) "satisfies a hold — the human already decided — but NEVER a deny: the checks re-run live"
- mount の allowlist: [`src/cli/guard.ts` L55-57](https://github.com/nanocoai/nanoclaw/blob/f2934abaf2d89f5b95b19ac1809a0ddc1eda1f79/src/cli/guard.ts#L55-L57) "an agent must never alter it — not even with admin approval."
- 緩い既定: [`src/router.ts` L12-14](https://github.com/nanocoai/nanoclaw/blob/f2934abaf2d89f5b95b19ac1809a0ddc1eda1f79/src/router.ts#L12-L14) "Without the module, access is allow-all."、[L491](https://github.com/nanocoai/nanoclaw/blob/f2934abaf2d89f5b95b19ac1809a0ddc1eda1f79/src/router.ts#L491) "Bad regex: fail open so admin sees the agent responding + can fix."
- OneCLI の承認 store: [`approval.rs` L3-8](https://github.com/onecli/onecli/blob/3912c74d7029505f0f5389745568111d643adc68/apps/gateway/src/approval.rs#L3-L8) "When a request matches a `manual_approval` policy rule, the gateway holds the request" "OSS uses an in-memory `DashMap` backend"

## 6. 推測

- OneCLI の OSS は承認待ちを memory に置くので、gateway を再起動すると承認待ちは消える。`approval.rs` の記述からの推測で、動かしては確かめていない。
- 1.42.0 の `set-secrets` は `notifyPolicyCoherence` を通じて policy v2 の注入 rule に変換されてから効く（`services/agent-service.ts` L300-344 を読んだ範囲）。
- 1.43 以降でも adapter の実行時の経路（agent、container 設定、承認、health）は route が残っているので動き、壊れるのは secret の割り当ての手順だけだと読める。NanoClaw は 1.43 以降を対応外としていて、実際に動くかは確かめていない。
- agent ごとの proxy token に期限の項目は見当たらない。token の再発行の route はあるので、失効は手動の再発行で行うものと読める。
- NanoClaw が `/v1/secrets` の作成で送る `scope` と `metadata` は 1.42.0 の作成 schema にないので、zod が捨てる。`metadata.authMode` は server が値から作る（`secret-service.ts` の `buildMetadata`）。
- NanoClaw の module の承認（gateway 以外）は `expires_at` が NULL で、期限切れにならない。
- `ask_user_question` の回答には click の認可がない。

## 7. 確かめていないこと

- image の中身を source から build し直して比べてはいない。根拠は OCI label と workflow の run だけ。
- Slack や Google Chat の channel adapter は `channels` branch にあり、trunk の `f2934ab` には入っていないので読んでいない。webhook の署名検証もそちら。
- `/update-nanoclaw` の内部、container の同時起動数の上限（見つからなかった）、container から呼ぶ `ncl` の timeout。
- core が秘密に見える環境変数を拒む検査（NC-56）が、gateway の contribution の `HTTPS_PROXY` に入る proxy token をどう扱うか。
- OneCLI の `legacy-rule-write-gate.ts` の comment は OSS では無効と書くが、`policy-flags.ts` の code は有効にしている。code の方を採った。
- 何も実行していないので、表の挙動はすべて source を読んだ範囲のもの。

## 8. 後続の ticket への含意

- [#12](https://github.com/ashigirl96/momo/issues/12)（初版の同等性と対象外）は、この文書の NC、OA、GW、GX の行 ID ごとに判定できる。NanoClaw の Slack 対応と Google 連携は trunk ではなく skill と別 branch にあるので、同等性の基準に入れるなら別に読む必要がある。
- [#13](https://github.com/ashigirl96/momo/issues/13)（Operation と Approval）の参照点。OneCLI の承認は止めている 1 件の要求に対する判定で、digest を固定する仕組みはない。要求は止まったまま待つので、承認と送信の間で中身は変わらない。policy は first-match の allow と block に、承認と rate limit を修飾として足す形。NanoClaw core は request id を SHA-256 で束ね、grant を 1 回だけ使い、再実行時に検査し直す。
- [#15](https://github.com/ashigirl96/momo/issues/15)（sandbox の実行基盤と egress）の参照点。NanoClaw は既定で egress を開けていて、封鎖は opt-in の Docker internal network。
- [#17](https://github.com/ashigirl96/momo/issues/17)（model の資格情報）の参照点。model の key も gateway が注入し、container には目印の値だけを渡す。1.42.0 では ChatGPT の OAuth を自動で更新できない。
- map の「実行 identity の発行と受け渡し」の参照点。OneCLI は agent ごとの長命の proxy token を `HTTPS_PROXY` の userinfo で container に渡す。
