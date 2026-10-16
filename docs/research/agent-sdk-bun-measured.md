# Agent SDK を Linux container の Bun で動かす実測

測定日 2026-10-16。[Agent SDK と native CLI を agent-runner で動かす条件](https://github.com/ashigirl96/momo/blob/6c6edb30b887302d19d7982f87cfb4cc973899cc/docs/research/agent-sdk-runner.md) の §8 の項目を、[ADR-0009](../adr/0009-agent-sdk-and-cli-both-in-sandbox.md) の配置（SDK と CLI を両方 sandbox の中に置く）で測った。モデル通信は偽の endpoint に向け、実資格情報は使っていない。

## 1. 環境

| 対象 | 版 |
|---|---|
| host | macOS 26.6.2 arm64、Docker Desktop 4.82.0（Engine 29.6.1、kernel 6.12.76-linuxkit aarch64） |
| SDK | `@anthropic-ai/claude-agent-sdk` 0.3.300（exact pin。測定時の npm latest は 0.3.301）、同梱 CLI 2.1.300、`zod` 4.1.12、peer で入った `@anthropic-ai/sdk` 0.135.0 |
| Bun（glibc） | `oven/bun:1.4.2-slim`（Debian 13、glibc 2.41）`sha256:cb3bbbb08e13a4a2ff400f24c7a2a1d5efa83f6ef8544d52d95a519631e2fc61` |
| Bun（musl） | `oven/bun:1.4.2-alpine`（Alpine 3.22.5）`sha256:d888c0ae6c86d7866ff10c5aafdd9077b36aee6455b33dd270fb93c0dd5cef6f` |
| Node 22 | `node:22-slim`（Debian 12、glibc 2.36、Node 22.23.3、npm 10.9.9）`sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392` |
| Node 24 | `node:24-slim`（Debian 12、Node 24.22.0）`sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5` |

Bun の image は [Bun の Docker guide](https://bun.com/guides/ecosystem/docker) の形にした（multi-stage、`bun install --frozen-lockfile --production`、`USER bun`、exec 形式の `ENTRYPOINT`）。Node の image は差を見るための比較対象で、`npm install` で入れた。

runner の container は次の条件で動かした。

- `--internal` の Docker network に偽の endpoint と並べて置き、外には出られない。
- uid 1000、`--read-only` の root fs、`noexec` の tmpfs の `/tmp`。
- `HOME`・`cwd`（`/work`）・`CLAUDE_CONFIG_DIR`（`/cfg`）だけを書き込める bind mount にした。
- `/etc/resolv.conf` を偽の endpoint に向け、DNS の問い合わせを全部記録した。偽の DNS はすべての名前に自分の IP を返し、443 番への TLS 接続の SNI も記録した。

偽の endpoint は Anthropic Messages API の SSE を返し、受けた method・path・header を全部記録する。

## 2. 結果

§8 の番号に合わせて書く。特に書かない限り、Bun（glibc・musl）と Node 22・24 の 4 つで同じ結果になった。

### 2.1 install

- `bun install` は、`linux-arm64` と `linux-arm64-musl` の platform package を**両方**入れる（`node_modules` 559MB）。`npm install` は libc に合う方だけを入れる（312MB）。
  - `bun.lock` は platform package の `os` と `cpu` を記録するが、`libc` を記録しない。
  - Bun 1.4.2 の `bun install` には `--os` と `--cpu` しか無い。`--libc musl` を渡すと `musl` を package 名として `bun add` になり、registry の 404 で失敗した。research が引いた Bun docs の `--libc` は 1.4.2 に無い。
  - Bun の Docker guide の形（`--production`）でも結果は同じ。`--production` は optional dependency を外さない。
- image の大きさ: Bun（glibc）1.11GB、Bun（musl）961MB、Node 22 1.09GB、Node 24 1.1GB。
- macOS host での `bun install --os linux --cpu arm64` と image への copy は測っていない。

### 2.2 binary の検証

- `downloads.claude.ai/claude-code-releases/2.1.300/manifest.json.sig` は、docs の鍵（fingerprint `31DD DE24 DDFA B679 F42D 7BD2 BAA9 29FF 1A7E CACE`）で `Good signature` になった。
- `node_modules` の `claude` の sha256 は、manifest の `linux-arm64`（`ae2295ae…fa0a6`）と `linux-arm64-musl`（`267fecaf…27a2c`）に一致した。
- `claude --version` は `2.1.300 (Claude Code)` を返した。

### 2.3 解決

- `pathToClaudeCodeExecutable` 無しの `query()` は、Bun でも binary を解決した。glibc の image では `claude-agent-sdk-linux-arm64/claude`、Alpine では `claude-agent-sdk-linux-arm64-musl/claude` を起動した。
- `process.report.getReport().header.glibcVersionRuntime` は Bun（glibc）で `"2.41"`、Bun（musl）で `null`、Node で `"2.36"` を返した。

### 2.4 base image の要件

- glibc 版の binary の動的依存は glibc の `libc`・`librt`・`libpthread`・`libdl`・`libm` だけ。musl 版は musl の libc だけに依存する。
- Alpine の既定（busybox の `sh` だけ）では、Bash tool が `No suitable shell found. Claude CLI requires a Posix shell environment.` で失敗する。`apk add bash`（+6MB）で通った。
- CLI 2.1.300 には独立した Grep tool が無い（呼ぶと `No such tool available: Grep`）。検索は Bash tool の中の `rg` で、`rg` は CLI に埋め込まれた ripgrep 14.1.1 を呼ぶ shell 関数になっている。musl でも動き、`USE_BUILTIN_RIPGREP=0` を付けても埋め込み版が使われた。docs が Alpine に求める `ripgrep`・`libgcc`・`libstdc++` は、今回の範囲では要らなかった。

### 2.5 書き込み先

read-only の root fs、uid 1000、`noexec` の `/tmp` で全項目が動いた。書き込まれたのは次の path だけ。

| 場所 | 書かれたもの | 条件 |
|---|---|---|
| `CLAUDE_CONFIG_DIR` | `.claude.json`、`backups/.claude.json.backup.<時刻>`、`.last-cleanup` | 毎回 |
| `CLAUDE_CONFIG_DIR` | `projects/<cwd 由来の名前>/<session id>.jsonl`（cwd が `/work` なら `-work`） | `persistSession: false` 以外 |
| `CLAUDE_CONFIG_DIR` | `shell-snapshots/` | Bash tool の実行中 |
| `CLAUDE_CONFIG_DIR` | `telemetry/1p_failed_events.*.json` | `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` が無いとき |
| `HOME` | `.cache/claude-cli-nodejs/<cwd 由来の名前>/mcp-logs-<server>/*.jsonl` | in-process の MCP server を使ったとき |
| `cwd` | なし | — |

`.claude.json` は `HOME` ではなく `CLAUDE_CONFIG_DIR` に置かれた。`HOME` は MCP の log のために書き込める必要がある。

### 2.6 placeholder の資格情報

| 環境変数 | 送られた header | `apiKeySource` | 結果 |
|---|---|---|---|
| `ANTHROPIC_API_KEY=sk-ant-placeholder` | `x-api-key: sk-ant-placeholder` | `ANTHROPIC_API_KEY` | 成功 |
| `ANTHROPIC_AUTH_TOKEN=placeholder` | `authorization: Bearer placeholder` | `none` | 成功 |
| どちらも無し | （`/v1/messages` を送らない） | `none` | result が `Not logged in · Please run /login`（`is_error`）、generator が throw |

endpoint が受けた要求は次のとおり。`count_tokens` と `/v1/models` は来なかった。

- `HEAD /api/hello`（`CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` が無いときだけ）
- `POST /v1/messages?beta=true` の本体
- tool 無しの `POST /v1/messages?beta=true`。session の題名を作る要求で、`CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` が無いときだけ来る。
- User-Agent は `claude-cli/2.1.300 (external, sdk-ts, agent-sdk/0.3.300)`。`HEAD` だけは `Bun/1.4.3` で、CLI 自体が Bun 1.4.3 で build されている。

### 2.7 base URL 以外の通信

- `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` が無いと、1 回の Run で `api.anthropic.com` の DNS 解決と 443 番への TLS 接続（SNI `api.anthropic.com`）が 2〜5 回出た。失敗した telemetry は `CLAUDE_CONFIG_DIR/telemetry/` に溜まる。
- `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` では、base URL 以外への DNS と接続が 0 になった。`HEAD /api/hello` と題名の要求も消え、組み込み tool から `DesignSync` が消えた（21 → 20）。
- WebFetch は、`CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` でも、preflight で `api.anthropic.com` を引いた。`settings: { skipWebFetchPreflight: true }` で preflight は消え、対象（`example.com`）へ直接 DNS と 443 番の接続が出た。WebFetch を Gateway の tunnel に通す設定（`HTTPS_PROXY` など）は測っていない。

### 2.8 stream

- 偽の endpoint が 500ms ごとに 20 個の `text_delta` を送ると、`includePartialMessages: true` の event は送信から平均 2〜3ms、最大 7ms で届いた（4 つの runtime の範囲）。
- `ping` だけが 90 秒続く区間は 4 つとも、300 秒続く区間は Bun（glibc）で、idle timeout に当たらず完了した。

### 2.9 cancel

- `abortController.abort()` から約 2.0 秒（2006〜2010ms）で、generator が `Claude Code process aborted by user` を throw した。最後の message は `system/task_started` だった。
- CLI の process は abort から 3〜6 秒で終わり、Bash tool の子（`sleep 600` を 2 つ）も kill された。
- **PID 1 が init でないと zombie が残る。** Bun や Node が PID 1 のとき（Bun の guide の exec 形式の `ENTRYPOINT`）、kill された `sleep` は PID 1 に引き取られ、zombie のまま残った。`docker run --init`（tini が PID 1）では、abort から 3 秒で全部消えた。
- streaming input での `interrupt()` は `{ still_queued: [] }` を返した。中断した turn は result `error_during_execution` で終わり、transcript には `[Request interrupted by user]` が入る。次の user message は同じ session id で続き、中断した turn の内容も履歴に残っていた。
- `close()` の後、generator は約 2.0 秒で throw せずに終わり、CLI の process は 3 秒以内に消えた。

### 2.10 resume

- runner の container を作り直し（毎回 `docker run --rm`）、同じ `CLAUDE_CONFIG_DIR` と同じ `cwd` を mount すると、`resume` は同じ session id で続き、前の Run の内容がモデルへの要求に入っていた。
- `forkSession: true` では新しい session id と新しい transcript file になり、元の履歴も入っていた。
- `persistSession: false` では transcript が書かれなかった。`.claude.json` とその backup は書かれる。
- `CLAUDE_CODE_PROJECT_DIR_NAME` は試していない。

### 2.11 Node との比較

2.3 の解決先と 2.1 の install 以外に、Bun と Node の差は出なかった。cancel までの時間、zombie、resume、stream の遅れ、MCP の待ちは同じだった。

### 2.12・2.13

- 2.12（`bun build --compile`）は測っていない。「agent-runner の runtime・配布単位・モデル資格情報」で compile を候補に残すかがまだ決まっていない。
- 2.13（host の SDK から container の CLI を起動）は、ADR-0009 で配置が決まったので外した。

### 2.14 in-process MCP の待ち（ticket の comment で足した項目）

- `createSdkMcpServer({ timeout: 30000 })` の tool が 60 秒待つと、CLI は 30 秒で打ち切った。handler の `extra.signal` に abort が届き、モデルには `MCP server "momo" tool "wait" timed out after 30s` が tool の結果として返り、Run は続いた。
- `timeout: 720000` で 660 秒待つ tool は、Bun と Node 22 で 660 秒後に結果を返した。`timeout` を指定しない既定でも、Bun で 660 秒待ち切った。待つ間、SDK には 30 秒ごとに `tool_progress` が届いた。

## 3. 判断への入力

- **runner の image**: Bun の Docker guide の形に、次の 2 つを足す。
  - init（`--init` か tini）。足さないと、cancel した Bash tool の子が zombie で残る。
  - Alpine なら bash。
- **image の大きさ**: Bun で入れると、使わない libc の CLI（約 250MB）が残る。install の後で消すか、`pathToClaudeCodeExecutable` で明示する。
- **sandbox の env**: `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` と `skipWebFetchPreflight` で、base URL 以外への通信は WebFetch の対象だけになる。WebFetch は Gateway の tunnel を通す設定が別に要る。
- **書き込める dir**: `CLAUDE_CONFIG_DIR`・`HOME`・`cwd`・`/tmp` の 4 つ。`/tmp` は `noexec` でよい。
- **モデル資格情報**: placeholder は `ANTHROPIC_API_KEY` でも `ANTHROPIC_AUTH_TOKEN` でも起動する。Gateway はどちらの header でも置き換えられる。
- **禁止する組み込み tool**: CLI 2.1.300 の組み込み tool には、ADR-0009 の禁止の一覧に無い `Workflow`・`ListAgents`・`TaskStop` が含まれる。
- **runtime の選択**: Bun を選んで困る差は、install の libc の扱いのほかに見つからなかった。

## 4. 再現

`agent-sdk-bun-measured/` の script を、Docker Desktop の動く macOS で順に動かす。

```sh
sh build.sh        # image を作る（Bun は guide の形、Node は比較用）
sh net.sh          # --internal の network に偽の endpoint・DNS・TLS の記録を立てる
sh suite.sh bun-slim; sh suite.sh bun-alpine; sh suite.sh node22; sh suite.sh node24
sh table.sh        # image ごとの結果を並べる
sh extra.sh        # Alpine + bash の cancel と、Bash tool の中の rg
sh long.sh         # 10 分を超える MCP の待ちと、300 秒の ping（偽の endpoint の log を共有するので suite と並べて動かさない）
```

結果は `results/<image>/<test>/` に、runner の出力（`out.jsonl`）、endpoint の要求・SSE・DNS・TLS の記録、書き込まれた file の一覧（`files.txt`）として残る。
