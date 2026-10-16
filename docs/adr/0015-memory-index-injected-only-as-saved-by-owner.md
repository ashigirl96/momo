# Memory index は所有者が保存した版だけを Session に入れる

Bot は Memory index を書き換えられるが、書き換えは案として保留にする。Session の始めと compaction の後に入れるのは、所有者が保存した版だけにする。案は Bot ごとに 1 件で、所有者は案を出した Run の Conversation に出るカードか、Bot の設定画面で、差分を見て保存か破棄を選ぶ。保存を待つ間も Run は止めない。普通の Memory item は、今までどおり Bot が保存なしで書く。

こう決めたのは、Memory index が以後のすべての Session に自動で入るからである。Bot が外部の内容（メール、Slack、Web）に書かれた指示を Memory index に書き込むと、1 回の注入が、その Bot が参加するすべての Conversation の以後のすべての Session に効き続ける。Web への持ち出しは開いているので（ADR-0005）、以後の会話を外へ流させ続けることもできる。正当な好み（「返事は短く」）と注入された指示は、どちらも命令の形をしているので、中身からは見分けられない。止められるのは人が見ることだけである。毎回入るという点で、Memory index は所有者が保存する Bot の指示と同じ位置にあるので、同じ形にそろえた。NanoClaw `f2934ab` の `index.md` は agent が保存なしで書き換える。この点は NanoClaw より厳しい。

## Considered Options

- **変更を会話のカードで目立たせるだけにする（NanoClaw と同じ）。** 所有者が気づくまで、汚染は以後の Session に入り続ける。版を残さないので（ADR-0011）、気づいた後に戻す手がかりもカードの差分しかない。
- **外部の内容を読んだ Run からの変更だけ保存を求める。** Session の履歴に前の Run の tool の結果が残るので、判定は Session 単位になる。Bot が書いた Memory item を検索で読むことも外部の内容に数えるなら、ほぼすべての Session が対象になる。数えないなら、普通の Memory item を経由して素通りできる。
- **backend が Memory item の題から Memory index を組み立てる。** 新しい Memory item の題が自動で入り、保存を素通りする。防ぐには題の追加にも保存が要り、記憶が実質的に手動になる。

## Consequences

- 普通の Memory item は保存なしで書けるので、注入された記憶が検索で当たるたびに tool の結果として Session に入る。これは Gmail や Web を読むのと同じ入り方として受け入れる。書き込みは Bot の設定画面の一覧に出し、出典の Run からたどれるようにする。
- 汚染された内容は、その Session の履歴には reset まで残る。
- 案の保存は app.db の `memory` domain で扱い、securityd の Approval は使わない。外部 service への Operation ではないためである。
- 所有者が UI で直した Memory index は、保存した版としてそのまま効く。
- Bot が Memory index を読む tool は、案があれば「未保存」の印を付けて案を返す。Bot は保存待ちの間にまた書き換えると、その案を上書きする。案に期限は無い。
- 注入する Memory index には、Bot が書いた記憶だと分かる囲みと出典を付ける。これは多層防御で、境界ではない。
