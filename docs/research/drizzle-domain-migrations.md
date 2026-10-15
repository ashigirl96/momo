# 共有 DB での domain 別 Drizzle migration と Rust への SQL の受け渡し

- 対象は [#7](https://github.com/ashigirl96/momo/issues/7)。ここで挙げた選択肢は [#21](https://github.com/ashigirl96/momo/issues/21) で決める。
- 確認日は 2026-10-15。npm registry、crates.io、GitHub の tag の source、公式 docs を読んだだけで、install・drizzle-kit の実行・実 DB での試験はしていない。
- domain 別の配置と Repository 層なしは [ADR-0001](../adr/0001-domain-packages-own-drizzle.md) で固定済みなので、採否は扱わない。
- 1〜5 節は事実だけを書き、引用と出典（版か tag 付きの URL）を添えた。推論は 6 節、未検証は 7 節に分けた。

## 要点

1. 2026-10-15 時点の npm の `latest` は drizzle-orm 0.45.4 と drizzle-kit 0.31.11。v1 は 1.0.0-rc.4（npm の `rc`、2026-06-27 公開）が最新で、stable は出ていない。v1 は migration folder の形と適用済みの判定方法を変えたので、どちらの版に乗るかで app.db の履歴の設計が変わる。
2. 0.x の migrator は、履歴 table の `created_at` の最大値より新しい migration だけを流す。二つの domain が一つの履歴 table を共有すると、片方の domain の migration が error も出さずに飛ばされる。0.x では domain ごとに `migrationsTable` を分けることになる。
3. v1 の migrator は folder 名（`20250220153045_brave_wolverine` の形）の集合で適用済みを判定し、未適用のものは timestamp に関係なく全部流す。履歴 table に domain を表す列は無い。
4. どちらの版も SQL 全体の SHA-256 を履歴に書くが、適用済みの SQL が後から書き換わっても比べない。
5. `drizzle-kit generate` は、schema の glob に一致した file が export する table だけを集め、その config の `out` にある前回の snapshot と比べる。他 package から import しただけの table の CREATE は出ず、他 domain の table の DROP も出ない。FK は参照先の table 名だけを書く。`tablesFilter` は push と pull 用で、generate には効かない。
6. migrator は 1 domain の未適用 migration をまとめて一つの `BEGIN … COMMIT` で流す。drizzle-kit が SQLite の table 再作成に入れる `PRAGMA foreign_keys=OFF;` は transaction の中では効かない。FK を ON にした接続で、参照される table を再作成すると、子 table の行が `ON DELETE CASCADE` で消えるか、migration が FK 違反で失敗する。cross-domain FK があれば、ある domain の migration が別 domain の行を消し得る。
7. security.db の SQL を Rust で流せる既存の crate（rusqlite_migration 2.6.0、refinery 0.10.0、sqlx 0.9.0）は、どれも drizzle-kit の folder をそのままでは読めない。どれも既定で migration を transaction で包むので、6 と同じ PRAGMA の問題も抱える。build.rs か `include_str!` で SQL を埋め込み、自前の runner か、名前を付け直した refinery で流すことになる。

## 調べた版

| 対象 | 版 | 確かめ方 |
|---|---|---|
| drizzle-orm | 0.45.4（npm `latest`、2026-10-08 公開） | npm registry。tag `0.45.4` は commit `eab8bed` |
| drizzle-kit | 0.31.11（npm `latest`、2026-09-21 公開） | npm registry。tag `drizzle-kit@0.31.11` は commit `15454db` |
| drizzle-orm / drizzle-kit v1 | 1.0.0-rc.4（npm `rc`、2026-06-27 公開、GitHub では prerelease） | tag `v1.0.0-rc.4` は commit `748058e` |
| @libsql/client | 0.18.0（npm `latest`、gitHead `9496c78`） | 比較用 |
| rusqlite_migration | 2.6.0 | crates.io の `max_stable_version`、tag `v2.6.0` |
| refinery | 0.10.0 | 同上、tag `v0.10.0` |
| sqlx | 0.9.0 | 同上、tag `v0.9.0` |
| rusqlite | 0.40.2 | 同上、tag `v0.40.2` |
| include_dir | 0.7.4 | docs.rs |

npm には `1.0.0-rc.5-5935859` のような commit ごとの build も上がっているが、`rc.5` の tag と release はまだない。公式 docs（orm.drizzle.team）は v1 の folder の形で書かれた箇所と 0.x の形で書かれた箇所が混ざっていて、どの版の説明かを明記していない。このため版ごとの挙動は docs ではなく tag の source で確かめた。

## 1. migration folder の形（版で違う）

### 0.x（drizzle-kit 0.31.11、drizzle-orm 0.45.4）

- 出力は `out/<tag>.sql`、`out/meta/_journal.json`、`out/meta/<prefix>_snapshot.json`。`writeResult` は journal に `{ idx, version, when: +new Date(), tag, breakpoints }` を追記し、`${outFolder}/${tag}.sql` を書く。[cli/commands/migrate.ts L1354-L1439](https://github.com/drizzle-team/drizzle-orm/blob/drizzle-kit@0.31.11/drizzle-kit/src/cli/commands/migrate.ts#L1354-L1439)
- tag の先頭は config の `migrations.prefix`（`index`・`timestamp`・`supabase`・`unix`・`none`）で選べて、既定の `index` では `0000` になる。[cli/validations/common.ts L75-L100](https://github.com/drizzle-team/drizzle-orm/blob/drizzle-kit@0.31.11/drizzle-kit/src/cli/validations/common.ts#L75-L100)、[utils/words.ts L3-L24](https://github.com/drizzle-team/drizzle-orm/blob/drizzle-kit@0.31.11/drizzle-kit/src/utils/words.ts#L3-L24)
- migrator は `meta/_journal.json` が無いと `Can't find meta/_journal.json file` で止まる。`journal.entries` の順に `<tag>.sql` を読み、journal の `when`（生成した時刻）を `folderMillis` にする。[drizzle-orm/src/migrator.ts L27-L55 @0.45.4](https://github.com/drizzle-team/drizzle-orm/blob/0.45.4/drizzle-orm/src/migrator.ts#L27-L55)

### v1（1.0.0-rc.4）

- 公式の移行 guide は「No more `journal.json`」「SQL files and snapshots grouped into separate migration folders」と書き、旧形式からは `drizzle-kit up` で移すとしている。[v0-v1-changes](https://orm.drizzle.team/docs/v0-v1-changes)
- 出力は `out/<YYYYMMDDHHMMSS>_<name>/migration.sql` と、同じ folder の `snapshot.json`。[cli/commands/generate-common.ts L67-L86](https://github.com/drizzle-team/drizzle-orm/blob/v1.0.0-rc.4/drizzle-kit/src/cli/commands/generate-common.ts#L67-L86)、[utils/words.ts L3-L10](https://github.com/drizzle-team/drizzle-orm/blob/v1.0.0-rc.4/drizzle-kit/src/utils/words.ts#L3-L10)
- snapshot は `{ version: '7', dialect: 'sqlite', id, prevIds, ddl, renames }`。`prevIds` は複数の親を持てる。guide によると `drizzle-kit check` は「Builds a DAG from snapshot `prevIds` to understand branch structure」で、generate も branch 間で両立しない変更を検出する。[dialects/sqlite/serializer.ts L26-L74](https://github.com/drizzle-team/drizzle-orm/blob/v1.0.0-rc.4/drizzle-kit/src/dialects/sqlite/serializer.ts#L26-L74)、[v0-v1-changes](https://orm.drizzle.team/docs/v0-v1-changes)
- migrator は `meta/_journal.json` を見つけると「We detected that you have old drizzle-kit migration folders. You must upgrade drizzle-kit and run "drizzle-kit up"」で止まる。folder を名前の `localeCompare` で並べ、名前の先頭 14 文字を UTC の時刻として `folderMillis` にする。[drizzle-orm/src/migrator.ts L49-L86 @v1.0.0-rc.4](https://github.com/drizzle-team/drizzle-orm/blob/v1.0.0-rc.4/drizzle-orm/src/migrator.ts#L49-L86)
- v1 の config の `migrations` は `{ table?, schema? }` だけで、0.x の `prefix` は無い。[drizzle-kit/src/index.ts L120-L123 @v1.0.0-rc.4](https://github.com/drizzle-team/drizzle-orm/blob/v1.0.0-rc.4/drizzle-kit/src/index.ts#L120-L123)

## 2. app.db で `drizzle-kit generate` がすること

### 2.1 schema・out・複数の config

- docs は `schema` を「glob based path to drizzle schema file(s) or folder(s) contaning schema files」とし、string か string[] を受ける。`out` の既定は `drizzle`。「You can have multiple config files in the project」とあり、`--config` で選ぶ。[drizzle-config-file](https://orm.drizzle.team/docs/drizzle-config-file)
- `breakpoints` の既定は `true` で、generate は SQL に `--> statement-breakpoint` を入れる。docs は SQLite と MySQL について「that's necessary for databases that do not support multiple DDL alternation statements in one transaction」と書く。同じ page。

### 2.2 何を生成対象にするか

- 0.31.11 は glob に一致した file を一つずつ `require` し、`Object.values(exports)` のうち `is(t, SQLiteTable)` のものだけを集める。[serializer/sqliteImports.ts L6-L40](https://github.com/drizzle-team/drizzle-orm/blob/drizzle-kit@0.31.11/drizzle-kit/src/serializer/sqliteImports.ts#L6-L40)
- v1 も export から同じように集める。[dialects/sqlite/drizzle.ts L229-L231 @v1.0.0-rc.4](https://github.com/drizzle-team/drizzle-orm/blob/v1.0.0-rc.4/drizzle-kit/src/dialects/sqlite/drizzle.ts#L229-L231)
- 比べる相手は DB ではなく、その config の `out` にある snapshot。0.31.11 の `prepareAndMigrateSqlite` は `prepareMigrationFolder(outFolder)` の snapshot と、schema から作った snapshot の差分を SQL にする。[cli/commands/migrate.ts L802-L860](https://github.com/drizzle-team/drizzle-orm/blob/drizzle-kit@0.31.11/drizzle-kit/src/cli/commands/migrate.ts#L802-L860)。v1 は `prepareOutFolder(outFolder)` の最後の snapshot と比べる。[cli/commands/generate-sqlite.ts L16-L28](https://github.com/drizzle-team/drizzle-orm/blob/v1.0.0-rc.4/drizzle-kit/src/cli/commands/generate-sqlite.ts#L16-L28)
- `tablesFilter` について、0.31.11 の型の doc comment は「param lets you filter tables with glob syntax for db push command」と書き、docs は対象の command を `push` と `pull` とする。generate の設定（0.31.11 の `prepareAndMigrateSqlite`、v1 の `prepareGenerateConfig`）は `tablesFilter` を読まない。[drizzle-kit/src/index.ts L74・L114 @drizzle-kit@0.31.11](https://github.com/drizzle-team/drizzle-orm/blob/drizzle-kit@0.31.11/drizzle-kit/src/index.ts#L74-L114)、[cli/commands/utils.ts L110-L160 @v1.0.0-rc.4](https://github.com/drizzle-team/drizzle-orm/blob/v1.0.0-rc.4/drizzle-kit/src/cli/commands/utils.ts#L110-L160)、[drizzle-config-file](https://orm.drizzle.team/docs/drizzle-config-file)

### 2.3 他 package の table を参照する FK

- FK は `fk.reference().foreignTable` から `getTableName` で名前を取り、snapshot に `tableTo` として残す。参照先の table が schema に含まれているかは見ない。[serializer/sqliteSerializer.ts L137-L166 @drizzle-kit@0.31.11](https://github.com/drizzle-team/drizzle-orm/blob/drizzle-kit@0.31.11/drizzle-kit/src/serializer/sqliteSerializer.ts#L137-L166)、[dialects/sqlite/drizzle.ts L113-L129 @v1.0.0-rc.4](https://github.com/drizzle-team/drizzle-orm/blob/v1.0.0-rc.4/drizzle-kit/src/dialects/sqlite/drizzle.ts#L113-L129)
- v1 の `interimToDDL` が出す error は、名前の衝突（`conflict_table`・`conflict_fk` など）と column の無い table だけで、参照先が無いことは error にしない。[dialects/sqlite/ddl.ts L221-L303 @v1.0.0-rc.4](https://github.com/drizzle-team/drizzle-orm/blob/v1.0.0-rc.4/drizzle-kit/src/dialects/sqlite/ddl.ts#L221-L303)
- SQLite も CREATE TABLE の時点では親 table の有無を見ない。「The English language error message for foreign key DML errors is usually "foreign key mismatch" but can also be "no such table" if the parent table does not exist.」親 table が無いことは DML error として、子や親の行を変える文を prepare するときに報告される。[SQLite foreignkeys §3](https://www.sqlite.org/foreignkeys.html)
- 親 table を rename すると、SQLite は子の FK 定義も書き換える。「the definitions of the foreign key constraints are modified to refer to the parent table by its new name」。[SQLite foreignkeys §5](https://www.sqlite.org/foreignkeys.html)

### 2.4 履歴 table の設定

- docs の `migrations` は `{ table, schema }` で、既定は `{ table: "__drizzle_migrations", schema: "drizzle" }`、対象の command は `migrate`・`push`・`pull`。SQLite で `schema` が効くかは書いていない。[drizzle-config-file](https://orm.drizzle.team/docs/drizzle-config-file)
- 0.31.11 の `drizzle-kit migrate` は SQLite にも `migrationsTable: table, migrationsSchema: schema` を渡すが、SQLite の migrator が読むのは `migrationsTable` だけ（3.1 節）。[cli/schema.ts L115-L190](https://github.com/drizzle-team/drizzle-orm/blob/drizzle-kit@0.31.11/drizzle-kit/src/cli/schema.ts#L115-L190)
- 0.31.11 の `drizzle-kit migrate` が SQLite に繋ぐ driver は `@libsql/client` か `better-sqlite3` で、どちらも無いと「Please install either 'better-sqlite3' or '@libsql/client' for Drizzle Kit to connect to SQLite databases」で止まる。bun:sqlite は使わない。rc.4 は `bun` と `node:sqlite` にも繋ぐ。[cli/connections.ts L1145-L1278 @drizzle-kit@0.31.11](https://github.com/drizzle-team/drizzle-orm/blob/drizzle-kit@0.31.11/drizzle-kit/src/cli/connections.ts#L1145-L1278)、[cli/connections.ts L2198-L2435 @v1.0.0-rc.4](https://github.com/drizzle-team/drizzle-orm/blob/v1.0.0-rc.4/drizzle-kit/src/cli/connections.ts#L2198-L2435)
- 0.31.11 の push と pull が DB を読むとき、除外する履歴 table は既定名の `__drizzle_migrations` だけ。[serializer/sqliteSerializer.ts L503](https://github.com/drizzle-team/drizzle-orm/blob/drizzle-kit@0.31.11/drizzle-kit/src/serializer/sqliteSerializer.ts#L503)

## 3. app.db の実行時の migrator

### 3.1 driver ごとの入口

- `drizzle-orm/bun-sqlite/migrator` と `drizzle-orm/better-sqlite3/migrator` は、`readMigrationFiles(config)` の結果を `db.dialect.migrate(migrations, db.session, config)` に渡すだけ。中身は SQLite の同期 dialect で共通。[bun-sqlite/migrator.ts @0.45.4](https://github.com/drizzle-team/drizzle-orm/blob/0.45.4/drizzle-orm/src/bun-sqlite/migrator.ts)、[better-sqlite3/migrator.ts @0.45.4](https://github.com/drizzle-team/drizzle-orm/blob/0.45.4/drizzle-orm/src/better-sqlite3/migrator.ts)
- `MigrationConfig` は `{ migrationsFolder, migrationsTable?, migrationsSchema? }`。SQLite の dialect は `config.migrationsTable ?? '__drizzle_migrations'` だけを読む。[migrator.ts L9-L13 @0.45.4](https://github.com/drizzle-team/drizzle-orm/blob/0.45.4/drizzle-orm/src/migrator.ts#L9-L13)、[sqlite-core/dialect.ts L949-L953 @0.45.4](https://github.com/drizzle-team/drizzle-orm/blob/0.45.4/drizzle-orm/src/sqlite-core/dialect.ts#L949-L953)
- libsql の migrator は SQL を batch にまとめて `db.session.migrate()` に渡し、最後は `@libsql/client` の `migrate` を呼ぶ。`@libsql/client` 0.18.0 の `migrate` は `PRAGMA foreign_keys=off` を `BEGIN` の前に流し、`finally` で `PRAGMA foreign_keys=on` に戻す。[libsql/migrator.ts @0.45.4](https://github.com/drizzle-team/drizzle-orm/blob/0.45.4/drizzle-orm/src/libsql/migrator.ts)、[libsql-client-ts sqlite3.ts L385-L428 @9496c78](https://github.com/tursodatabase/libsql-client-ts/blob/9496c782af413f6380235c7f5d0c97b5371f49b7/packages/libsql-client/src/sqlite3.ts#L385-L428)
- v1 の bun-sqlite の migrator は、folder の代わりに `{ sql, timestamp, name }[]`（`MigrationsJournal`）も受ける。このとき hash は空文字列になる。[bun-sqlite/migrator.ts L25-L37 @v1.0.0-rc.4](https://github.com/drizzle-team/drizzle-orm/blob/v1.0.0-rc.4/drizzle-orm/src/bun-sqlite/migrator.ts#L25-L37)

### 3.2 適用済みの判定

0.x（0.45.4）は、履歴 table の最新 1 行の `created_at` より `folderMillis` が大きい migration だけを流す。

```ts
const dbMigrations = session.values<[number, string, string]>(
  sql`SELECT id, hash, created_at FROM ${sql.identifier(migrationsTable)} ORDER BY created_at DESC LIMIT 1`,
);
// ...
if (!lastDbMigration || Number(lastDbMigration[2])! < migration.folderMillis) {
```

[sqlite-core/dialect.ts L955-L988 @0.45.4](https://github.com/drizzle-team/drizzle-orm/blob/0.45.4/drizzle-orm/src/sqlite-core/dialect.ts#L955-L988)。履歴 table は `id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric`。v1 の guide も旧挙動を「Previously the migrator only looked for local migrations with a creation date later than the last applied one.」と書いている。[v0-v1-changes](https://orm.drizzle.team/docs/v0-v1-changes)

v1（rc.4）は名前で判定する。

- 履歴 table は `id INTEGER PRIMARY KEY, hash text NOT NULL, created_at numeric, name text, applied_at TEXT`。[sqlite-core/async/session.ts L389-L396](https://github.com/drizzle-team/drizzle-orm/blob/v1.0.0-rc.4/drizzle-orm/src/sqlite-core/async/session.ts#L389-L396)
- 全行の `name` を読み、`localMigrations.filter((lm) => !lm.name || !dbNamesSet.has(lm.name))` を流す。[migrator.utils.ts L14-L23](https://github.com/drizzle-team/drizzle-orm/blob/v1.0.0-rc.4/drizzle-orm/src/migrator.utils.ts#L14-L23)。guide は「Migrations are now matched by their full folder name instead of timestamps.」「Now it detects and applies every missing migration, regardless of timestamp ordering.」と書く。
- 0.x の形の履歴 table を見つけると、列を足して `name` を埋める。このとき DB の行が local の migration のどれにも対応しなければ、「migrations in the database that do not match any local migration」を含む例外を投げる。[up-migrations/sqlite.ts L145-L150](https://github.com/drizzle-team/drizzle-orm/blob/v1.0.0-rc.4/drizzle-orm/src/up-migrations/sqlite.ts#L145-L150)

どちらの版も `hash` は INSERT するだけで、適用済みの行の hash と local の file の hash を比べる箇所は無い（0.45.4 の dialect.ts、rc.4 の migrator.utils.ts と async/session.ts）。

### 3.3 二つの domain が履歴 table を共有したとき、分けたとき

この節は 3.2 節の source から導いた挙動で、実 DB では試していない。

- 0.x で共有した場合。domain A と B が同じ `__drizzle_migrations` に書くと、`created_at` の最大値は両 domain の中で最新のものになる。B の未適用 migration の `when` がそれより古ければ、B の `migrate()` は何も流さずに正常終了する。
- 0.x で分けた場合。`migrate(db, { migrationsFolder: '<domain の drizzle folder>', migrationsTable: '__drizzle_migrations_<domain>' })` のように domain ごとに table 名を変えれば、各 domain の判定は自分の履歴だけで決まる。ただし同じ domain の中でも、後から merge した branch の migration の `when` が既に適用した migration より古いと飛ばされる。
- v1 で共有した場合。名前の集合で判定するので飛ばされはしない。ただし履歴の行に domain は残らず、名前が偶然同じ（同じ秒、同じ `--name`）だと片方が適用済みに見える。0.x の table から上げるときは、`migrate()` を呼んだ domain の local migration に対応しない行、つまり別 domain の行があるだけで例外になる。
- v1 で分けた場合。0.x と同じく `migrationsTable` を domain ごとに変えられる。

### 3.4 transaction と再実行

- 0.45.4 の同期 dialect は、履歴 table の `CREATE TABLE IF NOT EXISTS` と最新行の SELECT を transaction の外で流し、未適用の migration と履歴の INSERT をすべて一つの `BEGIN … COMMIT` に入れる。例外が出れば `ROLLBACK` して投げ直す。[sqlite-core/dialect.ts L962-L994](https://github.com/drizzle-team/drizzle-orm/blob/0.45.4/drizzle-orm/src/sqlite-core/dialect.ts#L962-L994)。rc.4 の `migrateSync` も同じ形。[sqlite-core/async/session.ts L433-L457](https://github.com/drizzle-team/drizzle-orm/blob/v1.0.0-rc.4/drizzle-orm/src/sqlite-core/async/session.ts#L433-L457)
- 1 回の `migrate()` が読むのは一つの folder だけ。外側で transaction を開いて複数の domain をまとめることもできない。SQLite は「Transactions created using BEGIN...COMMIT do not nest.」「An attempt to invoke the BEGIN command within a transaction will fail with an error, regardless of whether the transaction was started by SAVEPOINT or a prior BEGIN.」と書く。[lang_transaction](https://www.sqlite.org/lang_transaction.html)
- 未適用が無ければ、空の `BEGIN … COMMIT` が走るだけで DB は変わらない（上の source の読み取り）。

### 3.5 table の再作成と `PRAGMA foreign_keys`

- drizzle-kit は、ALTER で済まない SQLite の変更を `PRAGMA foreign_keys=OFF;`、`__new_<table>` の CREATE、INSERT … SELECT、旧 table の DROP、rename、`PRAGMA foreign_keys=ON;` の順で出す。[sqlgenerator.ts L3764-L3826 @drizzle-kit@0.31.11](https://github.com/drizzle-team/drizzle-orm/blob/drizzle-kit@0.31.11/drizzle-kit/src/sqlgenerator.ts#L3764-L3826)、[dialects/sqlite/convertor.ts L209-L224 @v1.0.0-rc.4](https://github.com/drizzle-team/drizzle-orm/blob/v1.0.0-rc.4/drizzle-kit/src/dialects/sqlite/convertor.ts#L209-L224)
- SQLite は「This pragma is a no-op within a transaction; foreign key constraint enforcement may only be enabled or disabled when there is no pending BEGIN or SAVEPOINT.」と書く。[pragma foreign_keys](https://www.sqlite.org/pragma.html#pragma_foreign_keys)
- SQLite は「If foreign key constraints are enabled when it is prepared, the DROP TABLE command performs an implicit DELETE to remove all rows from the table before dropping it. The implicit DELETE does not cause any SQL triggers to fire, but may invoke foreign key actions or constraint violations.」と書く。[foreignkeys §5](https://www.sqlite.org/foreignkeys.html)
- SQLite の table 変更の手順は、FK を transaction の前に切り、COMMIT の前に `PRAGMA foreign_key_check` を流し、COMMIT の後で戻す（12 手順の 1・2・10・11・12）。[lang_altertable](https://www.sqlite.org/lang_altertable.html)
- 上の三つが重なる問題は drizzle-orm の open issue [#5782](https://github.com/drizzle-team/drizzle-orm/issues/5782)（2026-05-19 起票）に報告されている。drizzle-orm 0.44.7 と drizzle-kit 0.31.7 で起き、0.45.2 の source でも同じと書かれている。`ON DELETE CASCADE` の子 table の行が error なしに消える。rc.4 では、複数の table を消す generate が DROP を名前順に並べ、親を子より先に消して失敗するという報告もある（[#6251](https://github.com/drizzle-team/drizzle-orm/issues/6251)、open）。
- SQLite の FK の既定は OFF。「As of SQLite version 3.6.19, the default setting for foreign key enforcement is OFF.」[pragma foreign_keys](https://www.sqlite.org/pragma.html#pragma_foreign_keys)。したがって問題が起きるのは、`migrate()` を呼ぶ接続で FK を ON にしているときに限られる。

## 4. Drizzle の SQL の書式で注意する点

- 区切りは `'--> statement-breakpoint\n'`。`breakpoints: false` なら文を `'\n'` でつなぐ。[cli/commands/migrate.ts L1354・L1416 @drizzle-kit@0.31.11](https://github.com/drizzle-team/drizzle-orm/blob/drizzle-kit@0.31.11/drizzle-kit/src/cli/commands/migrate.ts#L1354-L1416)
- 実行時は file 全体を `split('--> statement-breakpoint')` で切り、片ごとに `session.run(sql.raw(stmt))` で流す。bun-sqlite の session は片ごとに `client.prepare(query.sql)` する。[migrator.ts L44 @0.45.4](https://github.com/drizzle-team/drizzle-orm/blob/0.45.4/drizzle-orm/src/migrator.ts#L44)、[bun-sqlite/session.ts L56 @0.45.4](https://github.com/drizzle-team/drizzle-orm/blob/0.45.4/drizzle-orm/src/bun-sqlite/session.ts#L56)。`generate --custom` で手書きする migration も、文の間に区切りを入れておく。
- `--> statement-breakpoint` は SQL の行 comment なので、file 全体を一度に流す runner でも害はない。SQLite は「SQL comments begin with two consecutive "-" characters (ASCII 0x2d) and extend up to and including the next newline character (ASCII 0x0a) or until the end of input, whichever comes first.」「Comments are treated as whitespace by the parser.」と書く。[lang_comment](https://www.sqlite.org/lang_comment.html)
- hash は区切りを含む file 全体の SHA-256（0.45.4 と rc.4 の `crypto.createHash('sha256').update(query)`）。改行や区切りの位置を変えるだけで hash も変わる。[migrator.ts L52 @0.45.4](https://github.com/drizzle-team/drizzle-orm/blob/0.45.4/drizzle-orm/src/migrator.ts#L52)、[migrator.ts L82 @v1.0.0-rc.4](https://github.com/drizzle-team/drizzle-orm/blob/v1.0.0-rc.4/drizzle-orm/src/migrator.ts#L82)
- table 再作成の片には `PRAGMA foreign_keys=OFF;` と `PRAGMA foreign_keys=ON;` が独立した文として入る（3.5 節）。Rust の runner でも transaction の中で流せば効かない。
- `generate --custom` は `-- Custom SQL migration file, put your code below! --` だけの file を作り、snapshot は前回の内容のまま新しい id で進む。[cli/commands/migrate.ts L1424-L1427 @drizzle-kit@0.31.11](https://github.com/drizzle-team/drizzle-orm/blob/drizzle-kit@0.31.11/drizzle-kit/src/cli/commands/migrate.ts#L1424-L1427)、[dialects/sqlite/serializer.ts L76-L87 @v1.0.0-rc.4](https://github.com/drizzle-team/drizzle-orm/blob/v1.0.0-rc.4/drizzle-kit/src/dialects/sqlite/serializer.ts#L76-L87)

## 5. security.db を Rust に渡して適用する方法

### 5.1 既存の crate

| | rusqlite_migration 2.6.0 | refinery 0.10.0 | sqlx 0.9.0（SQLite） |
|---|---|---|---|
| 入力の名前 | `{id}-{name}/up.sql`。id は 1 からの連番 | `V{n}__{name}.sql`（正規表現 `^([U\|V])(\d+(?:\.\d+)?)__(\w+)`） | `<VERSION>_<DESCRIPTION>.sql`。directory の直下だけ読む |
| drizzle の folder をそのまま読めるか | 読めない。0.x の `0000` は id 0 で拒否され、v1 の folder は形が違う | 読めない。名前の形が違う | 0.x の平らな形は読める可能性がある（`meta/` は無視される）。v1 の folder は読めない |
| 名前を付け直す手 | `M::up(include_str!(..))` を並べる | `Migration::unapplied("V1__name", sql)` と `Runner::new` | 無し（macro が directory を読む） |
| 履歴 | `PRAGMA user_version` | table（既定 `refinery_schema_history`、名前を変えられる） | table `_sqlx_migrations` |
| checksum | 無し | SipHasher13（name・version・SQL）。既定で不一致と欠落を拒否 | SHA-384。不一致は `VersionMismatch` |
| transaction | 未適用の全部を一つ | 既定は migration ごと。ただし履歴の INSERT は別の transaction。`set_grouped(true)` で全部を一つ | migration と履歴の INSERT を一つ。file の先頭に `-- no-transaction` を書くとその file は transaction の外 |
| rusqlite との同居 | rusqlite 0.40 に依存 | rusqlite `>= 0.23, <= 0.40` | libsqlite3-sys `>=0.30.1, <0.38.0` を要求し、rusqlite 0.40.2 が使う 0.38.2 と同じ build に入らない |

出典はいずれも tag の source。

- rusqlite_migration: directory の形は [lib.rs L441-L481](https://github.com/cljoly/rusqlite_migration/blob/v2.6.0/rusqlite_migration/src/lib.rs#L441-L481)。「migration id cannot be 0」「Migration ids must be consecutive numbers」は [loader.rs L69-L144](https://github.com/cljoly/rusqlite_migration/blob/v2.6.0/rusqlite_migration/src/loader.rs#L69-L144)。「This library uses the user_version value instead」は [README.md L48](https://github.com/cljoly/rusqlite_migration/blob/v2.6.0/rusqlite_migration/README.md#L48)。一つの transaction で流す処理は [lib.rs L618-L654](https://github.com/cljoly/rusqlite_migration/blob/v2.6.0/rusqlite_migration/src/lib.rs#L618-L654)。[lib.rs L311-L312](https://github.com/cljoly/rusqlite_migration/blob/v2.6.0/rusqlite_migration/src/lib.rs#L311-L312) は「Please make sure you **do not** call `PRAGMA foreign_keys` from inside the migrations, as it would be a no-op (each migration is run inside a transaction).」と書き、migrate の前に FK を切って後で戻す例を載せている。
- refinery: 名前の正規表現は [refinery_core/src/util.rs L15](https://github.com/rust-db/refinery/blob/v0.10.0/refinery_core/src/util.rs#L15)。checksum は [runner.rs L81-L96](https://github.com/rust-db/refinery/blob/v0.10.0/refinery_core/src/runner.rs#L81-L96)、`abort_divergent`・`abort_missing`・`set_migration_table_name` は [runner.rs L234-L349](https://github.com/rust-db/refinery/blob/v0.10.0/refinery_core/src/runner.rs#L234-L349)。table 定義は [traits/mod.rs L107-L134](https://github.com/rust-db/refinery/blob/v0.10.0/refinery_core/src/traits/mod.rs#L107-L134)。grouped でないときは SQL と履歴の INSERT を別々に `transaction.execute` し（[traits/sync.rs L84-L99](https://github.com/rust-db/refinery/blob/v0.10.0/refinery_core/src/traits/sync.rs#L84-L99)）、rusqlite の driver は `execute` のたびに `self.transaction()`、`execute_batch`、`commit` する（[drivers/rusqlite.rs L33-L47](https://github.com/rust-db/refinery/blob/v0.10.0/refinery_core/src/drivers/rusqlite.rs#L33-L47)）。rusqlite の版の範囲は [refinery_core/Cargo.toml L40](https://github.com/rust-db/refinery/blob/v0.10.0/refinery_core/Cargo.toml#L40)。
- sqlx: 名前の規則と「If a migration's hash changes and it has already been run, this will cause an error.」は [sqlx-core/src/migrate/source.rs L13-L26](https://github.com/launchbadge/sqlx/blob/v0.9.0/sqlx-core/src/migrate/source.rs#L13-L26)、directory の読み方と `-- no-transaction` は [source.rs L165-L234](https://github.com/launchbadge/sqlx/blob/v0.9.0/sqlx-core/src/migrate/source.rs#L165-L234)。`Sha384::digest` は [migration.rs L86-L88](https://github.com/launchbadge/sqlx/blob/v0.9.0/sqlx-core/src/migrate/migration.rs#L86-L88)。table と transaction は [sqlx-sqlite/src/migrate.rs L93-L176](https://github.com/launchbadge/sqlx/blob/v0.9.0/sqlx-sqlite/src/migrate.rs#L93-L176)、不一致の扱いは [migrator.rs L249-L276](https://github.com/launchbadge/sqlx/blob/v0.9.0/sqlx-core/src/migrate/migrator.rs#L249-L276)。libsqlite3-sys の範囲は [sqlx-sqlite/Cargo.toml L57-L59](https://github.com/launchbadge/sqlx/blob/v0.9.0/sqlx-sqlite/Cargo.toml#L57-L59) と「Only one version of libsqlite3-sys may appear in the dependency tree」の [sqlx-sqlite/src/lib.rs L5](https://github.com/launchbadge/sqlx/blob/v0.9.0/sqlx-sqlite/src/lib.rs#L5)、rusqlite 側は [Cargo.toml L178 @v0.40.2](https://github.com/rusqlite/rusqlite/blob/v0.40.2/Cargo.toml#L178)。

ほかに、第三者の Rust ORM の [drizzle-rs](https://github.com/themixednuts/drizzle-rs)（MIT、star 45）が `drizzle-migrations` crate 0.4.0（2026-10-09 公開）を出している。v1 の `<tag>/migration.sql` を読み、`--> statement-breakpoint` で切り、`__drizzle_migrations` に SHA-256 を書き、未適用は名前で判定する（[migrations/src/migrator.rs L505-L602 @v0.4.0](https://github.com/themixednuts/drizzle-rs/blob/v0.4.0/migrations/src/migrator.rs#L505-L602)）。rusqlite での使い方と、書き換えた適用済み migration を拒むかは確かめていない。

自前で書く場合の部品は次の二つ。

- rusqlite 0.40.2 の `Connection::execute_batch` は「Convenience method to run multiple SQL statements」で、残りの文字列を prepare しながら全部流す。[src/lib.rs L527-L567](https://github.com/rusqlite/rusqlite/blob/v0.40.2/src/lib.rs#L527-L567)。`Transaction` は「Transactions will roll back by default」。[src/transaction.rs L40-L45](https://github.com/rusqlite/rusqlite/blob/v0.40.2/src/transaction.rs#L40-L45)
- `PRAGMA user_version` は「the user-version integer at offset 60 in the database header」で、「SQLite makes no use of the user-version itself.」。[pragma user_version](https://www.sqlite.org/pragma.html#pragma_user_version)

### 5.2 build への取り込み

- `include_str!` の path は「located relative to the current file」。[std::include_str](https://doc.rust-lang.org/std/macro.include_str.html)
- `include_dir!` 0.7.4 は相対 path を避けて `$CARGO_MANIFEST_DIR` を使うよう勧める。file ごとに `include_bytes!` を出すが、新しく足した file を追跡するのは `nightly` feature を有効にしたときだけ。[docs.rs include_dir 0.7.4](https://docs.rs/include_dir/0.7.4)
- build script の `rerun-if-changed` は directory を指すと「it will scan the entire directory」。build script の作業 directory は package の root で、「Scripts should not modify any files outside of that directory」（`OUT_DIR` に書く）。[Cargo book build-scripts](https://doc.rust-lang.org/cargo/reference/build-scripts.html)
- `cargo package` は作った `.crate` を展開して build し直す。package の外の file は `.crate` に入らない。[cargo package](https://doc.rust-lang.org/cargo/commands/cargo-package.html)
- sqlx-cli には、`rerun-if-changed` を書いた build.rs を作る `sqlx migrate build-script` がある。[sqlx-cli/src/migrate.rs L428-L451 @v0.9.0](https://github.com/launchbadge/sqlx/blob/v0.9.0/sqlx-cli/src/migrate.rs#L428-L451)
- build 時に manifest や hash を検査する既存の crate は、`drizzle-migrations` 以外に見つからなかった。

### 5.3 開発時の snapshot との整合

- docs によると `drizzle-kit check` は「lets you check consistency of your generated SQL migrations history」。schema の file と最新の snapshot の差（generate のし忘れ）を見るかは書かれていない。[drizzle-kit-check](https://orm.drizzle.team/docs/drizzle-kit-check)
- `drizzle-kit generate` は差分が無いと「No schema changes, nothing to migrate」と出して何も書かない。[cli/commands/migrate.ts L1385-L1391 @drizzle-kit@0.31.11](https://github.com/drizzle-team/drizzle-orm/blob/drizzle-kit@0.31.11/drizzle-kit/src/cli/commands/migrate.ts#L1385-L1391)

## 6. 推論

1. 0.x に乗るなら、app.db の履歴 table は domain ごとに分ける必要がある。共有すると migration が黙って飛ばされる（3.3 節）。v1 なら共有しても飛ばされないが、domain は名前にしか残らず、0.x の table からの upgrade で例外になる。v1 でも分けるほうが扱いやすい。
2. domain 間の適用順を Drizzle は持たない。backend の `migrate.ts` が cross-domain FK の依存に沿った domain の順を持ち、domain ごとに `migrate()` を順に呼ぶことになる。SQLite は CREATE TABLE の時点で親の有無を見ないので、順を間違えても最初の起動では気づかず、子に INSERT したときに "no such table" で初めて表に出る。
3. cross-domain FK は子の domain の snapshot に親の table 名で残り、親の domain の generate からは見えない。親の domain が table を再作成すると、子の domain の行が `ON DELETE CASCADE` で消える。親の table を rename すると SQLite が子の FK 定義を書き換えるが、子の snapshot は古い名前のままなので、子の次の generate が FK の変更として子の table を再作成するおそれがある。
4. stock の migrator で取れる最小の対策は、`migrate()` を呼ぶ接続の `foreign_keys` を OFF にしておき、全 domain の migrate の後に `PRAGMA foreign_key_check` を流し、それから ON に戻すこと。stock の migrator は自分で COMMIT するので、check で違反が見つかっても roll back はできない。COMMIT の前に check したいなら、適用の loop を自前で書くことになる。
5. schema の glob が、他 domain の table を re-export する file（`index.ts` など）に当たると、他 domain の CREATE が混ざる。glob を `src/schema.ts` のように狭くするか、生成した SQL に他 domain の table 名が出ないかを CI で検査する。
6. Rust で drizzle の SQL を流すには、どの crate でも file 名か読み込み方を変える必要がある。drizzle の名前と hash を保ったまま流せるのは、build.rs で `packages/security/drizzle/` を読んで `(name, sql, sha256)` の配列を `OUT_DIR` に書き、自前の runner で流す形か、`drizzle-migrations` crate。refinery は `Migration::unapplied` で名前を付け直せるが、v1 の 14 桁の timestamp は既定の i32 に入らない（`int8-versions` が要る）。grouped でなければ履歴の INSERT が別の transaction なので、間で process が落ちると次の起動で同じ migration をもう一度流す。sqlx は libsqlite3-sys の版が rusqlite 0.40 とぶつかり、async runtime も持ち込む。
7. Rust の履歴 table を drizzle v1 と同じ形（`__drizzle_migrations(id, hash, created_at, name, applied_at)`）にすれば、開発時に drizzle-kit や Drizzle の migrator で security.db の dev 用の copy を扱える。Rust 側で hash も比べれば、書き換えた適用済み SQL を起動時に拒める。
8. Rust の runner も、table 再作成の PRAGMA を transaction の外に出す必要がある。rusqlite_migration の docs が勧める手順（migrate の前に FK を OFF、後で ON）と同じ考え方になる。
9. 整合の検査は三つで足りそう。CI で `drizzle-kit generate` を流して差分が出ないこと、`drizzle-kit check` が通ること、Rust の test で埋め込んだ SQL を空の DB に流した `sqlite_schema` と、Drizzle の migrator で作った DB の `sqlite_schema` が一致すること。SQL を Rust の crate に複写する形なら、複写と元の hash の一致も検査に加える。
10. backend を `bun build --compile` で一つの binary にするなら、0.x の bun-sqlite の migrator は folder を file system から読むので、folder を binary の横に置く必要がある。v1 の bun-sqlite の migrator は SQL の配列を直接受けるので埋め込める（3.1 節）。ただしこの経路では hash が空文字列になる。

## 7. 未検証

- 3.3 節と 3.4 節の挙動は source を読んで導いたもので、実 DB では流していない。P2 の最初の縦切りで確かめる。
- bun:sqlite の `prepare` に複数の文を含む片を渡したときの挙動（先頭の文だけ流すか、error になるか）。
- v1 の push と pull が、名前を変えた履歴 table を除外するか（0.31.11 は既定名だけを除外する）。
- `drizzle-kit check` が schema の generate のし忘れを検出するか。
- refinery で v1 の timestamp を version に使えるか（`int8-versions` の実際の挙動）。
- sqlx が version 0（`0000_x.sql`）を実行時に受け付けるか。docs は「greater than zero」と書くが、code は拒んでいないように見える。
- `drizzle-migrations` crate の rusqlite での使い方と、書き換えた適用済み migration を拒むか。
- v1 が stable になる時期と、rc.4 の後に migrator や folder の形が変わるか。

## 8. #21 が選ぶもの

1. Drizzle の版。0.x（drizzle-orm 0.45 系と drizzle-kit 0.31 系。journal、`created_at` の最大値で判定）か、v1 rc（folder の形、名前で判定、`prevIds` による branch 間の衝突検出、drizzle-kit が bun:sqlite に繋がる）か。folder の形と履歴 table の列が決まるので、後から戻しにくい。
2. app.db の履歴 table の分け方。
   - a. domain ごとの `migrationsTable`（例 `__drizzle_migrations_<domain>`）と stock の migrator。
   - b. 一つの table を共有する（v1 でだけ成り立つ）。
   - c. backend の自前の runner。drizzle-kit は生成だけに使い、`(domain, name, hash, applied_at)` を持つ一つの履歴 table、hash の照合、PRAGMA の扱い、全 domain の順を自分で持つ。
3. domain 間の適用順の宣言。backend の `migrate.ts` に順を直接書くか、各 domain が依存先を宣言して backend が並べるか。
4. cross-domain FK の扱い。FK を張って親の domain の table 再作成を review で止めるか、id だけを持って FK を張らないか。domain をまたぐ `ON DELETE CASCADE` を許すか。
5. table 再作成と FK への対策。migrate 用の接続で FK を OFF にして後から `foreign_key_check` するか、自前の runner で COMMIT の前に check するか、table 再作成を含む生成 SQL を CI で検出して手で書き直すか。
6. security.db の SQL の渡し方。build.rs が `packages/security/drizzle/` を直接読むか、TS 側の script が Rust の crate の中に複写して commit するか。
7. securityd の runner。自前（rusqlite、drizzle v1 と同じ形の履歴 table、hash の照合）、refinery（名前を付け直す）、rusqlite_migration（`user_version`、checksum なし）、`drizzle-migrations` crate のどれか。
8. 整合の検査で必須にするもの。CI での generate の差分なし、`drizzle-kit check`、両方の runner で作った `sqlite_schema` の比較、hash の manifest。
