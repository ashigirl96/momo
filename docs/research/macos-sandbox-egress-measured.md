# macOS で sandbox の通信を Gateway だけに絞る方式の実測

- ticket: [#14](https://github.com/ashigirl96/momo/issues/14)（map [#1](https://github.com/ashigirl96/momo/issues/1)）。読んだだけの前段は [#3](https://github.com/ashigirl96/momo/issues/3) と [macos-sandbox-egress.md @ 9ceca2d](https://github.com/ashigirl96/momo/blob/9ceca2dbdecd06b84c822a3623b6677bccdbe935/docs/research/macos-sandbox-egress.md)。
- 測定日: 2026-10-16。実 token は使っていない。Gateway は UDS と 127.0.0.1 の TCP で banner を返すだけの偽物。
- 再現: [macos-sandbox-egress-measured/run.sh](macos-sandbox-egress-measured/run.sh)。probe は [probe.py](macos-sandbox-egress-measured/probe.py)、host 側の Gateway と囮は [host_listeners.py](macos-sandbox-egress-measured/host_listeners.py)。
- 表記: **実測** はこの Mac で動かした結果。**推論** は実測から導いた判断。**未実施** は今回測っていないこと。

## 環境

| 項目 | 値 |
|---|---|
| macOS | 26.6.2（25G83）、arm64 |
| Seatbelt | OS 同梱の `sandbox-exec`。profile は sandbox-runtime `9a277e5` の `generateSandboxProfile` の基本部分を写し、network は Gateway の UDS の dir と `localhost:47100` だけを許す |
| Docker Desktop | 4.82.0、Engine 29.6.1、VMM は既定（Apple Virtualization）、feature flag なし |
| Apple `container` | 1.1.0（`5973b9c`）、kernel 6.18.15。research が読んだ 1.5.0 ではない |
| probe image | alpine 3.22 に python3・socat・iputils-ping（[Dockerfile](macos-sandbox-egress-measured/Dockerfile)） |
| host 側の listener | Gateway: UDS と 127.0.0.1:47100。囮: 127.0.0.1 と ::1 の 47101、0.0.0.0 の 47102（TCP）と 47103（UDP） |

測ったのは S（Seatbelt）、D1（Docker の既定 bridge、baseline）、AC（Apple `container` の `--network none` と UDS の mount）の 3 つ。D2（Docker の `--network none` と UDS）と DS（Docker Sandboxes）は測っていない。

## 結果

proxy の環境変数は付けずに測った。「塞ぐ」は Gateway 以外への接続がすべて失敗したことを指す。

| 経路 | S Seatbelt | D1 Docker 既定 | AC Apple container |
|---|---|---|---|
| Gateway（陽性対照） | UDS・TCP とも届く | `host.docker.internal:47100` で届く | UDS で届く。`lo` の socat shim 経由でも届く |
| 直結（hostname、v4 literal） | 塞ぐ（EPERM） | 届く | 塞ぐ（unreachable） |
| IPv6 literal | 塞ぐ（EPERM） | 届かない（既定 bridge に IPv6 なし） | 塞ぐ（`::1` しかない） |
| DNS（`getaddrinfo`） | 塞ぐ（EAI_NONAME） | 届く | 塞ぐ（EAI_AGAIN、resolv.conf が空） |
| DNS（UDP/TCP 53 を直接） | 塞ぐ（EPERM） | 届く | 塞ぐ |
| UDP/QUIC | 塞ぐ（EPERM） | 出る。host の UDP 囮に着弾 | 塞ぐ |
| ICMP | 塞ぐ（sendto EPERM） | 届く | 塞ぐ |
| host の 127.0.0.1 だけの port | 塞ぐ（EPERM） | **届く**（`host.docker.internal` 経由） | 塞ぐ（guest の `lo` は host と別） |
| host の 0.0.0.0 の port（LAN の IP） | 塞ぐ（EPERM） | 届く | 塞ぐ |
| `192.168.65.254`・`192.168.64.1` | 塞ぐ | 前者は届く | 塞ぐ |
| metadata（169.254.169.254） | 塞ぐ | 応答なし（timeout） | 塞ぐ |
| LAN の router | 塞ぐ | 届く | 塞ぐ |
| AF_VSOCK（CID 1/2/3、port 0–65535） | 該当なし | 該当なし | どの port も開いていない |

### S. Seatbelt

実測:

- 上の表のとおり、Gateway 以外はすべて EPERM か名前解決の失敗で止まった。profile は mDNSResponder への mach-lookup を許していないので、`getaddrinfo` も外へ出ない。research で未確認だった DNS は、この profile なら塞がる。
- **`(remote ip "localhost:47100")` は 127.0.0.1 だけでなく、`::1` と host の LAN の IP の 47100 番にも一致する。** Gateway が 127.0.0.1:47100 で待っている間に、別の process が `::1:47100` と `LAN の IP:47100` を bind すると、sandbox からその両方に届いた。`::ffff:127.0.0.1` は一致せず EPERM になった。
- UDS は許した dir の中の path なら、別の process が bind した socket にも届く。
- Gateway を止めると、UDS は ENOENT、TCP は refused になり、ほかの経路は EPERM のままだった。Gateway を再起動したあとの結果は、止める前と同じだった。
- `sh` から起こした子の python も同じく EPERM になった（制限が継承される）。

推論:

- port で Gateway を許すと、同じ port 番号を別のアドレスで取った process が Gateway になりすませる。Gateway が動いている間でも成り立つので、research が挙げた「止まっている間に port を取られる」より広い。Seatbelt を使うなら、Gateway は UDS にして、securityd だけが書ける dir に置く。

### D1. Docker Desktop の既定 bridge（baseline）

実測:

- 直結、DNS、UDP、ICMP、LAN の router が通った。
- **`host.docker.internal`（192.168.65.254）から、host の 127.0.0.1 にしか bind していない listener に届いた。** host 側の log では、接続元が 127.0.0.1 に見える。research で未確認だった点で、backend や securityd の管理面が 127.0.0.1 で待っていても sandbox から届く。
- UDP は `host.docker.internal` 宛ても LAN の IP 宛ても host の囮に着弾した。
- 既定 bridge には IPv6 がなく、IPv6 literal は unreachable だった。

### AC. Apple `container` 1.1.0 の `--network none` と UDS の mount

実測:

- guest の interface は `lo` だけで、route は空、`/etc/resolv.conf` も空だった。IPv6 は `::1` しかない。
- Gateway の UDS は `-v <host の socket>:/run/gw.sock` で mount でき、guest から届いた。`lo` は使えるので、`socat TCP-LISTEN:3128,bind=127.0.0.1 UNIX-CONNECT:/run/gw.sock` の shim で、TCP の proxy を前提にする client も Gateway に向けられる。
- Gateway 以外は、すべて unreachable か refused か名前解決の失敗で止まった。
- AF_VSOCK で CID 1、2、3 の port 0–65535 を総当たりしたが、開いている port はなかった。
- mount した socket は guest では `root:root` の `0755` になり、uid 1000 からは EACCES で connect できなかった。root が動かす shim 経由なら uid 1000 からも届き、root が `chmod 0666` しても届いた。
- Gateway を止めると、guest の connect は成功し、そのあと read が返らないか（timeout）、すぐ EOF になった。ほかの経路は変わらなかった。
- **Gateway が止まっている間に guest から 1 回でも接続を試みると、Gateway を同じ path で起こし直しても、その container からは届かなくなった。** host の Gateway には accept が来ず、guest は connect のあとすぐ EOF になった。別の process に同じ path を bind させても、そこにも届かなかった。container を `stop`・`start` すると戻った。
- 止めている間に接続を試みなければ、Gateway を起こし直したあと（socket は新しい inode）も届いた。
- `container stop`・`start`、`container system stop`・`start` のあとも、probe の結果は最初と同じだった。`container system stop` は container も止め、`system start` のあとも container は自動では起きなかった。
- Gateway の socket が無いと、`container start` は `mount source path '...' does not exist` で失敗した。
- 新しく作った container の最初の `start` に 6〜7 分かかった（`--network none` で 395 秒、既定の network で 372 秒）。`create` は 0 秒、止めた container の `start` は 0〜1 秒、`rm` は 65〜76 秒だった。network の方式とは関係ない。原因は調べていない。

推論:

- Gateway が止まっても、socket が無くても、AC は Gateway 以外の経路を開かない。fail closed になっている。
- 1.1.0 の中継は、host 側の connect に 1 回失敗すると、その mount の中継をやめるとみられる。Gateway の停止中に Run が通信すれば、その Run は Gateway を失う。securityd の更新や crash のあとは、実行中の container を `stop`・`start` するか作り直す必要がある。安全側には倒れている。
- 1.1.0 のまま Run ごとに container を作ると、Run の開始に数分かかる。container を Bot ごとに使い回すか、版を上げて測り直すかは、実行基盤を決めるときの材料になる。
- agent-runner を非 root で動かすなら、root の shim を挟むか、起動時に root が socket の権限を変える。

## 未実施

- Mac の再起動のあとの確認（ユーザーと合意して今回は見送った）。
- D2（Docker の `--network none` と UDS）。4.82 の既定 VMM のまま試すことも、Docker VMM への切り替えもしていない。
- DS（Docker Sandboxes）。`sbx` を入れていない。
- AC の 1.5.0 での再確認。中継の挙動（再起動への追従、socket の権限）は版で変わり得る。
- AF_VSOCK の 65536 以上の port。vsock の port は 32 bit なので、今回の総当たりは一部だけ。
- Seatbelt で、許可リストの mach service（`com.apple.SecurityServer` など）や XPC を経由して外へ出られないか。Agent SDK の CLI と Bun がこの profile で動くか。
- 同じ network の他の container への到達。AC の `--network none` では network が無いので該当しない。
- AC で、Gateway が止まっている間に別の process が path を取ったら届くか。試した時点では中継が止まっていて判断できなかった。S では取れた（UDS も TCP も）。

## 検証証拠（SECURITY-ACCEPTANCE K）

| 項目 | 状態 | 証拠/再現コマンド | 残る制約 |
|---|---|---|---|
| Workspace越境 | 未実施 | — | 別 Workspace の sandbox の間の到達は測っていない |
| 秘密非露出 | 未実施 | 実 token を使っていない | — |
| 再起動復旧 | S・AC は pass（Gateway・container・実行基盤の再起動）、Mac の再起動は未実施 | `run.sh seatbelt`、`run.sh ac`、Gateway の kill と再起動（模擬） | AC は Gateway の停止中に通信があると、container の起こし直しが要る |
| 外部効果 | S・AC は pass（Gateway 以外へ出ない）、D1 は fail | `run.sh seatbelt`、`run.sh d1`、`run.sh ac`（模擬の Gateway と囮） | S は port で許すとなりすましが効く。D2・DS は未実施 |
