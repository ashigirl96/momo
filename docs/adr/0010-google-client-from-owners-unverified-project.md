# Google の OAuth client は所有者が自分の未検証の project に作る

v1 の Google 接続では、momo は共有の OAuth client を持たない。所有者が自分の Cloud project に Desktop client を作り、その JSON を momo に貼る。project の公開状態は In production にして、Google の検証は申請しない。同意のたびに出る未検証 app の警告は、所有者が押し進める。会社の Google アカウントも同じ手順でつなぎ、External と Internal のどちらの project を使うかは所有者が選ぶ。

こう決めたのは、共有の client では Google の規約と審査を満たせないからである。Google は client の資格情報を公開 repo に置くことを禁じ、developer の credential を open source の project に埋め込むことも禁じている。さらに `gmail.readonly` は restricted なので、自分だけが使う personal use の免除を外れると、検証と第三者のセキュリティ審査が要る。所有者が自分の project を持てば personal use に収まり、Slack で所有者が App を作る形（ADR-0007）とも手順がそろう。

## Considered Options

- momo の作者の project の client を binary に埋めて配る。所有者は project を作らずに済むが、repo に置けず、restricted scope の審査を通す必要がある。
- 公開状態を Testing のままにする。警告は同じく出るうえ、基本の scope 以外を求めると token が 7 日で失効し、Job が新着メールを読む使い方と合わない。
- 会社のアカウントには、会社の Organization の下の Internal の project を必須にする。会社のデータを個人の project に通すかは会社の規程の問題で、momo の model は変わらないので強制しない。

## Consequences

- 所有者は、未検証 app の警告を押し進める操作を求められる。momo は同意の前に、次の警告が所有者自身の project の app であることを project id と共に示す。
- 会社の admin が third-party app を制限していれば、接続は Google 側で拒否される。momo は Google が返す error を説明するだけで、admin に Trusted の指定を頼む手順や Internal の project の作り方は案内の文章に留める。
- installed app では incremental authorization が使えないので、service を足すときは要る scope をすべて並べて同意し直し、refresh token を差し替える。1 つの Google アカウントの Connection が Gmail と Calendar を両方持つ。
