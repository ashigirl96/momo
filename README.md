# momo

Workspace 分離型のパーソナル Bot プラットフォーム。設計は `docs/adr/` と `GLOSSARY.md`、計画は `docs/planning/` にある。

## 動かす

Bun 1.4.3 と macOS が要る。

```sh
bun install
bun run start          # backend を http://momo.localhost:47317 で起動する
bun run open           # 別の terminal で。ブラウザでログイン済みの画面が開く
```

- データは `~/Library/Application Support/momo` に置く。`MOMO_DATA_DIR` で変えられる。
- port は `MOMO_PORT` で変えられる。port を変えると origin が変わり、既存の Login は効かなくなる。
- `bun run open -- --print` はブラウザを開かず pairing の URL を出す。URL は 1 分・1 回限り。

## 確かめる

```sh
bun test               # 全 package の試験。一時 dir と空いた port を使う
bun run lint           # oxlint
bun run format         # oxfmt で整形する（確かめるだけなら format:check）
bun run typecheck      # tsc
bun run db:check       # 各 domain の schema と migration に差分が無いか、drizzle-kit check が通るか
```

migration を足すときは `bun run db:generate <domain> <name>` で生成する。`--custom` を付けると手書きの SQL 用の空の migration になる。
