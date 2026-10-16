# setup-token の placeholder と注入する header の実測

測定日は 2026-10-16。Docker Desktop 4.82.0（linux/arm64）で、`@anthropic-ai/claude-agent-sdk` 0.3.300（CLI 2.1.300）を Bun 1.4.2-slim の container で動かした。sandbox 役の container は `--internal` の network に置き、uid 1000、read-only の root fs で動かした。securityd 役の proxy は同じ network と既定の bridge の両方につなぎ、所有者が `claude setup-token` で作った token の file はこの proxy の container だけに read-only で mount した。

## 手順

| script | 内容 |
|---|---|
| `net.sh` | header を記録する偽の endpoint（`fake/server.ts`）を `172.30.31.2` で起こす |
| `run.sh` | probe（`probe/probe.mjs`）を sandbox と同じ条件で 1 回動かす |
| `side.sh` | 2 つの env の候補で、base URL への要求と、DNS・TCP の記録を比べる |
| `proxy.sh` | placeholder の Bearer を token に差し替える proxy（`proxy/server.ts`）を `172.30.31.3` で起こす |
| `via.sh` | proxy を経由して probe を動かす |
| `liveB.sh` | `ANTHROPIC_AUTH_TOKEN` で、proxy が OAuth の beta を足す場合と足さない場合を本物の API で比べる |
| `rl.sh` | 2 つの env で、本物の API が返す rate limit の header を比べる |
| `envcheck.sh` | sandbox の env・全 process の argv・mount・`CLAUDE_CONFIG_DIR` に token が無いかを調べる |
| `deny.sh` | proxy が資格情報を拒否したとき、CLI が再試行する長さを status ごとに測る |

## 結果

### CLI が送るもの（偽の endpoint、実 token なし）

| env | `Authorization` | `anthropic-beta` の差 | 既定の model | tool 数 |
|---|---|---|---|---|
| `CLAUDE_CODE_OAUTH_TOKEN` | `Bearer <値>` | `oauth-2025-04-20` と `extended-cache-ttl-2025-04-11` が付く | `claude-sonnet-5-5` | 21（`RemoteTrigger` が増える） |
| `ANTHROPIC_AUTH_TOKEN` | `Bearer <値>` | 付かない | `claude-opus-5-5` | 20 |
| 両方 | `ANTHROPIC_AUTH_TOKEN` の値 | 付かない | `claude-opus-5-5` | 20 |

- どちらでも `apiKeySource` は `none` で、要求は `POST /v1/messages?beta=true` だった。
- CLI は値の形を検証しない。`sk-ant-oat01-` で始まらない `momo-placeholder` でも同じ header で送った。
- placeholder は `CLAUDE_CONFIG_DIR`・`HOME`・transcript のどこにも書かれなかった。
- `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` を付けると、base URL への `POST /v1/messages` が 1 回だけになり、DNS も TCP も出なかった。付けないと、`HEAD /api/hello` と 2 回目の `POST /v1/messages` が base URL に来るほか、`api.anthropic.com:443` への直接の TLS 接続が出た。OAuth の env では 6 回、`ANTHROPIC_AUTH_TOKEN` では 2 回だった。

### 本物の API（proxy が Bearer の値だけを差し替える）

- `CLAUDE_CODE_OAUTH_TOKEN` の placeholder で、`POST /v1/messages` は 200 を返した。SSE は 16 chunk に分かれ、最初の chunk から約 1.6 秒かけて届いた。proxy は chunk を溜めずにそのまま流した。
- `ANTHROPIC_AUTH_TOKEN` の placeholder でも 200 を返した。proxy が `oauth-2025-04-20` を足しても足さなくても、結果は同じだった。
- どちらの env でも、応答には `anthropic-ratelimit-unified-5h-*` と `anthropic-ratelimit-unified-7d-*` が付いた。どちらも所有者の plan の利用上限で数えられている。

### 秘密非露出

- sandbox の env・全 process の argv・mount・`CLAUDE_CONFIG_DIR`・transcript に token は無かった（`envcheck.sh`）。env にあるのは placeholder だけだった。
- proxy の log と、sandbox の state の dir（`HOME`・`work`・`CLAUDE_CONFIG_DIR`）にも token は無かった。

### 拒否したときの再試行

| proxy の応答 | 試行回数 | result が返るまで |
|---|---|---|
| 401 `authentication_error` | 11（1 回と再試行 10 回。間隔は 0.5 秒から倍に伸び、最大約 40 秒） | 約 174〜189 秒 |
| 403 `permission_error` | 1 | 約 0.2 秒 |

どちらも result は `is_error: true` で、本文は `Failed to authenticate. API Error: <status> <message>` だった。

## 測っていないもの

- token の失効や revoke のあとに本物の API が返す status
- upstream が header や token を応答に映し返すときの扱い
- 長い Run での compaction や、`count_tokens` などの要求
- Session ごとの relay の container を通した構成（ADR-0014）。今回は proxy を同じ internal network に直接置いた
