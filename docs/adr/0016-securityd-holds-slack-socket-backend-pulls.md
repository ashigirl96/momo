# Slack の Socket Mode は securityd が持ち、backend が取りに行く

Slack の Socket Mode の接続と app-level token（xapp）は securityd が持つ。securityd は受けた event を contracts の型に正規化し、重複と自分の投稿を捨て、security.db に書いてから ack する。backend は管理 IPC の long-poll で受信を取りに行き、Channel binding から Conversation を決めて Run にする。

xapp は Provider app の秘密なので、backend に置くと ADR-0003 の「backend は秘密を通すだけで持たない」から外れる。securityd から backend へ push すると、securityd から外へ向かう口が増え、管理 IPC が双方向になる。long-poll なら呼ぶのは常に backend で、securityd の口は ADR-0003 の 2 本のままになり、vendor の JSON も信頼側の外に出ない（ADR-0012）。

## Considered Options

- **backend が接続を持ち、xapp を起動時に securityd から借りる。** 受信から Run までの経路は短いが、xapp が backend の memory に常駐する。
- **securityd が backend へ push する。** 遅延は小さいが、backend 側に securityd から呼ばれる口が要る。

## Consequences

- 自分の投稿を捨てる判定に、securityd が送った投稿の `(channel, ts)` の台帳を使える。User token で所有者として送った投稿は、受信では所有者本人の発言と見分けられないので、この台帳が無いと自己ループになる。
- 重複の記録と受信の待ち行列は security.db に置く。backend が止まっている間も、securityd は ack を続けられる。
- 所有者の Slack user id を得る合言葉の DM は、securityd が routing の前に照合し、backend に渡さない。
