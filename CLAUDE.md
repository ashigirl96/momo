# momo

Workspace 分離型のパーソナル Bot プラットフォーム。要件・設計・順序は `docs/planning/README.md` から読む。

## Agent skills

### Issue tracker

issue は GitHub の `ashigirl96/momo`（public）の Issues で管理し、`gh` CLI で操作する。詳細は `docs/agents/issue-tracker.md`。

### Triage labels

既定の 5 つの role を、role 名と同じ文字列のラベルで使う。詳細は `docs/agents/triage-labels.md`。

### Domain docs

single-context。root に `GLOSSARY.md` と `docs/adr/` を 1 つずつ置く。詳細は `docs/agents/domain.md`。
