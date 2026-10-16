# migration は drizzle-kit で生成し、自前の runner で当てる

`app.db` と `security.db` の migration は、各 domain の Drizzle schema から drizzle-kit が SQL を生成する。適用には Drizzle の migrator を使わない。backend（TS）と securityd（Rust）がそれぞれ持つ小さな runner が当てる。drizzle-orm と drizzle-kit は `1.0.0-rc.4` に完全固定する。

runner の契約は次のとおり。

- 履歴は DB ごとに 1 つの `momo_migrations(domain, name, hash, applied_at, PRIMARY KEY (domain, name))` に持つ。`domain` は一度 release したら変えない。securityd の `domain` は `security` にする。
- 全 domain の migration を `(timestamp, domain, name)` の順に並べ、履歴に無いものを流す。
- 1 件ずつ `BEGIN IMMEDIATE` で流す。FK は transaction の外で OFF にする。COMMIT の前に、DB 全体の `foreign_key_check` が 0 件であることを確かめ、0 件でなければ roll back する。
- `hash` は `migration.sql` のバイト列の SHA-256 にする。次の場合は起動を止める。
  - 適用済みの migration の hash が変わっている。
  - DB にあって binary に無い migration がある。
  - 適用が失敗した。

こう決めたのは、Drizzle の migrator が 0.x でも v1 でも、1 回の run を 1 つの transaction で包むからである。そのため、table の再作成で出す `PRAGMA foreign_keys=OFF` が効かず、FK を ON にした接続では子の行が CASCADE で消えるか失敗する（drizzle-orm#5782、修正 PR は未 merge）。FK の違反を見つけても、自分で COMMIT するので roll back できない。hash も照合しない。Rust 側には drizzle-kit の出力をそのまま読める crate が無く、どの道 runner を書く。TS も同じ形にすれば、どちらの runner で作った DB も相手の runner で扱える。NanoClaw も、名前で判定し、FK を transaction の外で切る自前の runner を持っている。

## table の持ち主

`app.db` の table は、その行が表す GLOSSARY の語で domain を決める（#21）。

| domain | 持つもの |
|---|---|
| `workspace` | Workspace、Bot、Conversation とその参加者、Channel binding、Login |
| `agent` | Session、Run、Conversation の発言と event の記録、Attachment、Job |
| `memory` | Memory item とその全文検索の index |
| `connections` | Installation、Connection、Grant、ConnectionRequest、Operation の projection |

表に無い語の table を足すときは、先にこの表に行を足して domain を決める。既にある table がどの domain の migration に属するかは、`bun run db:check` の所有の検査が確かめる。

## Considered Options

- Drizzle の migrator を domain ごとに `migrationsTable` を分けて使う。標準機能で済むが、上の FK・roll back・hash の問題が残る。
- drizzle-orm 0.45 と drizzle-kit 0.31 の安定版。runtime は枯れているが、journal 形式から v1 の folder 形式に上げると migration の名前が変わり、所有者の DB の履歴を書き換える migration が要る。v1 は rc のまま止まっているが、利用者が所有者 1 人なので受け入れた。

## Consequences

- `app.db` では、domain をまたぐ参照も `(workspace_id, id)` の組の FK にする。ただし domain をまたぐ `ON DELETE CASCADE` は使わない。Workspace や Bot を消すときは、backend が各 domain の削除関数を参照の逆順に 1 つの transaction で呼ぶ。同じ domain の中では CASCADE を使ってよい。
- table を別の domain に移すと、移す先の `generate` は CREATE を、移す元は DROP を出す。どちらも手で空にする必要があるので、`app.db` は最初から `workspace`・`agent`・`memory`・`connections` に分けて始める。
- runner の関数は `packages/migrator` に置き、schema は持たせない。どの domain を当てるかの一覧は `apps/backend` が持つ。
- `security.db` の SQL は、securityd の crate の build.rs が `packages/security` の migration folder から直接埋め込む。複写は持たない。
- CI では次の 3 つを必須にする。
  - domain ごとに `drizzle-kit generate` を流して差分が出ないこと
  - `drizzle-kit check` が通ること
  - TS と Rust の runner で作った `security.db` の `sqlite_schema` が一致すること
- 古い momo に戻すと、新しい migration を当てた DB では起動しない。戻すには backup から restore する。
