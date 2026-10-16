# momo

Workspace 分離型のパーソナル Bot プラットフォーム。

## Project の境界

- 要件を足す・変えるときは、先に `docs/planning/BRIEF.md` の固定要件と不変条件を読む。
- `docs/planning/` と ADR・GitHub issue が食い違ったら、ADR と issue に従う（`docs/planning/` は実装前の提案）。
- `apps/<app>` は entrypoint と配線を持ち、domain の処理は `packages/<domain>` と `crates/<crate>` に置く。
- DB を持つ domain は ADR-0001 に従う。domain 関数から Drizzle を直接呼び、migration を当てた一時 SQLite で試験する。
- table を足す・domain の持ち物を指示するときは、ADR-0008 の「table の持ち主」の表で domain を決める。
- ticket に着手したら、`docs/planning/SECURITY-ACCEPTANCE.md` のうち見出しの P 番号が今の milestone 以下の節を読み、ticket が触る経路に関わる項目をすべて完了条件に入れる。
- 作るのは、今の ticket と、`docs/planning/ROADMAP.md` 5 節にある今の milestone の gate が求めるところまでにする。
- ticket を閉じる前に、SECURITY-ACCEPTANCE の「K. 検証証拠のフォーマット」の表を ticket に添え、未実施・模擬・live を区別する。

## Agent skills

### Issue tracker

issue は GitHub の `ashigirl96/momo`（public）の Issues で管理し、`gh` CLI で操作する。詳細は `docs/agents/issue-tracker.md`。

### Triage labels

既定の 5 つの role を、role 名と同じ文字列のラベルで使う。詳細は `docs/agents/triage-labels.md`。

### Domain docs

single-context。root に `GLOSSARY.md` と `docs/adr/` を 1 つずつ置く。詳細は `docs/agents/domain.md`。
