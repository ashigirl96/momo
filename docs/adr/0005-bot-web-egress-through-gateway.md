# Bot の Web 通信は Gateway を通して開き、そこからの持ち出しは止めない

ローカル v1 では、全 Workspace の全 Bot が、資格情報を付けない Web への通信を使える。sandbox は Gateway の実行面にしか届かない構成のままにし、Web への通信も Gateway が CONNECT の tunnel で中継する。TLS は終端せず、宛先の host を監査に残す。次の宛先には中継しない。

- host 自身（backend の `momo.localhost` の port を含む）
- private、loopback、link-local の IP
- cloud の metadata

Slack・Google・Anthropic の host への要求は tunnel にせず、型付き操作か P8 の TLS 終端の経路に回す。

こう決めたのは、参照の NanoClaw が agent の egress を既定で開けていて、所有者がその使い勝手（Web の検索、閲覧、任意の URL の取得）を v1 にも求めたからである。資格情報を付けない通信は、Vault の秘密を sandbox に渡さないという境界を崩さない。Gateway を通せば、「sandbox は Gateway にしか届かない」構成とその試験を保ったまま、host 自身や private な宛先への迂回を Gateway で止められる。TLS を終端しないのは、certificate pinning を使う client を壊さず、sandbox に CA を信頼させる範囲を provider の host に限るためである。provider の host を tunnel にしないのは、Bot が会話などで見かけた token を直接使い、Grant と承認を迂回するのを防ぐためである。

その代わり、BRIEF の不変条件「持ち出し先・操作・対象も制御する」は、資格情報を使う操作だけに当てはまるものになる。Grant で読んだメールや Slack の履歴、会話、記憶は、Bot が Web への要求（GET の query を含む）に載せて外へ出せる。承認カードが止めるのは資格情報を使う書き込みだけなので、この通信は止まらない。v1 ではこれを受け入れ、会社用 Workspace にも同じく当てはめる。

## Considered Options

- **Web を使わせない。** 持ち出しの経路は、Grant を通した書き込みとモデル通信だけになる。NanoClaw にある使い勝手を v1 で失うので採らない。
- **Anthropic 側で実行される web search だけを許す。** sandbox からの通信は増えないが、任意の page の取得と閲覧ができない。
- **Gateway 経由で、任意の URL への GET だけを許す。** GET の query でも持ち出せるので、守れるものは全面開放とほとんど変わらない。
- **sandbox から外へ直結させる（NanoClaw の既定）。** host 自身や private な宛先への迂回を、sandbox の network 設定だけで防ぐことになる。「proxy の環境変数を消した直結は失敗する」という試験も使えなくなる。
- **Bot ごとに Web の切り替えを置く。私的なデータを読む Grant と Web を排他にする。** 所有者は、全 Bot で開くことを選んだ。

## Consequences

- BRIEF の不変条件、ROADMAP の 3.1 と P8 gate、SECURITY-ACCEPTANCE の D と I を、資格情報を付ける要求と付けない要求に分けて書き直した。
- Web は P3 の縦切りに入れず、P3 の後の独立した縦切りで足す。それまでの Bot は Web を使えない。
- 監査は host 単位なので、path と本文は残らない。持ち出しを後から調べても、どの host へ送ったかしか分からない。
- provider の host への tunnel の拒否は、CONNECT の宛先と SNI で判定する。IP literal や別名で provider に届く通信までは見分けられない。token を使わせない守りの正本は、sandbox が token を見ないこと（Vault の境界）の方にある。
