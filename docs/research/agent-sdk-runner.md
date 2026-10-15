# Agent SDK と native CLI を agent-runner で動かす条件

- ticket: [#4](https://github.com/ashigirl96/momo/issues/4)（map: [#1](https://github.com/ashigirl96/momo/issues/1)）
- 確認日: **2026-10-15**
- 方法: 読むだけ。npm registry の metadata、公開 package の file（jsDelivr / unpkg）、公式 docs、GitHub 上の source と CHANGELOG を読んだ。install・実行・signup・実 token は使っていない。
- 表記: 各節で「事実」（引用・URL・版つき）と「推論」を分ける。確かめられなかった点は [§9](#9-未確認の点) にまとめる。

## 結論

1. **版**: `@anthropic-ai/claude-agent-sdk` **0.3.300**（2026-10-14 公開、npm の `latest`）。native CLI **2.1.300** を同梱する。lockfile で exact pin にし、minor を上げる前に CHANGELOG を読む。
2. **同梱物**: SDK 本体（`sdk.mjs`）と、container の OS・arch・libc に合う platform package 1 つ（例 `@anthropic-ai/claude-agent-sdk-linux-arm64`。中身は `claude` 1 file で約 250〜267 MB）。postinstall は無く、optional dependency として入る。
3. **解決**: `pathToClaudeCodeExecutable` を渡さなければ、SDK は `createRequire(import.meta.url).resolve('<platform package>/claude')` で binary を探す。Linux では実行中の runtime の libc を見て musl と glibc の順を決める。image の中で install すれば合う。macOS host で入れた `node_modules` を copy すると darwin の binary しか無く、起動に失敗する。
4. **Bun**: 公式 docs が runtime 要件に書くのは Node.js 18+ だけで、Bun を SDK の実行環境として支持する文は無い。source は Bun を検出する分岐を持ち、CHANGELOG に Bun 向けの修正がある。native CLI は Bun や Node を介さず直接 spawn されるので、Bun が担うのは `sdk.mjs` と stdio の中継だけになる。起動・stream・cancel・resume が Bun で成り立つかは #16 で測る。
5. **compile の切り分け**: backend の `bun build --compile` と runner は別の話。runner を compile すると SDK は binary を解決できず、`extractFromBunfs()` で書き込み・実行可能な temp に取り出す必要がある。runner は compile せず、image に Bun と `node_modules` を入れる構成を推す（推論）。
6. **session state**: transcript は `CLAUDE_CONFIG_DIR`（既定 `~/.claude`）の `projects/<project>/<session-id>.jsonl`。resume にはこの file が同じ machine に残っている必要がある。runner は `CLAUDE_CONFIG_DIR` と `cwd` を永続 volume に mount する。transcript の形式は内部仕様で、既定 30 日で消える。
7. **モデル通信**: `ANTHROPIC_BASE_URL` を sandbox の外の proxy（securityd の model proxy）に向け、proxy が資格情報を注入する構成を公式 docs が推奨形として書いている。CLI は資格情報が何も無いと login を求めるので、sandbox には秘密でない placeholder を置く（推論。#16 で確かめる）。
8. **資格情報の制約**: Agent SDK を使う製品は Console の API key か cloud provider の資格情報を使うよう求められている。Free/Pro/Max の資格情報を経由させることや、claude.ai の session token を保存・仲介することは許されていない。securityd が subscription の OAuth token を Vault に置いて注入する構成は、この文面に反する。
9. **新しい選択肢**: `spawnClaudeCodeProcess` を使うと、SDK を sandbox の外（backend）で動かし、CLI だけを sandbox で起動できる。ROADMAP §1.1 の「sandbox 内に SDK + CLI」とは別の配置で、#17 か新しい decision ticket で比べる価値がある（[§7](#7-sdk-を-sandbox-の外に置く配置)）。

## 調べた版

| 対象 | 版・時点 | 出典 |
|---|---|---|
| `@anthropic-ai/claude-agent-sdk` | 0.3.300。dist-tag は `latest` と `next` の 2 つで、どちらも 0.3.300。公開 2026-10-14T14:28:12Z | [registry](https://registry.npmjs.org/@anthropic-ai/claude-agent-sdk) |
| 同梱 CLI | 2.1.300。build 2026-10-14T13:29:53Z、commit `c6733ae1276880507ca0c5b053ae18fb0df090d6` | [SDK の manifest.json](https://cdn.jsdelivr.net/npm/@anthropic-ai/claude-agent-sdk@0.3.300/manifest.json) |
| `@anthropic-ai/claude-code`（参考） | `latest` 2.1.300 / `stable` 2.1.292 | [registry](https://registry.npmjs.org/@anthropic-ai/claude-code) |
| Bun | 1.4.3（2026-10-10 リリース） | [GitHub release](https://github.com/oven-sh/bun/releases/tag/bun-v1.4.3) |
| Bun source | main `a407eae88ac76d2f54068b00a9f79c7b9ccc0f0f`（2026-10-15） | [oven-sh/bun](https://github.com/oven-sh/bun/tree/a407eae88ac76d2f54068b00a9f79c7b9ccc0f0f) |
| SDK の CHANGELOG | main `fbc529490ca0fb07b486c6f9c8e553d3fb7c690d`（2026-10-14） | [CHANGELOG.md](https://github.com/anthropics/claude-agent-sdk-typescript/blob/fbc529490ca0fb07b486c6f9c8e553d3fb7c690d/CHANGELOG.md) |

Web docs（`code.claude.com`、`bun.com`）の初回公開日は確認していない。

## 1. 版と同梱物

### 事実

- 0.3.300 の `package.json` は `dependencies` を持たず、8 つの platform package を `optionalDependencies` に持つ（`darwin-arm64` `darwin-x64` `linux-x64` `linux-arm64` `linux-x64-musl` `linux-arm64-musl` `win32-x64` `win32-arm64`）。`scripts` は無い（postinstall 無し）。`engines.node` は `>=18.0.0`。`peerDependencies` は `zod ^4.0.0`、`@anthropic-ai/sdk >=0.93.0`、`@modelcontextprotocol/sdk ^1.29.0`。[registry](https://registry.npmjs.org/@anthropic-ai/claude-agent-sdk/0.3.300)
- platform package の中身は `claude`、`package.json`、`LICENSE.md`、`README.md` の 4 file。description は "Native CLI binary for @anthropic-ai/claude-agent-sdk on linux-x64"。Linux 用は `os` `cpu` `libc` を宣言する（`linux-x64` は `libc: ["glibc"]`、`linux-x64-musl` は `libc: ["musl"]`）。展開後の大きさは linux-x64 266,972,933 B、linux-arm64 266,265,165 B、linux-x64-musl 260,588,483 B、linux-arm64-musl 258,423,483 B、darwin-arm64 249,557,464 B。[registry linux-x64](https://registry.npmjs.org/@anthropic-ai/claude-agent-sdk-linux-x64/0.3.300)、[unpkg の file 一覧](https://unpkg.com/@anthropic-ai/claude-agent-sdk-linux-x64@0.3.300/?meta)
- SDK と CLI の版は patch 番号で対応する。"The SDK version tracks the bundled Claude Code version. SDK v0.3.191 bundles Claude Code v2.1.191" [TypeScript reference](https://code.claude.com/docs/en/agent-sdk/typescript)
- 更新の方針。"The bundled binary is pinned to the SDK package version, so updating the SDK is how you update the CLI. The SDK follows semver: take patch releases continuously and review the TypeScript or Python changelog before taking a minor." [Hosting](https://code.claude.com/docs/en/agent-sdk/hosting#runtime-dependencies)
- 0.3.300 の `manifest.json` は `"version": "2.1.300"` で、8 platform の sha256 を持つ。この値は Anthropic の release manifest [`claude-code-releases/2.1.300/manifest.json`](https://downloads.claude.ai/claude-code-releases/2.1.300/manifest.json) と 8 platform すべてで一致した。unpkg が返す linux-x64 の `claude` の integrity `sha256-Z03roLupruR59FA8Q4tJMDtv3TBLmkcbFJd6rsUhVFM=` を hex にすると、manifest の `674deba0bba9aee479f4503c438b49303b6fdd304b9a471b14977aaec5215453` と同じになる。
- release manifest には GPG の detached signature（`manifest.json.sig`）がある。"Linux: binaries are not individually code-signed. If you download directly from the `claude-code-releases` bucket or use the native installer, verify integrity with the manifest signature above." [Advanced setup](https://code.claude.com/docs/en/setup#binary-integrity-and-code-signing)
- 0.3.300 の `README.md` の badge と本文は Node.js 18+ を示す。[README](https://cdn.jsdelivr.net/npm/@anthropic-ai/claude-agent-sdk@0.3.300/README.md)
- `LICENSE.md` は "© Anthropic PBC. All rights reserved. Use is subject to the Legal Agreements outlined here: https://code.claude.com/docs/en/legal-and-compliance." [LICENSE.md](https://cdn.jsdelivr.net/npm/@anthropic-ai/claude-agent-sdk@0.3.300/LICENSE.md)

### 推論

- #16 は 0.3.300 で測る。CLI の stable channel（約 1 週遅れ）に合わせたいなら、同じ patch 番号の 0.3.292 が代案になる。0.3.292 の公開（2026-10-06）は registry で確かめたが、その manifest は開いていない。
- image build で platform package の `claude` の sha256 を、署名を検証した release manifest と照合できる。npm 経由でも供給元を確かめる手段になる。

## 2. native CLI の解決と OS・arch・libc

### 事実

- `sdk.mjs`（0.3.300）は `pathToClaudeCodeExecutable` が無いとき、`createRequire(import.meta.url)` の `resolve` で platform package の `claude` を探す。見つからなければ次を投げる。[sdk.mjs](https://cdn.jsdelivr.net/npm/@anthropic-ai/claude-agent-sdk@0.3.300/sdk.mjs)

  ```text
  Native CLI binary for ${process.platform}-${process.arch} not found. Reinstall @anthropic-ai/claude-agent-sdk without --omit=optional, or set options.pathToClaudeCodeExecutable.
  ```

- Linux では候補の順を libc で決める。`process.report.getReport().header.glibcVersionRuntime` が無ければ musl を先に（`linux-<arch>-musl` → `linux-<arch>`）、あれば glibc を先に試し、存在を確かめられた最初の path を使う。minify された source の該当部分は次のとおり。

  ```js
  function kqe(){if(process.platform!=="linux")return!1;let e=typeof process.report?.getReport==="function"?process.report.getReport():null;return e!=null&&e.header?.glibcVersionRuntime===void 0}
  ```

- 両方の libc の package が入った場合について。"If your package manager doesn't apply npm's `libc` field, as Yarn 1.x doesn't, you get both the glibc and musl platform packages on Linux ... On Agent SDK v0.2.141 or later, the SDK still launches the correct variant." [TypeScript reference](https://code.claude.com/docs/en/agent-sdk/typescript)
- path の末尾が `.js` `.mjs` `.tsx` `.ts` `.jsx` でなければ native binary とみなし、`executable`（`bun` `node` `deno`）を介さず直接 spawn する。`executable` の既定は `process.versions.bun` があれば `bun`、無ければ `node` だが、native binary では使われない。spawn の前に env から `NODE_OPTIONS` を消す。[sdk.mjs](https://cdn.jsdelivr.net/npm/@anthropic-ai/claude-agent-sdk@0.3.300/sdk.mjs)
- libc が合わないときの error 文。"Claude Code native binary at ${r} exists but failed to launch. This usually means the binary does not match this system's libc — e.g. spawning a musl-linked binary on a glibc Linux host fails because the musl dynamic loader (/lib/ld-musl-*) is missing." この説明は 0.3.178 で入った。[CHANGELOG L746](https://github.com/anthropics/claude-agent-sdk-typescript/blob/fbc529490ca0fb07b486c6f9c8e553d3fb7c690d/CHANGELOG.md#L746)
- container での失敗。"Claude Code can't start from a binary that doesn't match the container's architecture or libc, or from a file that lost its execute permission in the image build." 直し方は "reinstall the SDK during the image build so the bundled binary matches the container's platform, or rebuild the image for the architecture it runs on." [Troubleshooting](https://code.claude.com/docs/en/agent-sdk/troubleshooting#cliconnectionerror-failed-to-start-claude-code)
- 対応 OS は "Ubuntu 20.04+"、"Debian 10+"、"Alpine Linux 3.19+"、"x64 or ARM64 processor"。Alpine など musl の環境は "`libgcc`, `libstdc++`, and `ripgrep` at runtime" が要り、`USE_BUILTIN_RIPGREP=0` を設定する。[Advanced setup](https://code.claude.com/docs/en/setup#system-requirements)
- Bun の install は、`libc` を "only checked for `optionalDependencies`" とし、Linux では Bun 自身が build された libc の variant を入れる。`--os` `--cpu` `--libc`（`glibc` か `musl`）で別 platform 向けに入れられる。"Bun does not execute arbitrary lifecycle scripts like `postinstall` for installed dependencies." [bun install](https://bun.com/docs/pm/cli/install)
- Bun の `process.report.getReport()` は、glibc で build された Linux 版でだけ `header.glibcVersionRuntime` を入れる（`#ifdef __GNU_LIBRARY__`）。[BunProcess.cpp L2533-L2539](https://github.com/oven-sh/bun/blob/a407eae88ac76d2f54068b00a9f79c7b9ccc0f0f/src/jsc/bindings/BunProcess.cpp#L2533-L2539)

### Linux container と macOS host で変わること（推論）

- container の中で `bun install` すれば、container の arch と Bun の libc に合う package が 1 つだけ入る。SDK の libc 判定も Bun の build と同じ libc を指すので、glibc の image には glibc 版の Bun、Alpine には musl 版の Bun を使えば両者は食い違わない。
- macOS host で `bun install` した `node_modules` を image に copy すると darwin の package しか無く、`Native CLI binary for linux-arm64 not found` になる。host で用意するなら `bun install --os linux --cpu arm64 --libc glibc` のように対象を指定する。
- Apple Silicon の host で container を linux/arm64 として動かすなら、入れるのは `linux-arm64`（glibc の image）か `linux-arm64-musl`（Alpine）。Docker Desktop が既定でどの platform を使うかは #3 と #15 の範囲で、ここでは確かめていない。
- backend（macOS）にも SDK を入れる場合は `darwin-arm64` が入る。runner の image とは別の install になる。

## 3. Bun 上での起動・stream・cancel・resume

### 事実: 公式の docs と source が Bun について言っていること

- 公式 docs が runtime 要件に書くのは Node だけ。"Python 3.10+ for the Python SDK, or Node.js 18+ for the TypeScript SDK" [Hosting](https://code.claude.com/docs/en/agent-sdk/hosting#runtime-dependencies)、"Node.js 18+ or Python 3.10+" [Quickstart](https://code.claude.com/docs/en/agent-sdk/quickstart#prerequisites)。Bun を SDK の実行環境として支持する文は見つからなかった。TypeScript reference で Bun が出てくるのは、`bun build --compile` の節と、`executable` option の表（"`'bun' | 'deno' | 'node'` | Auto-detected | JavaScript runtime to use"）だけ。[TypeScript reference](https://code.claude.com/docs/en/agent-sdk/typescript)
- source と CHANGELOG は Bun を意識している。
  - `process.versions.bun` で Bun を検出し、`executable` の既定を変える。[sdk.mjs](https://cdn.jsdelivr.net/npm/@anthropic-ai/claude-agent-sdk@0.3.300/sdk.mjs)
  - 0.3.300: "Fixed `importSessionToStore` skipping transcript rows that contain a Unicode line or paragraph separator (U+2028, U+2029) on Node 24 and Bun" [CHANGELOG L5](https://github.com/anthropics/claude-agent-sdk-typescript/blob/fbc529490ca0fb07b486c6f9c8e553d3fb7c690d/CHANGELOG.md#L5)
  - 0.3.144: `bun build --compile` 向けの `./extract` export を追加。[CHANGELOG L897](https://github.com/anthropics/claude-agent-sdk-typescript/blob/fbc529490ca0fb07b486c6f9c8e553d3fb7c690d/CHANGELOG.md#L897)
  - 0.2.113: "Changed the SDK to spawn a native Claude Code binary (via a per-platform optional dependency) instead of bundled JavaScript" [CHANGELOG L1033](https://github.com/anthropics/claude-agent-sdk-typescript/blob/fbc529490ca0fb07b486c6f9c8e553d3fb7c690d/CHANGELOG.md#L1033)
  - 0.2.51: "Fixed SDK crashing with `ReferenceError` when used inside compiled Bun binaries (`bun build --compile`)" [CHANGELOG L1318](https://github.com/anthropics/claude-agent-sdk-typescript/blob/fbc529490ca0fb07b486c6f9c8e553d3fb7c690d/CHANGELOG.md#L1318)
- Bun の Node 互換表（Node.js v26 基準）。`node:child_process` は 🟡 で、spawn について "Missing `subprocess.channel.ref()`/`unref()`" などを挙げ、`signal` には触れていない。`node:process` は 🟡 で "`process.report.writeReport()` writes nothing." と書き、`getReport()` には触れていない。`require.resolve` は 🟢、`node:fs` と `node:stream` は 🟢。[Node.js compatibility](https://bun.com/docs/runtime/nodejs-compat)

### 事実: API の形（0.3.300 の `sdk.d.ts`）

出典はすべて [sdk.d.ts](https://cdn.jsdelivr.net/npm/@anthropic-ai/claude-agent-sdk@0.3.300/sdk.d.ts) と [TypeScript reference](https://code.claude.com/docs/en/agent-sdk/typescript)。

- **起動**: `query({ prompt, options })` が `Query`（`AsyncGenerator<SDKMessage, void>`）を返す。1 つの session が 1 つの CLI subprocess に対応する（"One agent session maps to one subprocess." [Hosting](https://code.claude.com/docs/en/agent-sdk/hosting#the-subprocess-model)）。`startup()` は prompt より先に subprocess を起こして initialize まで済ませる。`prewarm()`（alpha、0.3.282+）は session が決まる前の予備 process を作り、"A spare holds roughly 230 to 260 MB of memory while it waits."
- **stream**: generator を回して message を受ける。`includePartialMessages: true` で `SDKPartialAssistantMessage`（stream event）も届く。複数 turn は `prompt` に `AsyncIterable<SDKUserMessage>` を渡すか `streamInput()` を使う。
- **cancel**（3 通り）
  - `abortController`: "Controller for cancelling the query. When aborted, the query will stop and clean up resources."（`sdk.d.ts` L1529-L1533）。`SpawnOptions.signal` の説明では、abort は "stdin EOF → `GRACEFUL_EXIT_TIMEOUT_MS` (~2 s) grace window" の後に process を止める（L9641-L9663）。
  - `interrupt()`: control request で、"only supported when streaming input/output is used"（L2870-L2882）。現在の turn を止め、session は続く。CLI 2.1.205 以降は receipt を返す。interrupt で切れた assistant message には `aborted: true` が付く（0.3.214、[CHANGELOG L567](https://github.com/anthropics/claude-agent-sdk-typescript/blob/fbc529490ca0fb07b486c6f9c8e553d3fb7c690d/CHANGELOG.md#L567)）。
  - `close()`: "Close the query and terminate the underlying process. This forcefully ends the query, cleaning up all resources including pending requests, MCP transports, and the CLI subprocess."（L3257-L3265）
- **resume**: `resume: <sessionId>`、`continue`、`forkSession`、`sessionId`（UUID の指定）、`resumeSessionAt`。session ID は result message と init message にある。`persistSession: false` で disk に書かない。[Sessions](https://code.claude.com/docs/en/agent-sdk/sessions)

### 推論

- Bun 上で SDK が使う Node API は、`child_process.spawn`（stdio の pipe と AbortSignal）、`createRequire().resolve`、`fs`、stream で、互換表の 🟢 か 🟡 の範囲にある。CLI は Bun と無関係な native process なので、大きく壊れる可能性は低い。
- ただし `spawn` に渡す `signal` の扱い、stdout の行の分割、stderr が閉じるまで `exit` を遅らせる処理は互換表に記載が無い。#16 で確かめる。
- 公式は Bun での動作を保証していないので、Node を代案として残す。#16 が Node と比べる設計は妥当。

## 4. backend の `bun build --compile` と runner の切り分け

### 事実

- "When you compile your application into a single-file executable with `bun build --compile`, the SDK cannot resolve the bundled CLI binary at runtime. `require.resolve` does not work inside the compiled executable's `$bunfs` virtual filesystem, so the SDK throws `Native CLI binary for <platform>-<arch> not found`." 回避策は、`with { type: "file" }` で binary を埋め込み、`extractFromBunfs()`（0.3.144+）で取り出して `pathToClaudeCodeExecutable` に渡すこと。"Each compiled executable embeds a single platform's binary. Match the platform package in the import to your `--target`" [TypeScript reference の Compile to a single executable](https://code.claude.com/docs/en/agent-sdk/typescript)
- `extractFromBunfs()` は、`CLAUDE_CODE_TMPDIR` か、無ければ Linux では `os.tmpdir()`、macOS では `/tmp` の下の `claude-<uid>/claude-agent-sdk-<sha256 の先頭 16 桁>/claude` に書き出す。dir は 0700 で所有者を検査し、file は 0755、temp file と rename で原子的に置く。失敗すると警告を出して `$bunfs` の path を返し、その場合 CLI は起動できない。source のコメントは "child processes cannot access $bunfs" と書く。[extractFromBunfs.js](https://cdn.jsdelivr.net/npm/@anthropic-ai/claude-agent-sdk@0.3.300/extractFromBunfs.js)
- Bun の compile target は `bun-linux-x64` `bun-linux-arm64`（glibc）と `bun-linux-x64-musl` `bun-linux-arm64-musl`。`with { type: "file" }` の import は `/$bunfs/` で始まる path を返す。子 process から埋め込み file を読めるかは書かれていない。[Standalone executables](https://bun.com/docs/bundler/executables)
- hardened な container の例は `--tmpfs /tmp:rw,noexec,nosuid,size=100m` を使う。[Secure deployment](https://code.claude.com/docs/en/agent-sdk/secure-deployment#containers)
- npm 版 Claude Code について "The installed `claude` binary does not itself invoke Node." [Advanced setup](https://code.claude.com/docs/en/setup#install-with-npm)

### 推論

- backend（macOS、darwin-arm64）を compile するかどうかは runner の配布と独立している。backend が SDK を import しなければ、compile の制約は backend に関係しない。
- runner を compile すると、約 260 MB の CLI を埋め込み、起動のたびに書き込みも実行もできる temp が要る。hardened 例の `noexec` の tmpfs と衝突する。`CLAUDE_CODE_TMPDIR` を実行可能な volume に向ければ避けられるが、image に Bun と `node_modules` を入れる構成に比べて得るものが少ない。runner は compile しない案を推す。
- どちらでも、sandbox の中で動く CLI は JS runtime に依存しない。image に要る JS runtime は runner 用の 1 つだけになる。

## 5. session state の置き場所と runner の mount

### 事実

- "Three kinds of agent state live on the container's filesystem by default. None of them survive a container restart, a scale-down, or a move to a different node." transcript は "`~/.claude/projects/`, or the `projects/` directory under `CLAUDE_CONFIG_DIR` if set"、`CLAUDE.md` は user 層が `~/.claude/CLAUDE.md` で project 層が作業 dir、成果物は作業 dir。[Hosting](https://code.claude.com/docs/en/agent-sdk/hosting#state-that-lives-on-local-disk)
- file は `~/.claude/projects/<project>/<session-id>.jsonl`。`<project>` は作業 dir の絶対 path の英数字以外を `-` に置き換えたもので、200 文字を超えると切り詰めて hash を足す。"The entry format is internal to Claude Code and changes between versions, so scripts that parse these files directly can break on any release." 保持期間は既定 30 日（`cleanupPeriodDays`）。[Manage sessions](https://code.claude.com/docs/en/sessions#where-transcripts-are-stored)
- `CLAUDE_CODE_PROJECT_DIR_NAME` を `CLAUDE_CONFIG_DIR` と一緒に設定すると、`<project>` の名前を自分で決められる（CLI 2.1.234+、TS SDK 0.3.234+）。起動時の環境変数からだけ読まれ、settings の `env` では設定できない。[Manage sessions](https://code.claude.com/docs/en/sessions#name-the-project-directory-yourself)、[Hosting](https://code.claude.com/docs/en/agent-sdk/hosting#multi-tenant-isolation)
- resume の条件。"Same machine only: the session file still needs to exist on the current machine." 別 host で resume するには `SessionStore` を使うか、file を移すか、resume に頼らない。`SessionStore` について "The store lookup key derives from the working directory, so resume from a `cwd` matching the original run's." [Agent SDK Sessions](https://code.claude.com/docs/en/agent-sdk/sessions#resume-across-hosts)
- `SessionStore` は alpha で、"Mirror session transcripts to an external store. When set, the subprocess still writes to CLAUDE_CONFIG_DIR"（`sdk.d.ts` L1825-L1836）。mirror できるのは transcript だけで、失敗すると `mirror_error` を出して続行する。[Hosting](https://code.claude.com/docs/en/agent-sdk/hosting#session-and-state-persistence)
- `CLAUDE_CONFIG_DIR`: "All settings, session history, and plugins are stored under this path." [Environment variables](https://code.claude.com/docs/en/env-vars)。tenant ごとに分ける理由として "so tenants do not share the `~/.claude.json` global config" とある。[Hosting](https://code.claude.com/docs/en/agent-sdk/hosting#multi-tenant-isolation)
- `CLAUDE_CODE_TMPDIR` は CLI の内部 temp の置き場所で、末尾に `/claude-{uid}/` を足す。[Environment variables](https://code.claude.com/docs/en/env-vars)
- auto memory は `projects/<project>/memory/` にあり、`settingSources` に関係なく system prompt に入る。止めるには `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`。filesystem の設定を読まないなら `settingSources: []`。[Hosting](https://code.claude.com/docs/en/agent-sdk/hosting#multi-tenant-isolation)

### runner が mount するもの（推論）

| 用途 | 中身 | 扱い |
|---|---|---|
| `CLAUDE_CONFIG_DIR` | transcript、auto memory、`.claude.json`（推定）、plugin、cache | Conversation 単位の永続 volume、rw |
| `cwd` | 作業 dir と成果物 | Bot か Conversation 単位の mount |
| `CLAUDE_CODE_TMPDIR` | CLI の内部 temp | tmpfs |
| `HOME` | `CLAUDE_CONFIG_DIR` を設定しても HOME の下に書くものがあるか未確認 | #16 で確かめる |

- Conversation ごとに `CLAUDE_CONFIG_DIR` を分け、`CLAUDE_CODE_PROJECT_DIR_NAME` を固定すれば、`cwd` の path に左右されずに resume できる（docs の tenant の例からの推論）。
- transcript は内部形式で既定 30 日で消えるので、momo は会話の正本を `app.db` に持ち、SDK の session は resume 用の cache として扱う。transcript の JSONL を momo が parse しない。保持期間を伸ばすなら `cleanupPeriodDays` を設定する。
- mount した config から意図しない設定や記憶が入らないよう、`settingSources: []` と `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` を既定にする（記憶は momo 側で扱う前提。P7）。

## 6. モデル通信と資格情報

### 6.1 base URL と proxy（事実）

- `ANTHROPIC_BASE_URL`: "This tells Claude Code and the Agent SDK to send sampling requests to your proxy instead of the Claude API directly. Your proxy receives plaintext HTTP requests, can inspect and modify them (including injecting credentials), then forwards to the real API." [Secure deployment](https://code.claude.com/docs/en/agent-sdk/secure-deployment#configuring-claude-code-to-use-a-proxy)
- `HTTP_PROXY` / `HTTPS_PROXY`: "Claude Code and the Agent SDK respect these standard environment variables, routing all HTTP traffic through the proxy. For HTTPS, the proxy creates an encrypted CONNECT tunnel: it cannot see or modify request contents without TLS interception." 同上
- hosting の Auth and secrets: "the subprocess reads `ANTHROPIC_API_KEY` from its environment. Supply it from your secret manager, or set `ANTHROPIC_BASE_URL` to route model calls through a proxy that injects the key outside the container." [Hosting](https://code.claude.com/docs/en/agent-sdk/hosting#auth-and-secrets)
- gateway に求められること（Anthropic Messages 形式）。endpoint は `/v1/messages`（実際は `/v1/messages?beta=true`）と、任意の `/v1/messages/count_tokens`。`anthropic-beta` と `anthropic-version` は変えずに転送する。stream は event ごとに中継し、buffer しない。SSE の `ping` を落とさない。error の body は変えずに返す。body を書き換えず "inspect without modifying"。`system` 配列を並べ替えない。起動時に `HEAD /api/hello` の probe が来る（HTTP proxy を設定していると来ない）。[Gateway compatibility guide](https://code.claude.com/docs/en/llm-gateway-protocol)
- base URL を通らない通信がある。fast mode の可否確認と WebFetch の domain safety check は `api.anthropic.com` に直接行く。telemetry は gateway の資格情報を付けずに Anthropic へ送られる。`CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` は auto-update、telemetry、error reporting、feature flag の取得などを止めるが、WebFetch の preflight は止めない（`skipWebFetchPreflight: true` が別に要る）。[Connect to an LLM gateway](https://code.claude.com/docs/en/llm-gateway-connect#turn-off-traffic-outside-the-gateway-path)、[Environment variables](https://code.claude.com/docs/en/env-vars)
- `ANTHROPIC_BASE_URL` が first-party 以外の host を指すと MCP tool search が既定で無効になる（`ENABLE_TOOL_SEARCH=true` で戻す）。[Environment variables](https://code.claude.com/docs/en/env-vars)
- TLS を終端する proxy を挟むときは CA を trust に入れる。`NODE_EXTRA_CA_CERTS`、または `CLAUDE_CODE_CERT_STORE`（既定 `bundled,system`）。[Connect to an LLM gateway](https://code.claude.com/docs/en/llm-gateway-connect#troubleshoot-gateway-errors)、[Environment variables](https://code.claude.com/docs/en/env-vars)
- TS SDK の `env` は subprocess の環境を丸ごと置き換える。"When set, this value REPLACES the subprocess environment entirely — it is not merged with `process.env`."（`sdk.d.ts` L1651-L1669）

### 6.2 SDK が受け付ける資格情報（事実）

- `ANTHROPIC_API_KEY`: "API key sent as `X-Api-Key` header. ... In non-interactive mode (`-p`), the key is always used when present." [Environment variables](https://code.claude.com/docs/en/env-vars)
- `ANTHROPIC_AUTH_TOKEN`: "Custom value for the `Authorization` header (the value you set here will be prefixed with `Bearer `)" 同上
- `apiKeyHelper`: 資格情報を出力する command。値は `Authorization` と `x-api-key` の両方で送られ、既定 5 分 cache される。[Connect to an LLM gateway](https://code.claude.com/docs/en/llm-gateway-connect#rotate-credentials-with-apikeyhelper)
- third-party の provider: Amazon Bedrock（`CLAUDE_CODE_USE_BEDROCK=1`）、Claude Platform on AWS、Google Cloud の Agent Platform（`CLAUDE_CODE_USE_VERTEX=1`）、Microsoft Foundry（`CLAUDE_CODE_USE_FOUNDRY=1`）。[Quickstart](https://code.claude.com/docs/en/agent-sdk/quickstart#setup)
- `CLAUDE_CODE_OAUTH_TOKEN`: "OAuth access token for claude.ai authentication. Alternative to `/login` for SDK and automated environments." [Environment variables](https://code.claude.com/docs/en/env-vars)。使える条件は §6.4 の制約を受ける。

### 6.3 資格情報を sandbox の外に置けるか

事実:

- "The recommended approach is to run a proxy outside the agent's security boundary that injects credentials into outgoing requests. The agent sends requests without credentials, the proxy adds them, and forwards the request to its destination." [Secure deployment](https://code.claude.com/docs/en/agent-sdk/secure-deployment#the-proxy-pattern)
- 一方で CLI は資格情報が無いと login を求める。troubleshooting の表に "Claude Code asks you to log in even though the curl test succeeds | The CLI has no credential of its own: a reachable base URL isn't one" とある。[Connect to an LLM gateway](https://code.claude.com/docs/en/llm-gateway-connect#troubleshoot-gateway-errors)

推論:

- sandbox には実 key でない placeholder を `ANTHROPIC_API_KEY` か `ANTHROPIC_AUTH_TOKEN` に置き、securityd の model proxy は受けた credential header を捨てて実 key を付け直す。これで sandbox の中に秘密は残らない。
- placeholder を run ごとの短命の値にすれば、proxy が「どの run の要求か」を照合する材料にもなる。map の Not yet specified にある「実行 identity の発行と受け渡し」につながる。
- CLI が placeholder の形式を手元で検査するか、起動時に key の検証のため外へ出るかは docs に書かれていない。#16 で確かめる。
- model 通信は `ANTHROPIC_BASE_URL` 経由の plaintext HTTP で proxy に届くので、model 通信のために TLS 終端（MITM の CA）は要らない。CA が要るのは WebFetch などの外部 HTTPS を中継するときで、P8 の範囲になる。
- sandbox から securityd までの区間は plaintext HTTP になる。その経路を他の process から覗けない形にするのは #3 と #15 の範囲。

### 6.4 サードパーティ製品で使える認証方式の制約（事実）

- "Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK. Use the API key authentication methods described in the Quickstart instead." [Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview#get-started)（[Quickstart](https://code.claude.com/docs/en/agent-sdk/quickstart#setup) にも同文）
- "**Developers** building products or services that interact with Claude's capabilities, including those using the Agent SDK, should use API key authentication through Claude Console or a supported cloud provider. Anthropic does not permit third-party developers to offer Claude.ai login into their own applications, or to route requests through Free, Pro, or Max plan credentials on behalf of their users. Moreover, developers may not collect, store, or intermediate Claude.ai credentials or session tokens — sign-in to a Claude account must complete through Anthropic's own flow." [Legal and compliance](https://code.claude.com/docs/en/legal-and-compliance#authentication-and-credential-use)
- 同じ節の続き。"This does not restrict how customers provision and manage their own API keys or third-party inference provider credentials — for example, configuring an API key in a development environment, secrets manager, or machine image for use by the customer's own authorized users — provided the resulting usage is billed to the key owner under their agreement with Anthropic (or the applicable provider) and is not resold or intermediated as described above."
- "Advertised usage limits for Pro and Max plans assume ordinary, individual usage of Claude Code and the Agent SDK." [Legal and compliance](https://code.claude.com/docs/en/legal-and-compliance#acceptable-use)
- Agent SDK の利用は Commercial Terms に従う。"Use of the Claude Agent SDK is governed by Anthropic's Commercial Terms of Service, including when you use it to power products and services that you make available to your own customers and end users" [Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview#license-and-terms)
- 製品名に "Claude Code" や "Claude Code Agent" を使えない。[Agent SDK overview の Branding guidelines](https://code.claude.com/docs/en/agent-sdk/overview#branding-guidelines)

推論:

- securityd が Console の API key を Vault に置き、model proxy で注入する構成は「自分の API key を secrets manager で管理する」に当たり、文面と整合する。Bedrock などの cloud provider の資格情報も同じ扱いになる。
- Pro/Max の OAuth token（`CLAUDE_CODE_OAUTH_TOKEN`）を Vault に保存して注入する構成は、"collect, store, or intermediate Claude.ai credentials or session tokens" に当たる。ユーザー本人だけが使う local v1 でも、momo を製品とみなすかどうかで解釈が分かれる。agent はここを判断しない。#17 で決める（推奨は API key）。

## 7. SDK を sandbox の外に置く配置

### 事実

- `spawnClaudeCodeProcess`: "Custom function to spawn the Claude Code process. Use this to run Claude Code in VMs, containers, or remote environments." 受け取るのは `command` `args` `cwd` `env` `signal` で、`signal` は stdin EOF と約 2 秒の grace の後に abort する。（`sdk.d.ts` L2446-L2465、L9630-L9664）
- `prewarm()` の説明に "If your `spawnClaudeCodeProcess` runs Claude Code on another machine or in a container, set `options.cwd` to a directory that exists there for the spare to wait in." [TypeScript reference](https://code.claude.com/docs/en/agent-sdk/typescript)
- secure deployment が示す構成は、どれも SDK の application を境界の内側に置く。"In all of these configurations, Claude Code (or your Agent SDK application) runs inside the isolation boundary" [Secure deployment](https://code.claude.com/docs/en/agent-sdk/secure-deployment#isolation-technologies)

### 推論

- SDK を host の backend（Bun、macOS）で動かし、CLI だけを `docker exec -i` などで sandbox の中に起動する配置がとれる。`canUseTool`、hooks、in-process の MCP server が sandbox の外で動くので、承認の判定と Operation の発行を信頼する側に置ける。sandbox の中に要るのは CLI の binary だけで、Bun、Node、`node_modules` が要らなくなる。
- 代わりに、CLI の stdout（control protocol）は sandbox から来る信頼しない入力として扱う。`listSessions()` や `getSessionMessages()` は SDK 側の disk を読むので、`CLAUDE_CONFIG_DIR` を host 側からも読める必要がある。
- ROADMAP §1.1 は sandbox の中に「apps/agent-runner：TypeScript / Claude Agent SDK + CLI subprocess」を置く。この配置は決定ではなく、公式例とも違う選択肢なので、#17 か新しい decision ticket で比べる価値がある。

## 8. #16 で実測すること

#16 は実 Linux container で、偽の endpoint を相手に次を確かめる。試した SDK、同梱 CLI、Bun、Node、base image の digest、host の arch と Docker Desktop の版を記録する。

1. **install**: image build の中で `bun install` したとき、`node_modules/@anthropic-ai/` に入る platform package がどれか（glibc の image と Alpine の両方）、image の大きさ。macOS host で `bun install --os linux --cpu arm64 --libc glibc` した結果も比べる。
2. **binary の検証**: `node_modules/@anthropic-ai/claude-agent-sdk-linux-<arch>/claude` の sha256 が、署名を検証した release manifest（2.1.300）と一致するか。`claude --version` が 2.1.300 を返すか。
3. **解決**: `pathToClaudeCodeExecutable` 無しの `query()` が Bun で binary を解決するか。Bun で `process.report.getReport().header.glibcVersionRuntime` が出るか（glibc 版 Bun と musl 版 Bun）。
4. **base image の要件**: binary の動的依存（`ldd` など）、Bash tool のための shell、ripgrep（musl では `USE_BUILTIN_RIPGREP=0` と `ripgrep` の package）。
5. **書き込み先**: read-only の root fs と非 root の uid で動かし、書き込まれる path を全部記録する（`CLAUDE_CONFIG_DIR`、`.claude.json` の位置、`CLAUDE_CODE_TMPDIR`、`HOME` の下、`cwd`）。`noexec` の `/tmp` で動くか。
6. **placeholder の資格情報**: `ANTHROPIC_BASE_URL` を偽の endpoint に向け、`ANTHROPIC_API_KEY` と `ANTHROPIC_AUTH_TOKEN` のそれぞれに placeholder を置いて CLI が起動するか。endpoint が受けた method、path、header を全部記録する（`HEAD /api/hello`、`/v1/messages?beta=true`、`count_tokens`、`/v1/models` など）。
7. **base URL 以外の通信**: gateway 以外へ出られない network で、`CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` と `skipWebFetchPreflight: true` を付けたときと付けないときに、gateway 以外への DNS 解決や接続の試みが出るか。
8. **stream**: 偽の endpoint が SSE を小分けに返したとき、`includePartialMessages: true` の event が Bun 上で遅れずに届くか。`ping` だけが続く区間で idle timeout に当たらないか。
9. **cancel**: stream の途中で `abortController.abort()` したとき、約 2 秒以内に CLI が終わるか、Bash tool の子 process を含めて孤児が残らないか、generator が返す error と最後の message の形。streaming input mode での `interrupt()` の後に同じ session が続くか。`close()` の後の process 状態。
10. **resume**: session ID を取り、runner の process と container を作り直したあと、同じ `CLAUDE_CONFIG_DIR` の volume と同じ `cwd`（と `CLAUDE_CODE_PROJECT_DIR_NAME`）で `resume` できるか。`forkSession`、`persistSession: false` で何も書かれないこと。
11. **Node との比較**: 1〜10 を Node（22 か 24）で繰り返し、差を記録する。
12. **任意**: runner を `bun build --compile --target=bun-linux-arm64` で compile し `extractFromBunfs()` を使う場合の起動時間と temp の要件（#17 が compile を候補に残す場合だけ）。
13. **任意**: §7 の配置。host の Bun で SDK を動かし、`spawnClaudeCodeProcess` で container の CLI を起動して、stdio の protocol、abort の伝わり方、`cwd` の対応が成り立つか（#17 か新しい ticket がこの配置を候補に残す場合だけ）。

## 9. 未確認の点

- Bun 上の `child_process.spawn` での `signal`、stdout の行の分割、stderr が閉じるまで `exit` を遅らせる処理の挙動。
- CLI が placeholder の資格情報で起動し、proxy 以外へ通信しないか。
- `CLAUDE_CONFIG_DIR` を設定したときの `.claude.json` の場所と、`HOME` の下に書くものの有無。
- SDK の `manifest.json` にある `sdkCompat.testedWrapperVersions`（0.3.267〜0.3.285 を並べ、0.3.300 を含まない）の意味。
- Linux binary が必要とする glibc の最低版。docs は対応 distribution（Debian 10+、Ubuntu 20.04+）を書くだけ。
- Apple Silicon の Docker Desktop が既定で使う container の platform。
- 0.3.292 の manifest が CLI 2.1.292 を指すか。

## 10. map #1 への影響

- **新しい判断の候補**: SDK を sandbox の中に置くか、backend に置いて CLI だけを sandbox で動かすか（§7）。#17 の問いに足すか、別の decision ticket にする。
- **#17**（agent-runner の runtime・配布単位・モデル資格情報）: モデルの資格情報は Console の API key か cloud provider の資格情報に限るのが文面に沿う。subscription の OAuth token を Vault で仲介する案は §6.4 の制約に当たる。
- **#8**（Workspace・Bot・Conversation・Session・Connection・Grant の境界）: SDK の session は内部形式の transcript で、既定 30 日で消え、同じ machine でしか resume できない。会話の正本を `app.db` に置く前提の材料になる。
- **#3 / #14 / #15**（sandbox の egress）: model 通信は gateway への plaintext HTTP 1 経路で足りる。WebFetch などを使うなら HTTPS proxy と `api.anthropic.com` の preflight の扱いが加わる。
- 無効になる既存 ticket は無い。

## 出典

- Agent SDK overview: https://code.claude.com/docs/en/agent-sdk/overview
- Agent SDK quickstart: https://code.claude.com/docs/en/agent-sdk/quickstart
- Hosting the Agent SDK: https://code.claude.com/docs/en/agent-sdk/hosting
- Securely deploying AI agents: https://code.claude.com/docs/en/agent-sdk/secure-deployment
- TypeScript SDK reference: https://code.claude.com/docs/en/agent-sdk/typescript
- Agent SDK sessions: https://code.claude.com/docs/en/agent-sdk/sessions
- Agent SDK troubleshooting: https://code.claude.com/docs/en/agent-sdk/troubleshooting
- Manage sessions: https://code.claude.com/docs/en/sessions
- Environment variables: https://code.claude.com/docs/en/env-vars
- Other LLM gateways: https://code.claude.com/docs/en/llm-gateway
- Connect Claude Code to an LLM gateway: https://code.claude.com/docs/en/llm-gateway-connect
- Gateway compatibility guide: https://code.claude.com/docs/en/llm-gateway-protocol
- Advanced setup: https://code.claude.com/docs/en/setup
- Legal and compliance: https://code.claude.com/docs/en/legal-and-compliance
- npm registry: https://registry.npmjs.org/@anthropic-ai/claude-agent-sdk 、https://registry.npmjs.org/@anthropic-ai/claude-agent-sdk-linux-x64/0.3.300
- SDK 0.3.300 の file: https://cdn.jsdelivr.net/npm/@anthropic-ai/claude-agent-sdk@0.3.300/ （`README.md` `manifest.json` `extractFromBunfs.js` `sdk.d.ts` `sdk.mjs`）
- Claude Code 2.1.300 の release manifest: https://downloads.claude.ai/claude-code-releases/2.1.300/manifest.json
- SDK の CHANGELOG: https://github.com/anthropics/claude-agent-sdk-typescript/blob/fbc529490ca0fb07b486c6f9c8e553d3fb7c690d/CHANGELOG.md
- Bun Node.js compatibility: https://bun.com/docs/runtime/nodejs-compat
- bun install: https://bun.com/docs/pm/cli/install
- Bun standalone executables: https://bun.com/docs/bundler/executables
- Bun の `process.report` 実装: https://github.com/oven-sh/bun/blob/a407eae88ac76d2f54068b00a9f79c7b9ccc0f0f/src/jsc/bindings/BunProcess.cpp#L2533-L2539
