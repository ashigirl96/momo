# sandbox を Docker の isolated な internal network で動かし、Gateway の口を TCP にする

sandbox は Docker Desktop の container で動かす。NanoClaw の lockdown と同じ形にし、Session ごとに `--internal` の network を作って `com.docker.network.bridge.gateway_mode_ipv4=isolated` を付ける。そこへ agent の container と、securityd へ中継するだけの container をつなぐ。中継は起動時に iptables で securityd の port だけを許し、uid 1000 で socat を動かす。securityd の Gateway は host の 127.0.0.1 の TCP で待ち、中継は `host.docker.internal` 経由で届く。

Apple `container` 1.5.0 の `--network none` と UDS の中継は、境界の面ではこちらより固い。network がそもそも無く、口も UDS にできる。それでも選ばなかったのは、2026-10-16 の macOS 26.6.2 の実測で、新しい container の最初の起動に 3〜5 分かかり、container 1 つごとに約 513 GiB の rootfs を host の disk に実際に確保したからである。作成中は、他の container への `exec` も返らなくなった。これでは Session ごとに container を作る形（NanoClaw と同じ）が回らない。Docker の形なら、network・中継・agent の作成と最初の往復が約 0.5 秒で終わる。

## Considered Options

- Apple `container` 1.5.0 の `--network none` と UDS の中継。Bot ごとなどの長命の container にすれば待ち時間は避けられるが、Session の単位と寿命を NanoClaw から離すことになり、macOS 26 も必須になる。rootfs の容量を小さくする手段（upstream の container#887）が出たら、見直す材料になる。
- isolated を付けない Docker の internal network。network の gateway IP から Docker Desktop の VM の service に届いたので、境界にならない。
- host の UDS を中継の container に bind mount する。Docker Desktop では connect が refused になり、使えない。

## Consequences

- securityd の Gateway の port には、Mac 上のすべての Docker container と、同じ Mac のほかの process からも届く。Gateway は、Run の capability の無い要求を拒否する。
- Gateway が止まっている間は、別の process が 127.0.0.1 の同じ port を取ると、中継からの接続を受けられる。sandbox の側が Gateway を本物と確かめる仕組みが要る。
- 同じ network の container 同士は届くので、network は Session ごとに分ける。既定の address pool では足りないので、`/29` の subnet を明示して作る。
- container には `--init` を必ず付ける。`--memory` は `--memory-swap` を同じ値にしないと効かない。
- Docker Desktop を再起動すると、`unless-stopped` を含めて container は止まったままになり、network は残る。momo が起動時に、必要な container を起こし直す。
- 利用者は Docker Desktop を入れる必要がある。macOS 26 は必須にしない。
