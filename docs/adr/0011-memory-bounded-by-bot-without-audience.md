# 記憶の境界は Bot にし、audience を持たせない

Memory item に audience（公開範囲）を持たせない。Bot の Memory item は、その Bot が参加するすべての Conversation で同じものを引ける。所有者が channel に出したくない記憶を分けたいときは、channel 用に別の Bot を置く。Session の始めと compaction の後には、Bot が自分で保つ Memory index と固定の運用規則だけを入れ、ほかの Memory item は Bot が全文検索で引く。消すときも直すときも、版を残さずにその場で書き換える。

こう決めたのは、参照の NanoClaw と同じ形にするためである。NanoClaw の記憶は agent group ごとの Markdown の tree で、出典も audience も持たない。関わる人が違うなら agent group を分けるよう案内し、新しい session の始めと compaction の後に `index.md` と運用規則を context に入れる。momo では記憶が Bot に属するので、agent group を分ける運用は Bot を分ける運用になる。audience を設けても、他の人が読む channel と group DM への返信は毎回承認するので、記憶が人に漏れる経路はその承認で止まる。Web への持ち出しは ADR-0005 で既に受け入れている。

## Considered Options

- **書いた Conversation を誰が読めるかで、信頼側が `owner` と `shared` の 2 値を付ける。** `shared` の Conversation では `shared` の記憶だけを引く。DM で覚えたことを channel で使えなくなり、所有者が UI で広げる手間が増える。
- **Bot が書くときに audience を選ぶ。** LLM が範囲を広げられるので、境界として意味が薄い。
- **Session の始めに何も入れず、tool で引くだけにする。** 消した記憶が開いている Session に残らないが、Bot が自分から思い出すのは検索したときだけになる。
- **Bot の削除と編集で前の版を残し、所有者が戻せるようにする。** injection で記憶を消されても戻せるが、所有者が chat で「忘れて」と頼んだ記憶も DB に残る。

## Consequences

- SECURITY-ACCEPTANCE H の「audience 限定の検索」と「private 記憶を group Session の context へ無条件で入れない」を、Bot を境界にする形に書き換えた。
- Memory index を消したり直したりしても、開いている Session には compaction の後か次の Session まで残る。Agent SDK は system prompt と最初の context を Session に記録して使い回すためである。検索の索引にはすぐ反映し、UI の削除の画面にこの限界を表示する。
- 物理的に消すので、FTS5 の `secure-delete` と `PRAGMA secure_delete` を両方有効にする。FTS5 の既定では、消した行の本文を索引から復元できる。
- Bot が書き換えた Memory index は、所有者が保存するまで Session に入らない（ADR-0015）。
- Claude Code の CLAUDE.md と auto memory は読まない（`settingSources: []`、`CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`）。記憶の正本を app.db の Memory item だけにするためである。
