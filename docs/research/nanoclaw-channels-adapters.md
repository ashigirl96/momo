# NanoClaw の channels branch にある Slack と Google の adapter

確認日は 2026-10-15。ticket は [#23](https://github.com/ashigirl96/momo/issues/23)、map は [#1](https://github.com/ashigirl96/momo/issues/1)、形は「NanoClaw と OneCLI Gateway 1.42.0 の参照機能一覧」([#2](https://github.com/ashigirl96/momo/issues/2)) に合わせた。下の「読んだ版」の source、docs、commit、PR を GitHub の API と raw で読んだだけで、install、build、test の実行、signup、実 token の利用はしていない。

## 問い

NanoClaw の `channels` branch（`d2407fe`、2026-10-11）にある Slack と Google（Gmail、Calendar）の adapter は、何をどの単位で提供しているか。「初版の同等性と対象外」([#12](https://github.com/ashigirl96/momo/issues/12)) で、行ごとに含める・後の版に回す・作らないを選べる粒度で並べる。

## 要点

1. Slack は `/add-slack` skill が `channels` branch から user の clone に copy する Chat SDK の adapter（`@chat-adapter/slack` 4.29.0）。Bot token（`xoxb-`）だけで動き、User token は受信にも送信にも使わない。受信は `SLACK_APP_TOKEN`（`xapp-`、`connections:write`）があれば Socket Mode、なければ Events API の webhook（signing secret で検証）。token は host の `.env` に置き、OneCLI は通らない。
2. Gmail と Calendar の adapter は `channels` branch にない。branch にある Google のものは Google Chat の channel adapter だけ。Gmail の channel skill（`/add-gmail`）は 2026-04-21 に削除された。OneCLI 経由の MCP tool skill（`/add-gmail-tool`、`/add-gcal-tool`）も 2026-08-06 に PR #3172 で削除された。今残っている経路は、agent が Google の API を HTTP で直接呼び、OneCLI が OAuth app 接続の token を注入するものだけ。
3. Channel binding に当たるのは messaging group と wiring。messaging group の鍵は `(channel_type, platform_id, instance)` で、platform id は `slack:<channel id>`。Slack の team id は鍵に入らない。mention か DM が来たときだけ行を自動で作り、wiring がなければ owner に登録の承認 card を出す。
4. 自己会話ループは 3 段で止める。Chat SDK core が自分の発言を捨てる。`slack-a2a-guard` は他の bot の発言を既定ですべて捨てる。bot 同士の会話は `/slack-a2a-rooms` で許可した group DM だけで通し、人の発言を挟まない bot の発言は既定 6 回で止める。
5. 重複は Chat SDK が `dedupe:<adapter>:<message id>` を 5 分間 SQLite に記録して捨てる。Socket Mode の再送は ack してから捨てる。
6. 普通の返信に人の承認はない。起点の chat には常に送れ、他の chat には `agent_destinations` の行が要る。人の承認で止まるのは、agent や room の作成のように中央 DB と Slack の状態を変える操作で、`cli_scope` が `global` の agent group は止まらない。
7. Slack App の自動発行は既定の setup 経路に入っている。manager の user token（`xoxp-`）で `apps.manifest.create` と `apps.managedInstall` を呼ぶか、NanoClaw の運営する broker（`slack.nanoclaw.dev`）に頼む。発行する App は Socket Mode で、token rotation と interactivity が無効、user scope はない。
8. OneCLI 1.42.0 の Google 接続は authorization code と client secret を使い、OneCLI の API の `/v1/apps/<provider>/callback` に redirect する。`access_type=offline` と `prompt=consent` を付け、PKCE は使わない。client は利用者が入れるか env で渡す。scope は app 定義の固定値で、Gmail は `gmail.readonly`、`gmail.modify`、`gmail.send`、Calendar は `calendar.readonly` と `calendar.events`。送信や予定の作成が止まるのは OneCLI の policy rule に `requireApproval` を付けたときだけで、NanoClaw はその rule を作らない。

## 読んだ版

| 対象 | repo | 版 | commit | 備考 |
|---|---|---|---|---|
| NanoClaw `channels` | [nanocoai/nanoclaw](https://github.com/nanocoai/nanoclaw/tree/d2407fe3b4e30db69779567d945e72ee1b078028) | branch `channels` | `d2407fe3b4e30db69779567d945e72ee1b078028` | 2026-10-11 の PR #4071 の merge。2026-10-15 時点でも branch の先頭 |
| NanoClaw main（比較） | nanocoai/nanoclaw | #2 の基準 | `f2934abaf2d89f5b95b19ac1809a0ddc1eda1f79` | `add-slack` と `add-gchat` の SKILL.md は `channels` と同一 |
| NanoClaw（削除前） | nanocoai/nanoclaw | PR #3172 の親 | `358f1a8166134794f185a4410a767823aa035e0d` | `add-gmail-tool` と `add-gcal-tool` の最後の版 |
| Chat SDK | [vercel/chat](https://github.com/vercel/chat/tree/6581d31507b2184df29abe49f4bf94e805fc961f) | tag `chat@4.29.0`、`@chat-adapter/slack@4.29.0`、`@chat-adapter/gchat@4.29.0` | `6581d31507b2184df29abe49f4bf94e805fc961f` | NanoClaw の `package.json` が 4.29.0 に固定 |
| OneCLI | [onecli/onecli](https://github.com/onecli/onecli/tree/3912c74d7029505f0f5389745568111d643adc68) | `v1.42.0` | `3912c74d7029505f0f5389745568111d643adc68` | #2 と同じ |

### `channels` branch と main の関係

- 2026-10-15 の main（`ff7c0f1`）に対して `channels` は 229 commit 進み 7 commit 遅れている。merge base は `cab10bb`（2026-10-11）。#2 の基準 `f2934ab` に対しては 229 進み 5 遅れ。
- main は channel の共通部品（adapter の interface、registry、Chat SDK bridge、CLI channel）だけを持ち、Slack や Google Chat の adapter を持たない。`channels` は全 adapter を持つ registry branch で、main から前向きに merge され、main へは戻らない（[`docs/BRANCH-FORK-MAINTENANCE.md` L7-9、L22-31](https://github.com/nanocoai/nanoclaw/blob/d2407fe3b4e30db69779567d945e72ee1b078028/docs/BRANCH-FORK-MAINTENANCE.md#L7-L31)）。
- 利用者の clone に入るのは skill を通したときだけ。main にある `/add-slack` の `nc:copy from-branch:channels` が file を copy し、barrel に import を 1 行足し、依存を固定版で入れる（[`add-slack/SKILL.md` L27-72](https://github.com/nanocoai/nanoclaw/blob/d2407fe3b4e30db69779567d945e72ee1b078028/.claude/skills/add-slack/SKILL.md#L27-L72)）。merge ではなく copy なので、入れた後の更新は skill の再適用になる。
- `channels` の barrel（[`src/channels/index.ts`](https://github.com/nanocoai/nanoclaw/blob/d2407fe3b4e30db69779567d945e72ee1b078028/src/channels/index.ts#L1-L6)）は全 adapter を import した「動く branch」で、L54 に `// gmail (native, no Chat SDK)` という見出しだけが import なしで残っている。

## 1. Slack

「場所」は `d2407fe` の path、Chat SDK は `6581d31`。行 ID は #12 で含める・後の版に回す・作らないを書き込むための番号。

### 1.1 導入と資格情報

| ID | 機能 | 場所 | 単位 | 備考 |
|---|---|---|---|---|
| SL-01 | 導入 | [`add-slack/SKILL.md` L6-23、L27-84](https://github.com/nanocoai/nanoclaw/blob/d2407fe3b4e30db69779567d945e72ee1b078028/.claude/skills/add-slack/SKILL.md#L6-L84) | install | `channels` から 12 file を copy、barrel に `slack.js` と `slack-a2a-guard.js` を足し、`@chat-adapter/slack@4.29.0` を入れて build と test を通す。base は「1 つの bot で DM と channel の会話」 |
| SL-02 | Bot token | [`slack.ts` L175-177](https://github.com/nanocoai/nanoclaw/blob/d2407fe3b4e30db69779567d945e72ee1b078028/src/channels/slack.ts#L175-L177)、[`add-slack/SKILL.md` L104、L109、L123-137](https://github.com/nanocoai/nanoclaw/blob/d2407fe3b4e30db69779567d945e72ee1b078028/.claude/skills/add-slack/SKILL.md#L104-L137) | bot identity | `SLACK_BOT_TOKEN`（`xoxb-`）がなければ adapter を作らない。手順の bot scope は `chat:write`、`im:write`、`channels:history`、`groups:history`、`im:history`、`channels:read`、`groups:read`、`mpim:read`、`users:read`、`reactions:write`、`files:read`、`files:write`。取得は App の設定画面の Install to Workspace |
| SL-03 | User token | [`add-slack/SKILL.md` L207](https://github.com/nanocoai/nanoclaw/blob/d2407fe3b4e30db69779567d945e72ee1b078028/.claude/skills/add-slack/SKILL.md#L207)、[`slack-a2a-guard.ts` L21-27](https://github.com/nanocoai/nanoclaw/blob/d2407fe3b4e30db69779567d945e72ee1b078028/src/channels/slack-a2a-guard.ts#L21-L27) | なし | adapter は User token を使わない。`xoxp-` は貼り間違いの例としてだけ出る。人が別の App から自分の user token で送った message（`bot_id` 付き）は、DM に限って users.info で人と確かめて通す |
| SL-04 | 受信の方式 | [`slack.ts` L178-187](https://github.com/nanocoai/nanoclaw/blob/d2407fe3b4e30db69779567d945e72ee1b078028/src/channels/slack.ts#L178-L187)、[`add-slack/SKILL.md` L86-99](https://github.com/nanocoai/nanoclaw/blob/d2407fe3b4e30db69779567d945e72ee1b078028/.claude/skills/add-slack/SKILL.md#L86-L99) | bot identity | `SLACK_APP_TOKEN` があれば `mode: 'socket'`、なければ `'webhook'`。setup は `socket`（推奨、公開 URL 不要）、`webhook`、`provisioned`（自動発行、SP-02）の 3 つ |
| SL-05 | app-level token | [`add-slack/SKILL.md` L106-108](https://github.com/nanocoai/nanoclaw/blob/d2407fe3b4e30db69779567d945e72ee1b078028/.claude/skills/add-slack/SKILL.md#L106-L108) | Slack App | Basic Information → App-Level Tokens で `connections:write` を付けて手で作る。自動発行では manifest 作成の応答で受け取る |
| SL-06 | webhook の検証 | [Chat SDK `adapter-slack/src/index.ts` L1136-1163](https://github.com/vercel/chat/blob/6581d31507b2184df29abe49f4bf94e805fc961f/packages/adapter-slack/src/index.ts#L1136-L1163) | request | `x-slack-signature` と timestamp を signing secret で検証。Socket Mode では webhook を 405 で拒むが、`x-slack-socket-token` が app token と一致する転送は受ける（[L1101-1134](https://github.com/vercel/chat/blob/6581d31507b2184df29abe49f4bf94e805fc961f/packages/adapter-slack/src/index.ts#L1101-L1134)） |
| SL-07 | webhook の受け口 | [`chat-sdk-bridge.ts` L806-813](https://github.com/nanocoai/nanoclaw/blob/d2407fe3b4e30db69779567d945e72ee1b078028/src/channels/chat-sdk-bridge.ts#L806-L813)、[`webhook-server.ts` L188](https://github.com/nanocoai/nanoclaw/blob/d2407fe3b4e30db69779567d945e72ee1b078028/src/webhook-server.ts#L188) | install | `0.0.0.0` の 3000 番の `/webhook/<instance>`。webhook 方式では公開 HTTPS の URL（ngrok、Cloudflare Tunnel など）と、Interactivity にも同じ URL が要る（[`add-slack/SKILL.md` L152-159](https://github.com/nanocoai/nanoclaw/blob/d2407fe3b4e30db69779567d945e72ee1b078028/.claude/skills/add-slack/SKILL.md#L152-L159)） |
| SL-08 | 資格情報の置き場所 | [`add-slack/SKILL.md` L122-146](https://github.com/nanocoai/nanoclaw/blob/d2407fe3b4e30db69779567d945e72ee1b078028/.claude/skills/add-slack/SKILL.md#L122-L146)、[`slack-lib.ts` L12-14](https://github.com/nanocoai/nanoclaw/blob/d2407fe3b4e30db69779567d945e72ee1b078028/src/channels/slack-lib.ts#L12-L14) | install | host の `.env` に平文。OneCLI の vault は通らない。送信は host が行うので container は Slack の token を持たない。token は Authorization header にだけ載せ、log や error に入れない |
| SL-09 | owner の DM の解決 | [`add-slack/SKILL.md` L161-179](https://github.com/nanocoai/nanoclaw/blob/d2407fe3b4e30db69779567d945e72ee1b078028/.claude/skills/add-slack/SKILL.md#L161-L179) | install | 手で入れた member ID（`U…`）に `auth.test` と `conversations.open` を bot token で呼び、`slack:<D…>` を owner の wiring に使う |

### 1.2 受信と routing（Channel binding）

| ID | 機能 | 場所 | 単位 | 備考 |
|---|---|---|---|---|
| SL-10 | platform id と messaging group | [`src/db/schema.ts` L28-40](https://github.com/nanocoai/nanoclaw/blob/d2407fe3b4e30db69779567d945e72ee1b078028/src/db/schema.ts#L28-L40)、[`add-slack/SKILL.md` L195-203](https://github.com/nanocoai/nanoclaw/blob/d2407fe3b4e30db69779567d945e72ee1b078028/.claude/skills/add-slack/SKILL.md#L195-L203) | chat × instance | 鍵は `UNIQUE(channel_type, platform_id, instance)`。platform id は `slack:C…`（channel）、`slack:D…`（DM）、group DM は `G…` か `C…`。team id は鍵に入らない |
| SL-11 | wiring | [`src/db/schema.ts` L46-63](https://github.com/nanocoai/nanoclaw/blob/d2407fe3b4e30db69779567d945e72ee1b078028/src/db/schema.ts#L46-L63) | messaging group × agent group | `engage_mode`、`engage_pattern`、`sender_scope`、`ignored_message_policy`、`session_mode`、`threads`。#2 の NC-01 と同じ |
| SL-12 | 自動作成と登録の承認 | [`src/router.ts` L249-307](https://github.com/nanocoai/nanoclaw/blob/d2407fe3b4e30db69779567d945e72ee1b078028/src/router.ts#L249-L307) | inbound event | 未知の chat は mention か DM のときだけ行を作り、受けた instance を記録する。wiring がなければ捨てた記録を残して owner に登録の card を出す（#2 の NC-03、NC-05）。拒否した chat は `denied_at` で黙って捨てる |
| SL-13 | Slack の既定値 | [`slack.ts` L26-72](https://github.com/nanocoai/nanoclaw/blob/d2407fe3b4e30db69779567d945e72ee1b078028/src/channels/slack.ts#L26-L72) | channel の宣言（wiring 作成時に刻む） | DM は `engage_pattern: '.'`（全部に反応）、session は thread ごと、未知の送信者は `decline_notify`（断って owner に知らせるだけで card なし）。channel と group DM は `mention-sticky`、thread ごと、`request_approval` |
| SL-14 | dispatch | [`chat-sdk-bridge.ts` L586-651](https://github.com/nanocoai/nanoclaw/blob/d2407fe3b4e30db69779567d945e72ee1b078028/src/channels/chat-sdk-bridge.ts#L586-L651) | message | Chat SDK の 4 経路（購読中の thread、未購読の mention、DM、その他すべて）を host の router に渡すだけで、反応するかは router が決める。mention-sticky で反応した thread を購読する |
| SL-15 | 添付と貼り付けた表 | [`chat-sdk-bridge.ts` L485-553](https://github.com/nanocoai/nanoclaw/blob/d2407fe3b4e30db69779567d945e72ee1b078028/src/channels/chat-sdk-bridge.ts#L485-L553)、`src/channels/slack-raw-text.ts` | message | 添付は受信時に取得して base64 で inbound.db に入れる。Slack が attachment block で送る表を本文に戻す。`raw` は捨てる |
| SL-16 | 招待時の自動 wiring | [`slack-room-membership/membership.ts` L1-36](https://github.com/nanocoai/nanoclaw/blob/d2407fe3b4e30db69779567d945e72ee1b078028/src/modules/slack-room-membership/membership.ts#L1-L36) | channel | agents feature（SP-06）で入る。bot が未知の channel に入ると登録の card を出すが、owner がその room にいれば card なしで `public` と mention の wiring を作る。bot が外されたら `detached_at` を付けて送らない |

### 1.3 重複と自己会話ループ

| ID | 機能 | 場所 | 単位 | 備考 |
|---|---|---|---|---|
| SL-20 | 重複の排除 | [Chat SDK `chat.ts` L84、L2008-2022](https://github.com/vercel/chat/blob/6581d31507b2184df29abe49f4bf94e805fc961f/packages/chat/src/chat.ts#L2008-L2022)、[`state-sqlite.ts` L24-31](https://github.com/nanocoai/nanoclaw/blob/d2407fe3b4e30db69779567d945e72ee1b078028/src/state-sqlite.ts#L24-L31) | adapter × message id | `setIfNotExists('dedupe:<adapter>:<id>')` を 5 分の TTL で。`message` と `app_mention` の 2 経路で届く同じ発言を 1 回にする。NanoClaw は名前付き instance の state を名前空間で分け、同じ workspace の 2 つの bot が互いの発言を重複とみなさないようにしている |
| SL-21 | Socket Mode の再送 | [Chat SDK `adapter-slack/src/index.ts` L1762-1791](https://github.com/vercel/chat/blob/6581d31507b2184df29abe49f4bf94e805fc961f/packages/adapter-slack/src/index.ts#L1762-L1791) | envelope | `retry_num > 0` は ack して処理しない。webhook の再送 header は見ず、SL-20 に任せる |
| SL-22 | 自分の発言 | [Chat SDK `adapter-slack/src/index.ts` L4855-4873、L683-713](https://github.com/vercel/chat/blob/6581d31507b2184df29abe49f4bf94e805fc961f/packages/adapter-slack/src/index.ts#L4855-L4873)、[`chat.ts` L1998-2006](https://github.com/vercel/chat/blob/6581d31507b2184df29abe49f4bf94e805fc961f/packages/chat/src/chat.ts#L1998-L2006) | bot identity | 起動時の `auth.test` で得た bot user id か bot id に一致する発言を捨てる |
| SL-23 | 他の bot の発言 | [`slack-a2a-guard.ts` L1-39、L163-260](https://github.com/nanocoai/nanoclaw/blob/d2407fe3b4e30db69779567d945e72ee1b078028/src/channels/slack-a2a-guard.ts#L1-L39) | bridge instance | `bot_id` 付きの発言は router の手前で捨てる。例外を作れるのは admission policy 1 つだけで、policy が例外を投げたら捨てる。人の発言は policy から触れない |
| SL-24 | bot 同士の room | [`slack-a2a-rooms/SKILL.md` L21-38、L118-128、L158-173](https://github.com/nanocoai/nanoclaw/blob/d2407fe3b4e30db69779567d945e72ee1b078028/.claude/skills/slack-a2a-rooms/SKILL.md#L21-L38) | room × bot identity | `SLACK_A2A_ROOMS` に書いた group DM だけで bot の発言を `slack:bot:<bot_id>` として通す。人の発言なしに続く bot の発言は `SLACK_A2A_MAX_HOPS`（既定 6）まで、人が話すと戻る。bot は mention されたときだけ答えるので、mention をやめれば会話が止まる。通した bot も permissions の access gate を通る必要がある |

### 1.4 送信と承認

| ID | 機能 | 場所 | 単位 | 備考 |
|---|---|---|---|---|
| SL-30 | 送信先の制限 | [`src/delivery.ts` L429-490](https://github.com/nanocoai/nanoclaw/blob/d2407fe3b4e30db69779567d945e72ee1b078028/src/delivery.ts#L429-L490) | session → messaging group | session の起点の chat には常に送れる。他の chat は `agent_destinations` の行が要り、wiring を作ると自動で入る。人の承認はない。外された chat には送らず再試行に回す |
| SL-31 | 送信の形 | [`chat-sdk-bridge.ts` L818-995](https://github.com/nanocoai/nanoclaw/blob/d2407fe3b4e30db69779567d945e72ee1b078028/src/channels/chat-sdk-bridge.ts#L818-L995) | message | 本文、card、file、編集、reaction、typing、DM を開く。#2 の NC-65、NC-83 と同じ |
| SL-32 | 承認で止まる Slack の操作 | [`slack-agent-flow/.../guard.ts` L6-31](https://github.com/nanocoai/nanoclaw/blob/d2407fe3b4e30db69779567d945e72ee1b078028/.claude/skills/slack-agent-flow/src/modules/slack-agent-flow/guard.ts#L6-L31)、[`slack-agent-flow/SKILL.md` L235-241](https://github.com/nanocoai/nanoclaw/blob/d2407fe3b4e30db69779567d945e72ee1b078028/.claude/skills/slack-agent-flow/SKILL.md#L235-L241) | action | `create_room`、`add_to_room`、Slack 起点の `create_agent` は、`cli_scope` が `global` なら通り、それ以外は admin の承認で止まる。grant は承認した room 名か (room, agent) の組にだけ効く |

### 1.5 複数の bot と Slack App の自動発行

| ID | 機能 | 場所 | 単位 | 備考 |
|---|---|---|---|---|
| SP-01 | 複数の bot identity | [`slack.ts` L141-250](https://github.com/nanocoai/nanoclaw/blob/d2407fe3b4e30db69779567d945e72ee1b078028/src/channels/slack.ts#L141-L250)、[`slack-multi-instance/SKILL.md` L8-38](https://github.com/nanocoai/nanoclaw/blob/d2407fe3b4e30db69779567d945e72ee1b078028/.claude/skills/slack-multi-instance/SKILL.md#L8-L38) | instance | `SLACK_INSTANCES=<name>,…` の名前ごとに `slack-<name>` を登録し、`SLACK_BOT_TOKEN_<NAME>` などを読む。`channelType` は `slack` のままで、user id、書式、既定値を共有する |
| SP-02 | 自動発行（直接） | [`src/provisioning/slack-app.ts` L1-21、L230-268](https://github.com/nanocoai/nanoclaw/blob/d2407fe3b4e30db69779567d945e72ee1b078028/src/provisioning/slack-app.ts#L1-L21) | Slack App | manager の user token（`xoxp-`、`app_configurations:write` と `managed_apps:install`）で `apps.manifest.create`（`generate_app_token=true`）から `xapp-` を、`apps.managedInstall` から `xoxb-` を得る。workspace が App の承認制なら install URL に落ちる。manager token は container と session に入れない |
| SP-03 | 自動発行（broker） | [`slack-app.ts` L23-29、L446-465、L534-651](https://github.com/nanocoai/nanoclaw/blob/d2407fe3b4e30db69779567d945e72ee1b078028/src/provisioning/slack-app.ts#L534-L651) | install | registry の install token で `slack.nanoclaw.dev` を呼ぶ。manager の資格情報は broker の側にある。workspace は broker に OAuth で接続する。承認待ちの App の bot token は install 完了後の最初の読み出しで 1 回だけ返る |
| SP-04 | 発行する manifest | [`slack-app.ts` L50-181](https://github.com/nanocoai/nanoclaw/blob/d2407fe3b4e30db69779567d945e72ee1b078028/src/provisioning/slack-app.ts#L50-L181) | Slack App | bot scope 17（SL-02 に `app_mentions:read`、`mpim:write`、`mpim:history`、`canvases:read`、`canvases:write` を足したもの）、agent mode なら `assistant:write`。bot event 7（agent mode で +2）。`socket_mode_enabled: true`、`token_rotation_enabled: false`、`interactivity.is_enabled: false`、`org_deploy_enabled: false`。user scope はない |
| SP-05 | setup の既定 | [`setup/channels/slack-auto-register.ts` L1-48](https://github.com/nanocoai/nanoclaw/blob/d2407fe3b4e30db69779567d945e72ee1b078028/setup/channels/slack-auto-register.ts#L1-L48)、[`setup/channels/slack-auto.ts` L1-29](https://github.com/nanocoai/nanoclaw/blob/d2407fe3b4e30db69779567d945e72ee1b078028/setup/channels/slack-auto.ts#L1-L29) | install | Slack を選ぶと自動発行の前段を必ず通り、`/slack-a2a-rooms` と `/slack-agent-flow` も続けて当てる。手で作った App は flow の中の選択肢。`slack-app.ts` の冒頭は「`NANOCLAW_SLACK_AGENTS` で gate」と書くが、登録側の code は無条件 |
| SP-06 | agent から bot を作る | [`slack-agent-flow/SKILL.md` L6-20、L247-273](https://github.com/nanocoai/nanoclaw/blob/d2407fe3b4e30db69779567d945e72ee1b078028/.claude/skills/slack-agent-flow/SKILL.md#L6-L20) | agent group | `create_agent` で新しい App を発行し、token を `.env` に書き、再起動なしで adapter を起動し、operator との DM と 3 者の group DM を開いて wiring する。canvas、DM の onboarding、thread の題名付けも同じ feature で入る |

## 2. Google

### 2.1 `channels` にある Google Chat の adapter

| ID | 機能 | 場所 | 単位 | 備考 |
|---|---|---|---|---|
| GC-01 | 導入 | [`add-gchat/SKILL.md` L17-63](https://github.com/nanocoai/nanoclaw/blob/d2407fe3b4e30db69779567d945e72ee1b078028/.claude/skills/add-gchat/SKILL.md#L17-L63) | install | `gchat.ts` と test を copy、barrel に 1 行、`@chat-adapter/gchat@4.29.0` |
| GC-02 | 資格情報 | [`gchat.ts` L22-37](https://github.com/nanocoai/nanoclaw/blob/d2407fe3b4e30db69779567d945e72ee1b078028/src/channels/gchat.ts#L22-L37)、[`add-gchat/SKILL.md` L65-96](https://github.com/nanocoai/nanoclaw/blob/d2407fe3b4e30db69779567d945e72ee1b078028/.claude/skills/add-gchat/SKILL.md#L65-L96) | install | Cloud project で Chat API を有効にし、service account の JSON key を 1 行にして `.env` の `GCHAT_CREDENTIALS` に置く。OAuth の同意画面も user の token もない |
| GC-03 | 受信 | [`add-gchat/SKILL.md` L97-103](https://github.com/nanocoai/nanoclaw/blob/d2407fe3b4e30db69779567d945e72ee1b078028/.claude/skills/add-gchat/SKILL.md#L97-L103) | install | Chat API の HTTP endpoint URL に公開 HTTPS の `/webhook/gchat` を設定する |
| GC-04 | scope | [Chat SDK `adapter-gchat/src/index.ts` L277-293](https://github.com/vercel/chat/blob/6581d31507b2184df29abe49f4bf94e805fc961f/packages/adapter-gchat/src/index.ts#L277-L293) | service account | `chat.bot`、`chat.messages.readonly`、`chat.messages.reactions.create`、`chat.messages.reactions`、`chat.spaces.create`。user の偽装は env で指定したときだけ |
| GC-05 | webhook の署名検証 | [Chat SDK `adapter-gchat/src/index.ts` L257-272](https://github.com/vercel/chat/blob/6581d31507b2184df29abe49f4bf94e805fc961f/packages/adapter-gchat/src/index.ts#L257-L272) | adapter | project number か Pub/Sub の audience がなければ adapter の生成で例外にする。NanoClaw の `gchat.ts` はどちらも渡さず、skill も触れない（§5） |
| GC-06 | 既定値 | [`gchat.ts` L12-20](https://github.com/nanocoai/nanoclaw/blob/d2407fe3b4e30db69779567d945e72ee1b078028/src/channels/gchat.ts#L12-L20) | channel の宣言 | DM は全部に反応、space は mention（sticky ではない）、未知の送信者は `request_approval` |

### 2.2 Gmail と Calendar（`channels` にはない）

NanoClaw の中に Gmail と Calendar 専用の code はない。今の経路は #2 の OneCLI 1.42.0 の OAuth app 接続（GX-01）で、場所は OneCLI `3912c74` の path。

| ID | 機能 | 場所 | 単位 | 備考 |
|---|---|---|---|---|
| GG-01 | `channels` での有無 | [`src/channels/index.ts` L54](https://github.com/nanocoai/nanoclaw/blob/d2407fe3b4e30db69779567d945e72ee1b078028/src/channels/index.ts#L54) | なし | tree の path にも file の中身にも Gmail と Calendar の adapter はない。docs は古いままで、[`docs/SPEC.md` L237](https://github.com/nanocoai/nanoclaw/blob/d2407fe3b4e30db69779567d945e72ee1b078028/docs/SPEC.md#L237) は `/add-gmail` を例に挙げている |
| GG-02 | agent からの呼び出し | [`add-onecli/payload/container/skills/onecli-gateway/SKILL.md` L22-43、L73-85](https://github.com/nanocoai/nanoclaw/blob/d2407fe3b4e30db69779567d945e72ee1b078028/.claude/skills/add-onecli/payload/container/skills/onecli-gateway/SKILL.md#L22-L43) | session | agent は `https://gmail.googleapis.com/...` などを curl で直接呼び、OneCLI が token を注入する。型付きの tool はない。未接続なら `connect_url` を user に見せ、policy の 403 は回避しない |
| GG-03 | OAuth の経路 | [OneCLI `packages/api/src/routes/apps.ts` L389-449](https://github.com/onecli/onecli/blob/3912c74d7029505f0f5389745568111d643adc68/packages/api/src/routes/apps.ts#L389-L449)、[`apps/oauth/google.ts` L12-58](https://github.com/onecli/onecli/blob/3912c74d7029505f0f5389745568111d643adc68/packages/api/src/apps/oauth/google.ts#L12-L58) | OneCLI の project | authorization code。redirect は `<OneCLI API の origin>/v1/apps/<provider>/callback`、code は client secret 付きで交換、`access_type=offline`、`prompt=consent`。state は署名して cookie にも置く。PKCE は使わない |
| GG-04 | client の持ち主 | [`apps/oauth/google.ts` L119-138](https://github.com/onecli/onecli/blob/3912c74d7029505f0f5389745568111d643adc68/packages/api/src/apps/oauth/google.ts#L119-L138)、[`apps/resolve-credentials.ts` L16-58](https://github.com/onecli/onecli/blob/3912c74d7029505f0f5389745568111d643adc68/packages/api/src/apps/resolve-credentials.ts#L16-L58) | project → org → env | 利用者が入れる Client ID と Secret（project の AppConfig）が先、なければ env の `GOOGLE_CLIENT_ID` と `GOOGLE_CLIENT_SECRET`。OSS の image が client を同梱している記述は見当たらない |
| GG-05 | scope | [`apps/gmail.ts` L9-23](https://github.com/onecli/onecli/blob/3912c74d7029505f0f5389745568111d643adc68/packages/api/src/apps/gmail.ts#L9-L23)、[`apps/google-calendar.ts` L9-22](https://github.com/onecli/onecli/blob/3912c74d7029505f0f5389745568111d643adc68/packages/api/src/apps/google-calendar.ts#L9-L22)、[`routes/apps.ts` L432](https://github.com/onecli/onecli/blob/3912c74d7029505f0f5389745568111d643adc68/packages/api/src/routes/apps.ts#L432) | app | app 定義の `defaultScopes` をそのまま要求する。Gmail は `openid`、`email`、`profile`、`gmail.readonly`、`gmail.modify`、`gmail.send`。Calendar は `openid`、`email`、`profile`、`calendar.readonly`、`calendar.events`。接続時に選べない |
| GG-06 | 注入する宛先 | [`apps/gateway/src/apps.rs` L311-373](https://github.com/onecli/onecli/blob/3912c74d7029505f0f5389745568111d643adc68/apps/gateway/src/apps.rs#L311-L373) | host × path | Gmail は `gmail.googleapis.com` の全 path と、旧来の `www.googleapis.com/gmail/`、`/batch/gmail/`。Calendar は `www.googleapis.com/calendar/` と `/batch/calendar/`。どれも Bearer |
| GG-07 | token の更新 | [`apps.rs` L187-193](https://github.com/onecli/onecli/blob/3912c74d7029505f0f5389745568111d643adc68/apps/gateway/src/apps.rs#L187-L193) | connection | gateway が `oauth2.googleapis.com/token` で更新する。設定は env の `GOOGLE_CLIENT_ID` と `GOOGLE_CLIENT_SECRET` を名指ししている |
| GG-08 | 操作の単位 | [`app-permissions/gmail.ts` L85-91](https://github.com/onecli/onecli/blob/3912c74d7029505f0f5389745568111d643adc68/packages/api/src/apps/app-permissions/gmail.ts#L85-L91)、[`policy_engine/catalog.generated.json` L1154](https://github.com/onecli/onecli/blob/3912c74d7029505f0f5389745568111d643adc68/apps/gateway/src/policy_engine/catalog.generated.json#L1154) | host × path × method | policy の catalog。Gmail は 25（`send_email`、`create_draft`、`send_draft`、`trash_message`、`batch_delete_messages`、`modify_message` など、`read_all`、`write_all` を含む）、Calendar は 8（`list_calendars`、`list_events`、`get_event`、`create_event`、`update_event`、`delete_event`、`read_all`、`write_all`）。Gmail の行はすべて host が `gmail.googleapis.com` |
| GG-09 | 承認 card の要約 | [`apps/gateway/src/summary/gmail.rs` L19-45](https://github.com/onecli/onecli/blob/3912c74d7029505f0f5389745568111d643adc68/apps/gateway/src/summary/gmail.rs#L19-L45)、`summary/google_calendar.rs` | request | Gmail の send と下書き作成は本文先頭 16 KiB の MIME から宛先や件名を出す。Calendar は開始、終了、参加者を出す。表示用で、止めるかどうかは決めない。NanoClaw は同じ source を build して一致させる（#2 の GW-13） |
| GG-10 | 送信と作成の承認 | #2 の GW-11、GW-12 | policy rule | OneCLI では allow rule に `requireApproval` を付けたときだけ止まり、180 秒で拒否になる。`channels` の `add-onecli` と setup に Gmail や Calendar の rule を作る code はない。Iron Proxy を選ぶと app の操作は既定で hold になる（[`iron-proxy-approval.test.ts` L153-157](https://github.com/nanocoai/nanoclaw/blob/d2407fe3b4e30db69779567d945e72ee1b078028/.claude/skills/add-iron-proxy/payload/src/gateway-providers/iron-proxy-approval.test.ts#L153-L157)） |
| GG-11 | 接続の単位 | [`routes/apps.ts` L389-413](https://github.com/onecli/onecli/blob/3912c74d7029505f0f5389745568111d643adc68/packages/api/src/routes/apps.ts#L389-L413) | OneCLI の project | 接続は project に付き、NanoClaw の agent group ごとではない。どの agent が使えるかは OneCLI の側で決まる |
| GG-12 | mail を受けて agent を起こす | [削除前の `add-gmail-tool/SKILL.md` L249](https://github.com/nanocoai/nanoclaw/blob/358f1a8166134794f185a4410a767823aa035e0d/.claude/skills/add-gmail-tool/SKILL.md#L249) | なし | v2 にはない。「inbox を poll する `src/channels/gmail.ts` が要るが、v2.0.0 時点で移植していない」と書かれている |

### 2.3 消えた Google の skill

| ID | skill | 期間 | 中身 | 消えた理由 |
|---|---|---|---|---|
| GH-01 | `/add-gmail`（channel） | 2026-02-01 から 2026-04-21 | 旧 MCP server を使う Gmail の channel | "add-gmail — was built on a legacy MCP server; deprecated."（[`53c11a2`](https://github.com/nanocoai/nanoclaw/commit/53c11a2d53a97565e18acffc2eeac90005b7e554)） |
| GH-02 | `/add-gmail-tool` | 2026-04-24（[`9e33274`](https://github.com/nanocoai/nanoclaw/commit/9e33274e2a81121fbf65531108f8239bb4e1e465)）から 2026-08-06 | `@gongrzhe/server-gmail-autoauth-mcp@1.1.11` を image に入れ、`onecli-managed` の stub を OneCLI が書き換える。19 tool（`send_email`、`delete_email`、`create_filter` など）。scope は readonly、modify、send（[L8-26](https://github.com/nanocoai/nanoclaw/blob/358f1a8166134794f185a4410a767823aa035e0d/.claude/skills/add-gmail-tool/SKILL.md#L8-L26)） | MCP server が archive され、固定版の tool 名と OAuth の手順が実際と合わなかった |
| GH-03 | `/add-gcal-tool` | 2026-04-24（[`6d35c85`](https://github.com/nanocoai/nanoclaw/commit/6d35c8512997e5639af0d1f1ac1d95313226caa4)）から 2026-08-06 | `@cocal/google-calendar-mcp`。予定の一覧、検索、作成、更新、削除、free/busy。scope は `calendar.readonly` と `calendar.events`（[L8-28](https://github.com/nanocoai/nanoclaw/blob/358f1a8166134794f185a4410a767823aa035e0d/.claude/skills/add-gcal-tool/SKILL.md#L8-L28)） | Google の公式 remote MCP server があるが、NanoClaw は stdio の MCP しか扱えず、OneCLI は `calendarmcp.googleapis.com` に注入しない。OneCLI だけで Calendar API に届くことは確認済み |
| GH-04 | Gmail の旧 host を塞ぐ rule | 2026-07-21 の PR [#3115](https://github.com/nanocoai/nanoclaw/pull/3115)、merge せずに閉じた | `www.googleapis.com` 経由の Gmail を OneCLI の global block で塞ぐ | 閉じた理由の記載はない |

削除は PR [#3172](https://github.com/nanocoai/nanoclaw/pull/3172)（commit [`743e32d`](https://github.com/nanocoai/nanoclaw/commit/743e32df4e6c05f3725c17cb2ec11f2b65079eec)）で、`channels` にもこの commit が入っている。

## 3. 確認した事実の引用

- 導入の形: [`add-slack/SKILL.md` L8-10](https://github.com/nanocoai/nanoclaw/blob/d2407fe3b4e30db69779567d945e72ee1b078028/.claude/skills/add-slack/SKILL.md#L8-L10) "Trunk ships no channels — this skill copies the Slack channel layer (...) in from the `channels` branch."、[`BRANCH-FORK-MAINTENANCE.md` L22](https://github.com/nanocoai/nanoclaw/blob/d2407fe3b4e30db69779567d945e72ee1b078028/docs/BRANCH-FORK-MAINTENANCE.md#L22) "a user's clone never merges a registry branch, and registry branches are never merged back into `main`."
- 受信の切り替え: [`add-slack/SKILL.md` L88-90](https://github.com/nanocoai/nanoclaw/blob/d2407fe3b4e30db69779567d945e72ee1b078028/.claude/skills/add-slack/SKILL.md#L88-L90) "the adapter picks Socket Mode automatically whenever `SLACK_APP_TOKEN` is set."
- 自分以外の bot: [`slack-a2a-guard.ts` L4-8](https://github.com/nanocoai/nanoclaw/blob/d2407fe3b4e30db69779567d945e72ee1b078028/src/channels/slack-a2a-guard.ts#L4-L8) "neither `@chat-adapter/slack` nor the Chat SDK core drops a *sibling* bot's messages — the only bot filter in that stack is `author.isMe`"、[L16-19](https://github.com/nanocoai/nanoclaw/blob/d2407fe3b4e30db69779567d945e72ee1b078028/src/channels/slack-a2a-guard.ts#L16-L19) "bot-authored inbound is DROPPED by default"
- loop の上限: [`slack-a2a-rooms/SKILL.md` L35-38](https://github.com/nanocoai/nanoclaw/blob/d2407fe3b4e30db69779567d945e72ee1b078028/.claude/skills/slack-a2a-rooms/SKILL.md#L35-L38) "After N consecutive bot-authored inbound messages in an A2A room without a human message (N = `SLACK_A2A_MAX_HOPS`, default 6), further bot messages are dropped"
- 重複: [Chat SDK `chat.ts` L2008-2010](https://github.com/vercel/chat/blob/6581d31507b2184df29abe49f4bf94e805fc961f/packages/chat/src/chat.ts#L2008-L2010) "same message can arrive via multiple paths (e.g., Slack message + app_mention events, GChat direct webhook + Pub/Sub)"
- 自動作成の条件: [`router.ts` L250-253](https://github.com/nanocoai/nanoclaw/blob/d2407fe3b4e30db69779567d945e72ee1b078028/src/router.ts#L250-L253) "Auto-create only when the message warrants attention (the bot was addressed — @mention or DM)."
- 送信の制限: [`delivery.ts` L432-434](https://github.com/nanocoai/nanoclaw/blob/d2407fe3b4e30db69779567d945e72ee1b078028/src/delivery.ts#L432-L434) "An agent can always reply to the chat it was spawned from"
- 自動発行: [`slack-app.ts` L4-13](https://github.com/nanocoai/nanoclaw/blob/d2407fe3b4e30db69779567d945e72ee1b078028/src/provisioning/slack-app.ts#L4-L13) "When the operator holds a manager-app user token (xoxp-… with app_configurations:write + managed_apps:install), we can create the bot's Slack app programmatically"、[L26-28](https://github.com/nanocoai/nanoclaw/blob/d2407fe3b4e30db69779567d945e72ee1b078028/src/provisioning/slack-app.ts#L26-L28) "The broker holds the Slack manager credential server-side; the host only ever sees the derived per-app tokens."
- Google の MCP skill の削除: [PR #3172](https://github.com/nanocoai/nanoclaw/pull/3172) "OneCLI does not currently inject credentials for `calendarmcp.googleapis.com`." "A supported Gmail or Calendar integration can return later with a clear authentication and permission model."
- 旧 host の迂回: [PR #3115](https://github.com/nanocoai/nanoclaw/pull/3115) "Gmail policies written against `gmail.googleapis.com` can be bypassed through legacy Google API routes."
- Google の client: [OneCLI `resolve-credentials.ts` L18-21](https://github.com/onecli/onecli/blob/3912c74d7029505f0f5389745568111d643adc68/packages/api/src/apps/resolve-credentials.ts#L18-L21) "resolves them from AppConfig (user-provided) → the organization's AppConfig (...; skipped in OSS) → env vars (platform defaults) → null."

## 4. 確かめた外部の記述

- Slack の公式の [`apps.manifest.create`](https://docs.slack.dev/reference/methods/apps.manifest.create)（2026-10-15 に閲覧）は configuration token と `app_configurations:write` を求め、応答に `credentials` と `oauth_authorize_url` を返すと書く。`generate_app_token` 引数と応答の `app_token` は載っていない。error 表には `invalid_manager_app`（"The calling app is not enrolled as a manager app."）と `managed_app_limit_reached` がある。`apps.managedInstall` の reference page は 404 だった。

## 5. 推測

- Socket Mode でも `/webhook/slack` は `0.0.0.0:3000` に登録される（SL-07 の分岐は gateway 型と polling 型だけを除く）。届いた要求は 405 で拒まれ、通るのは `x-slack-socket-token` が app token と一致する転送だけと読める。
- 自動発行した App は interactivity が無効（SP-04）。承認 card の button の click が Socket Mode でこの App に届くかは、Slack の設定の挙動しだいで、source からは判断できない。
- Google Chat の adapter は、Chat SDK 4.29.0 では process の環境変数に `GOOGLE_CHAT_PROJECT_NUMBER` などがないと生成時に例外になる。NanoClaw の `readEnvFile` は `.env` を `process.env` に入れない（`src/env.ts` L7）ので、skill の手順どおりでは起動しないと読める。
- OneCLI 1.42.0 の Gmail の policy の catalog は `gmail.googleapis.com` だけを対象にし、注入は `www.googleapis.com/gmail/` にも行う（GG-06、GG-08）。PR #3115 の指摘どおり、`gmail.googleapis.com` に書いた block や承認の rule は旧 host で迂回できると読める。
- OneCLI の Google 接続は client secret を使う code 交換で、redirect は OneCLI の API の固定 path なので、Google Console では Web application 型の client を作る前提に見える。Desktop 型の client で通るかは読んでいない。
- 1 つの OneCLI project の Gmail 接続は、agent ごとの access を絞らなければ、その project の全 agent group から使える（GG-11 と #2 の GW-10 から）。

## 6. 確かめていないこと

- `apps.managedInstall`、`generate_app_token`、manager app の登録条件。公開 docs で見つけられたのは §4 の記述だけ。
- broker（`slack.nanoclaw.dev`）の server 側。source は公開されていない。
- BYOC の client で入れた Google 接続を gateway がどの client で更新するか。`GOOGLE_REFRESH` は env の名前を持つが、connection の更新処理（`connection-service.ts`）は読んでいない。
- `@slack/socket-mode` の再接続や ack の内部、webhook 方式での Slack の再送の扱い。
- 承認 card を Slack の DM にどう描き、click をどう認可するか。core の処理で #2 の NC-20、NC-21 のとおり。
- 何も実行していないので、表の挙動はすべて source と docs を読んだ範囲のもの。

## 7. 後続の ticket への含意

- [#12](https://github.com/ashigirl96/momo/issues/12)（初版の同等性と対象外）は SL、SP、GC、GG の行 ID ごとに判定できる。Gmail と Calendar には同等性の基準になる NanoClaw の adapter がない。比べられるのは OneCLI の汎用注入と catalog（GG-02 から GG-10）だけで、#12 の「NanoClaw と同等」の判定は Google については成り立たない。「専用 Slack App の自動発行」は SP-02 から SP-06 に当たり、NanoClaw の運営する broker か Slack の manager app 登録が前提になる。
- [#19](https://github.com/ashigirl96/momo/issues/19)（Slack Bot/User の接続経路）について、NanoClaw は User token を一切使わず、Bot token は Install to Workspace（手動）か manifest API と managed install（自動）で得る。後者は #19 の 4 候補にない 5 つ目の経路だが、公開 docs で裏が取れない（§4）。User token の経路には参照点がない。
- [#20](https://github.com/ashigirl96/momo/issues/20)（Google の client・scope・利用形態）について、NanoClaw は自前の Google client を持たない。OneCLI は client secret を使う code 交換で、scope を最初からまとめて要求し、`gmail.modify`（restricted）も含む。#6 の最小 scope（`gmail.readonly` と `gmail.send`）より広い。
- [#13](https://github.com/ashigirl96/momo/issues/13)（Operation と Approval）について、OneCLI の catalog（Gmail 25、Calendar 8）が型付き操作に最も近い参照になる。host と path で書いた rule が旧 host で迂回できる件（§5、PR #3115）は、操作を host ではなく型で識別する根拠になる。
- [#8](https://github.com/ashigirl96/momo/issues/8)（境界）について、Channel binding に当たるのは `(channel_type, platform_id, instance)` の messaging group と wiring で、Slack の team id は鍵に入らない。bot identity（instance）が token の単位になる。
- map の「Slack からの受信」の参照点。Socket Mode と app-level token（SL-04、SL-05）、重複の排除（SL-20、SL-21）、自己会話ループの 3 段（SL-22 から SL-24）が揃った。
- map の Decisions so far にある #2 の行の「Slack と Google の adapter は参照 commit に無く、`channels` branch にある」は、Google については誤り。`channels` にあるのは Google Chat だけで、Gmail と Calendar の adapter はどこにもない。
