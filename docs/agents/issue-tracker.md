# Issue tracker: GitHub

この repo の issue と spec は GitHub の issue に置く。操作はすべて `gh` CLI で行う。

この repo は public。issue・PR・comment に書いたものは、投稿した時点で誰でも読める。

## 操作

- **issue を作る**: `gh issue create --title "..." --body "..."`。複数行の本文は heredoc で渡す。
- **issue を読む**: `gh issue view <number> --json number,title,body,labels,comments`。
- **issue を一覧する**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` に、必要に応じて `--label` と `--state` の filter を付ける。
- **issue を親の sub-issue にする**: `gh issue create --parent <parent> ...`、または作った後に `gh issue edit <parent> --add-sub-issue <child>`（`gh` 2.94 以降）。古い `gh` では `gh api --method POST repos/<owner>/<repo>/issues/<parent>/sub_issues -F sub_issue_id=<child-db-id>`（database id。下の **Blocking** と同じ）。sub-issue が使えなければ、子の本文の先頭に `Part of #<parent>` と書く。
- **issue に comment する**: `gh issue comment <number> --body "..."`
- **label を付ける・外す**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **閉じる**: `gh issue close <number> --comment "..."`

repo は `git remote -v` から決まる。clone の中で動かせば `gh` が自動で判別する。

## spec の integration branch

spec を integration branch で実装するときは、最初の merge のあとに main 向けの draft PR を開き、本文に spec と各 ticket の `Closes #<n>` を書く。CI（`.github/workflows/ci.yml`）は main への push と `pull_request` でしか走らないため、PR が無い integration branch には CI がかからない。ticket は PR の merge で閉じる。

## Pull requests as a triage surface（PR を triage の対象にするか）

**PRs as a request surface: no.** _（外部からの PR を機能要望として扱う repo なら `yes` にする。`/triage` がこの flag を読む。）_

`yes` のときは、PR も issue と同じ label と状態で扱い、対応する `gh pr` の command を使う。

- **PR を読む**: `gh pr view <number> --comments`。diff は `gh pr diff <number>`。
- **triage する外部 PR を一覧する**: `gh api --paginate 'repos/{owner}/{repo}/pulls?state=open' --jq '.[] | select(.author_association | IN("OWNER","MEMBER","COLLABORATOR") | not) | {number, title, author: .user.login, author_association, labels: [.labels[].name]}'`。
- **comment・label・close**: `gh pr comment`、`gh pr edit --add-label`/`--remove-label`、`gh pr close`。

GitHub は issue と PR で番号を共有するので、`#42` だけではどちらか分からない。`gh pr view 42` で引き、無ければ `gh issue view 42` で引く。

## skill が "publish to the issue tracker" と言ったとき

GitHub issue を作る。

## skill が "fetch the relevant ticket" と言ったとき

上の **issue を読む** の手順で読む。

## Wayfinding operations（wayfinder の操作）

`/wayfinder` が使う。**map** は 1 つの issue で、その **child** の issue が ticket になる。

- **Map**: label `wayfinder:map` を付けた 1 つの issue。本文に Notes / Decisions-so-far / Fog を持つ。`gh issue create --label wayfinder:map`。
- **Child ticket**: map に GitHub の sub-issue としてつないだ issue（**issue を親の sub-issue にする** を参照）。sub-issue が使えなければ、map の本文の task list に子を足し、子の本文の先頭に `Part of #<map>` と書く。label は `wayfinder:<type>`（`research`/`prototype`/`grilling`/`task`）。claim した ticket は、進めている開発者に assign する。
- **Blocking**: GitHub の **native issue dependencies** を正本にする（UI にも出る）。依存を足すには `gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`。`<blocker-db-id>` は blocker の数値の **database id**（`gh api repos/<owner>/<repo>/issues/<n> --jq .id`。`#number` や `node_id` では _ない_）。GitHub は `issue_dependencies_summary.blocked_by` を返し、open の blocker だけを数えるので、これが現在の gate になる。dependencies が使えなければ、子の本文の先頭に `Blocked by: #<n>, #<n>` の行を置く。blocker がすべて close されたら ticket は unblock になる。
- **Frontier query**: map の open な子を一覧し（`gh issue list --state open` を map の sub-issue / task list に絞る）、open な blocker があるもの（`issue_dependencies_summary.blocked_by > 0`、または `Blocked by` 行に open な issue があるもの）と assignee がいるものを除く。残りのうち map での並びが先のものを取る。
- **Claim**: `gh issue edit <n> --add-assignee @me`。session で最初に行う書き込みにする。
- **Resolve**: `gh issue comment <n> --body "<answer>"`、次に `gh issue close <n>`、最後に map の Decisions-so-far へ context pointer（要旨と link）を足す。
