# DBを所有するdomain packageがDrizzleを直接使い、Repository層を作らない

DBを所有する各 `packages/<domain>` が自分のDrizzle schema・migration・`drizzle.config.ts` を持ち、domain関数はDrizzleで直接読み書きする。Repository interface/実装、汎用CRUD wrapper、schemaとmigrationを集める共通 `packages/storage` は作らない。SQLiteはテストで一時DBを立てられるので、差し替え用のportが無くても本物のDBで試験できる。D1/R2への移行はdriverの差し替えでは済まない再設計（ROADMAP P10）なので、そのための抽象化を先に作らない。

## Consequences

- domain別のmigration配置は物理DBの分割を意味しない。通常のdomainはbackend所有の `app.db` を共有し、適用の順序・直列化・domain別の履歴は `apps/backend` が取りまとめる。
- `security.db` のschema・migrationは `packages/security` が開発/build用の正本として持ち、生成SQLをRust buildへ渡す。実行時にこのDBを開くのはsecuritydだけで、TS側からは開かない。
