# 候補 1: Docker の NanoClaw 型の実測

- ticket: [#28](https://github.com/ashigirl96/momo/issues/28)（map [#1](https://github.com/ashigirl96/momo/issues/1)）。比べる表は [#14](https://github.com/ashigirl96/momo/issues/14) の [macos-sandbox-egress-measured.md @ 948e3e8](https://github.com/ashigirl96/momo/blob/948e3e8fc934a379b2ae0bc3215c78e458d490e5/docs/research/macos-sandbox-egress-measured.md)。
- 測定日: 2026-10-16。実 token は使っていない。Gateway は banner を返すだけの偽物（[host_listeners.py](host_listeners.py)）と、#16 の偽の Anthropic endpoint を host の 127.0.0.1 だけで待たせた版（[sdk/server.ts](sdk/server.ts)）。
- 再現: [run.sh](run.sh)（listener・image・network・中継・probe）、[gw-restart.sh](gw-restart.sh)、[spoof.py](spoof.py)、[timing.py](timing.py)、[sdk.sh](sdk.sh)、[sqlite.sh](sqlite.sh) と [sqlbench.py](sqlbench.py)、[portscan.py](portscan.py)、[probe-live.sh](probe-live.sh)、[reboot-check.sh](reboot-check.sh)。
- 表記: **実測** はこの Mac で動かした結果。**推論** は実測から導いた判断。**未実施** は測っていないこと。

## 環境

| 項目 | 値 |
|---|---|
| macOS | 26.6.2（25G83）、arm64 |
| Docker Desktop | 4.82.0、Engine 29.6.1、kernel 6.12.76-linuxkit、cgroup v2、VMM は既定（Apple Virtualization）、feature flag なし、AutoStart は off |
| 参照した NanoClaw | `f2934ab` の [`src/drivers/docker-driver.ts`](https://github.com/nanocoai/nanoclaw/blob/f2934abaf2d89f5b95b19ac1809a0ddc1eda1f79/src/drivers/docker-driver.ts) と [`src/egress-lockdown.ts`](https://github.com/nanocoai/nanoclaw/blob/f2934abaf2d89f5b95b19ac1809a0ddc1eda1f79/src/egress-lockdown.ts)、[`docs/db.md`](https://github.com/nanocoai/nanoclaw/blob/f2934abaf2d89f5b95b19ac1809a0ddc1eda1f79/docs/db.md) |
| probe image | alpine 3.22 に python3・socat・iptables・iproute2・sqlite・tcpdump（[Dockerfile](Dockerfile)） |
| SDK image | `oven/bun:1.4.2-slim` に `@anthropic-ai/claude-agent-sdk` 0.3.300（#16 の [Dockerfile.bun](../common/sdk/img/Dockerfile.bun)、CLI 2.1.300） |
| host 側の listener | Gateway: 127.0.0.1:47200（TCP）と UDS。偽の Anthropic: 127.0.0.1:47210。囮: 127.0.0.1 と ::1 の 47201、0.0.0.0 の 47202（TCP）と 47203（UDP） |

### 構成

NanoClaw の Docker driver と同じ形にした。

- agent は `--internal` の network にだけつなぐ。起動引数は NanoClaw の `hardeningArgs` と `userArgs` に合わせ、`--cap-drop=ALL --security-opt no-new-privileges --init --pids-limit N --user 1000:1000` に `--read-only` と `--tmpfs /tmp:noexec` を足した。NanoClaw は agent に `--read-only` を付けていない（補助の container にだけ付ける）。
- 中継の container は socat だけを動かし、default の `bridge` と internal network の両方につなぐ。internal network では alias `gateway` を持つ。NanoClaw の補助 container と同じつなぎ方。
- internal network は 2 通り作った。`momo-cmp-d-int`（既定）と、`-o com.docker.network.bridge.gateway_mode_ipv4=isolated` を付けた `momo-cmp-d-iso`。

## 結果

### 経路（agent から）

proxy の環境変数は付けずに測った。「塞ぐ」は Gateway 以外への接続がすべて失敗したことを指す。

| 経路 | internal（既定） | internal + isolated |
|---|---|---|
| Gateway（陽性対照、`gateway:3129` → host の TCP） | 届く | 届く |
| Gateway（`gateway:3128` → host の UDS の bind mount） | 中継まで届くが即 EOF（中継から host の UDS へは refused） | 同左 |
| 直結（hostname、v4 literal、v6 literal） | 塞ぐ（unreachable、名前解決の失敗） | 塞ぐ |
| DNS（`getaddrinfo`） | 塞ぐ（embedded DNS が外部名に ServFail） | 塞ぐ |
| DNS（UDP/TCP 53 を直接） | 塞ぐ | 塞ぐ |
| UDP/QUIC・ICMP | 塞ぐ | 塞ぐ |
| host の 127.0.0.1・::1 だけの port（backend の囮） | 塞ぐ（`host.docker.internal` も解決しない） | 塞ぐ |
| host の 0.0.0.0 の port（LAN の IP） | 塞ぐ | 塞ぐ |
| `192.168.65.254`・`192.168.65.3`・`192.168.64.1` | 塞ぐ | 塞ぐ |
| metadata（169.254.169.254）・LAN の router・10.0.0.1 | 塞ぐ | 塞ぐ |
| 他の Docker network の container の IP | 塞ぐ | 塞ぐ |
| 他の container が host に公開した port（`0.0.0.0` の publish） | **network の gateway IP 経由で timeout**（DNAT の後で落ちる） | 塞ぐ（gateway IP が無い） |
| **network の gateway IP（VM 側の bridge）** | **VM の `0.0.0.0` の service に届く**（111 番の rpcbind と 59423 番） | 該当なし（gateway IP を持たない） |
| 中継の container の他の port | 3128・3129 だけ開く | 同左 |
| 同じ internal network の他の agent | **届く** | **届く** |
| 中継を default route にする | root でも NET_ADMIN が無いので route を変えられない。NET_ADMIN を与えても中継は転送しない（timeout） | 同左 |

### 中継の container（default bridge にいる）

| 経路 | 何もしない | 起動時に iptables で絞り、非 root に落とす |
|---|---|---|
| securityd の port（`host.docker.internal:47200`） | 届く | 届く |
| 外部（1.1.1.1:443） | 届く | 塞ぐ |
| host の 127.0.0.1 の他の port（`host.docker.internal` 経由） | 届く | 塞ぐ |
| LAN の IP | 届く | 塞ぐ |
| 他の Docker network の container の IP | 届く | 塞ぐ |

### Gateway の口とその他

| 項目 | 結果 |
|---|---|
| Gateway の口 | TCP だけ。host の UDS は bind mount しても connect が refused |
| Gateway 停止中 | 中継には connect できるが即 EOF。ほかの経路は開かない（fail closed） |
| Gateway の再起動 | container を起こし直さずに戻る |
| Gateway 停止中の port の乗っ取り | 別の process が 127.0.0.1 の同じ port を取ると、中継の接続を受けられた |
| Gateway 動作中の port の乗っ取り | `::1`・LAN の IP の同じ port を取っても奪えない |
| container の stop・start | 結果は同じ。alias と cgroup の値も残る |
| Docker Desktop の再起動 | network は残る。container は `unless-stopped` も含めて全部 exit 143 で止まり、戻らない。`docker start` で元の結果に戻る |
| Session 1 つを起こす時間 | network・中継・agent・最初の往復で中央値 0.48 秒、最大 0.50 秒 |
| SDK の 1 回の query | container の作成から終了まで約 0.6 秒（`sleep 2` を除く） |
| `--cpus` / `--pids-limit` | 効く |
| `--memory` | `--memory` だけでは同量の swap を使え、400MB の確保が 256MB の上限で通る。`--memory-swap` を同じ値にすると OOM で止まる |
| `--init` | 無いと孤児が zombie で残り、SIGTERM が効かず stop が grace 期間の後の SIGKILL になる。有ると両方解ける |
| 書き込める 4 つの dir | read-only root・uid 1000 で、Session の dir から mount して runner が動く |
| resume | container を作り直しても同じ session で続く |
| SQLite の両側からの書き込み | 壊れる |
| SQLite の片側だけが書く形（NanoClaw の NC-11） | 届く。kill -9 のあとも壊れない |

### 経路の詳細

実測:

- internal network（既定）の agent の route は自分の subnet だけで、default route が無い。直結・DNS・UDP・ICMP・metadata・LAN・router・他の network の container は unreachable か名前解決の失敗で止まった。`host.docker.internal` と `gateway.docker.internal` は名前が引けない。
- embedded DNS（127.0.0.11）は、internal network の container が外部名を引くと ServFail を返した。VM の host 側で tcpdump を取ると、同じ時間帯に他の container の問い合わせは `192.168.65.7` へ出ていたが、agent が引いた一意の名前は 1 件も出ていなかった。
- **既定の internal network では、agent から network の gateway IP（VM 側の bridge の address）に届いた。** 全 port を走査すると、111 番（rpcbind）と 59423 番が開いていた。どちらも VM の host の namespace で `0.0.0.0` に bind している。他の container が `0.0.0.0` に publish した port（10 個）は、gateway IP 宛てだと refused ではなく timeout になった。127.0.0.1 だけに publish した port は refused。
- `gateway_mode_ipv4=isolated` を付けると、network が gateway IP を持たない（中継の container が `.1` を受け取った）。走査で開いていたのは中継の 3128 と 3129 だけだった。
- 同じ internal network の 2 つの agent の間は届いた。`enable_icc=false` を付けると、agent 同士だけでなく agent から中継にも届かなくなった。
- agent は root でも NET_ADMIN が無いので `ip route` を変えられない。NET_ADMIN を与えて中継を default route にしても、外部と host には timeout で届かなかった。

推論:

- 既定の internal network は、VM の service が gateway IP で見える分だけ #14 の Apple `container` より口が多い。isolated を付ければ、届くのは中継の port だけになる。
- 同じ network の agent 同士は届くので、Workspace と Session をまたいで network を共有しない。NanoClaw も Session ごとに `ncl-...-private` の internal network を作っている。

### Session ごとの network

実測:

- isolated の internal network の作成は約 0.03 秒、中継の `network connect` は約 0.03 秒、`disconnect` と削除で約 0.2 秒だった。
- **既定の address pool では、手元の Docker では network をあと 21 個しか作れなかった**（`all predefined address pools have been fully subnetted`）。他の project の network が pool を使っている。
- `--subnet` で /29 を明示すると、120 個を 3.6 秒で作れ、120 個目の network でも中継に届いた。daemon の設定は変えていない。

推論:

- 同時に開く Session が数十になると、既定の pool では足りない。momo が自分の範囲から /29 を割り当てれば、Docker Desktop の設定を変えずに済む。範囲が LAN や他の network と重ならないことは、momo が起動時に確かめる必要がある。

### 中継の container と Gateway の口

実測:

- Docker Desktop では、host の UDS を中継の container に bind mount すると、socket file は見えるが connect が `ECONNREFUSED` になった。中継から securityd へは `host.docker.internal` の TCP でしか届かない。
- 中継は default の `bridge` にいるので、外部、host の 127.0.0.1 の他の port、LAN、他の Docker network の container に届いた。
- 中継を `--cap-add NET_ADMIN --cap-add SETUID --cap-add SETGID` で起こし、起動時に iptables の OUTPUT を「lo・確立済み・`192.168.65.254` の 47200 番」だけ許して既定 DROP にし、ip6tables も既定 DROP にしてから、socat を uid 1000 で `exec` した。socat の Cap は Prm・Eff とも 0 で、iptables を書き換えられない。外部・host の他の port・LAN・他の container は timeout になり、agent から中継経由で Gateway には届いた。`host.docker.internal` は IPv6 を先に返すので、IPv4 の address で規則を書く必要があった。
- Gateway（127.0.0.1:47200）を止めると、agent から中継への connect は成功し、すぐ EOF になった。probe のほかの経路はすべて塞がったままだった。Gateway を再起動すると、container を起こし直さずに届いた。
- Gateway の停止中に、別の process が 127.0.0.1:47200 を bind すると、中継の接続をその process が受けた。Gateway の動作中に `::1:47200` と LAN の IP の 47200 番を別の process が取っても、中継の接続は Gateway に届いた。

推論:

- Gateway の口は TCP になる。Docker Desktop は `host.docker.internal` への接続を host の 127.0.0.1 につなぐので、securityd は 127.0.0.1 で待つ。
- この port には、Docker の default bridge にいるすべての container と、同じ Mac のすべての process が届く。他の macOS ユーザーも、securityd が止まっている間に port を取れる。#14 の Seatbelt で見た「port で許すとなりすましが効く」と同じ問題が、securityd の停止中に起きる。Gateway の口は、run capability などで sandbox 側を認証するだけでなく、Gateway 自身も sandbox 側に名乗れる必要がある（実行 identity の fog で扱う）。
- 中継を iptables で securityd の port だけに絞る手段はある。NET_ADMIN を起動時だけ使い、非 root に落とす。agent から中継へ届くのは socat の port だけなので、絞らなくても agent が中継を踏み台にする経路は見つからなかった。
- 中継を Session ごとに置けば、securityd は接続元の中継で Session を区別できる。1 つの中継を全 Session の network につなぐと、その区別には PROXY protocol などが要る。

### 再起動

実測:

- container の stop・start: agent と中継を止め、agent だけを起こすと Gateway にも何にも届かなかった。両方を起こすと最初と同じ結果になった。中継の alias と agent の cgroup の値は残った。
- Docker Desktop の再起動（`docker desktop restart`、API が戻るまで 16 秒）: network `momo-cmp-d-int` と `momo-cmp-d-iso` は残った。container は `restart=no` も `restart=unless-stopped` も exit 143 で止まり、2 分たっても起きなかった。`docker start` で中継と agent を起こすと、probe・alias・cgroup の値は再起動の前と同じだった。
- 最初の再起動は `osascript -e 'quit app "Docker"'` で始めた。engine は 52 秒で止まったが、Docker Desktop の process が残り、`open -a Docker` で起きなかった。続く `docker desktop restart` は、内蔵ディスクの空きが無くなっていた（別の測定が作った file が原因）ため engine を起こせず、Docker Desktop の process を終了させて起こし直した。この回は測定に使っていない。

推論:

- Docker Desktop の再起動のあとは、momo が Session の container を作り直すか `docker start` する必要がある。restart policy には頼れない。NanoClaw も container を `--rm` で作り、起動時に作り直している。
- 再起動で外れる制限は見つからなかった。制限は network の形で決まり、container の作り直しでも同じになる。

### 資源の上限と init

実測（`--cpus 1 --memory 256m --pids-limit 64`）:

- cgroup の値は `cpu.max=100000 100000`、`memory.max=268435456`、`memory.swap.max=268435456`、`pids.max=64` になった。
- 4 つの busy loop を回すと `docker stats` で CPU 100% に収まった。
- `sleep` を 100 個起こすと 62 個目の次で `EAGAIN` になった。
- **`--memory` だけでは、400MB の確保が通った**（swap が同量まで使える）。`--memory-swap 256m` を足すと exit 137（OOM）で止まった。
- runtime（python）を PID 1 にすると、孤児になった `sleep` が zombie で残った。`docker stop -t 5` は SIGTERM が効かず 5 秒後に SIGKILL（exit 137）になった。`--init` を付けると zombie は残らず、stop は 0 秒（exit 143）だった。

推論:

- memory の上限は `--memory-swap` を同じ値にして初めて効く。NanoClaw は swap の扱いを配置の問題として触っていない。
- `--init` は必須にする（#16 の結果と同じ）。

### Agent SDK（#16 の入力）

実測:

- agent と同じ起動引数（read-only root、uid 1000、`noexec` の `/tmp` の tmpfs、`--cpus 2 --memory 1g --memory-swap 1g`）で、`CLAUDE_CONFIG_DIR`・`HOME`・`cwd`・`state` を Session の dir から bind mount した。`ANTHROPIC_BASE_URL=http://gateway:3130`（中継 → host の偽の endpoint）で query が通った。
- container を消して同じ mount で作り直し、`resume` すると `sameSession: true` になり、前の Run の marker を読めた。Session の dir に書かれたのは `cfg/.claude.json`、`cfg/backups/`、`cfg/projects/-work/<session>.jsonl` だった。host 側の file の owner は host のユーザーに見える。
- agent の netns に tcpdump を相乗りさせた結果:
  - 何も付けないと、`api.anthropic.com` の名前解決を 1 回の query で 8〜10 回試み、どれも ServFail で止まった。
  - `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` と `skipWebFetchPreflight` を付けると、引いたのは `gateway` だけだった。
  - WebFetch を使わせると、付けた場合も `example.com`（WebFetch の対象）を引いた。付けない場合は `api.anthropic.com` も引いた。
  - 中継以外への TCP の SYN は無かった。
- 偽の endpoint が受けたのは `HEAD /api/hello` と `POST /v1/messages?beta=true` だけで、`x-api-key` は placeholder だった。
- container の作成から query の終了まで、`sleep 2` を除いて約 0.6 秒だった。

### Session の dir の SQLite（#22 の入力）

実測（host は macOS の python と sqlite、container は alpine の python と SQLite 3.49.2、bind mount した同じ dir）:

- **両側が同じ file に書く（`BEGIN IMMEDIATE` で counter を増やす）と壊れた。**
  - WAL: 3 回とも、host の process が `Bus error`（SIGBUS、`-shm` の mmap）で落ちた。
  - rollback journal（DELETE）: container が開くときに `unable to open database file` か `disk I/O error` になった。開くのを retry にすると、3 回中 1 回で `integrity_check` が `Page 11: never used` などを返し、counter と行数がずれた。`database disk image is malformed` も出た。`SQLITE_BUSY` は 1 回も出なかった。両側の lock が互いに見えていない。
- **NanoClaw の NC-11 の形**（DELETE mode、file ごとに書き手は片側だけ、host は書くたびに開いて閉じる、読み手は `mode=ro` で開く）:
  - inbound（host が書き、container が開いたままの接続で読む）: 1500 件すべて届いた。遅れは中央値 7.0ms、p99 28.8ms、最大 194ms。
  - outbound（container が開いたままの接続で書き、host が読むたびに開く）: 1500 件すべて届いた。遅れは中央値 8.8ms、p99 115ms。
  - 読み手は 1500 件の間に 85〜88 回 `attempt to write a readonly database` で失敗し、次の poll で読めた。書き手の journal を hot と見て巻き戻そうとし、read-only なので止まったもの。
  - WAL で同じことをすると、container の読み手は新しい行を 1 件も見られず、host の読み手は 1501 件中 78 件しか見られなかった。
- **kill -9**: DELETE mode の書き手（container も host も）を 2 秒ごとに 5 回 kill すると、hot journal が残った回があった。どの回も、次に読み書きで開いた側が巻き戻し、`integrity_check` は ok だった。
- **追記だけの JSONL**: container が書き host が読むと、2000 行すべて届き、遅れは中央値 7ms、最大 705ms。host が書き container が読むと、2000 行すべて届いたが、遅れは中央値 2565ms、最大 5100ms だった。壊れた行は無い。

推論:

- 書き手を 2 つにした SQLite は使えない。NanoClaw の docs.md の規則（DELETE、書き手 1 つ、open-write-close、container は read-only）がそのまま必要で、加えて読み手は read-only で開く必要がある。読み書きで開くと、書き手の途中の journal を巻き戻して壊し得る。
- 読み手は `SQLITE_READONLY` 系の失敗を retry する。書き手が kill されて hot journal が残った file は、書き手の側（または container が止まった後の host）が読み書きで開いて巻き戻す。
- JSONL は host から container への向きが秒単位で遅れるので、inbound には向かない。

## 使いやすさ

- **setup の手数**: Docker Desktop を入れるだけで、feature flag も管理者の権限も要らない。network は `docker network create` で作れ、daemon の設定は変えない（address pool は `--subnet` で避けられる）。Docker Desktop は既定で login 時に起きないので（この Mac は AutoStart off）、momo が起動時に `docker desktop start` か `open -a Docker` を呼ぶか、所有者に設定を頼む。Docker Desktop の再起動が hang した場合、`docker desktop restart` でも止められないことがあった。
- **Session を作ったときの待ち時間**: network・中継・agent を作って最初の往復まで約 0.5 秒。SDK の最初の query まで約 0.6 秒。image の pull・build は別。
- **NanoClaw の runner のコードの読み替えやすさ**: NanoClaw の Docker driver の形（Session ごとの internal network、補助 container を `bridge` と alias でつなぐ、`--cap-drop=ALL --security-opt no-new-privileges --init --pids-limit --user`、session DB の規則）がそのまま使える。足すのは、network の `gateway_mode_ipv4=isolated` と `--subnet`、agent の `--read-only` と `--memory-swap`、中継の iptables による絞り込み。

## 未実施

- Mac の再起動のあとの確認。[reboot-check.sh](reboot-check.sh) を用意し、再起動の前の状態で一度流して通ることを確かめた。
- Docker VMM、Docker Sandboxes（#15 で候補から外した）。
- 中継の iptables を、momo が実際に使う image と securityd の port で組んだ形。今回は probe image での確認だけ。
- 中継を Session ごとに置いた場合と、1 つを共有した場合の securityd 側の識別。
- IPv6 を有効にした internal network。Docker の既定では IPv6 は無効。
- 他の macOS ユーザーとして port を bind する試験。同じユーザーの別の process で代えた。
- SQLite の NC-11 の形を、better-sqlite3（NanoClaw）や Bun の sqlite で流すこと。今回は python の sqlite3。

## 検証証拠（SECURITY-ACCEPTANCE K）

| 項目 | 状態 | 証拠/再現コマンド | 残る制約 |
|---|---|---|---|
| Workspace越境 | 部分（模擬） | 同じ internal network の agent 同士は届く、`enable_icc=false` は中継も塞ぐ、他の network の container には届かない（`run.sh probe`、本文の peer 試験） | Session ごとに network を分ける前提。分けた形での越境は他の network の container の行で代えた |
| 秘密非露出 | 未実施 | 実 token を使っていない。偽の endpoint が受けた `x-api-key` は placeholder | — |
| 再起動復旧 | Gateway・container・Docker Desktop は pass（模擬）、Mac の再起動は未実施 | `gw-restart.sh`、`probe-live.sh`、`docker desktop restart` のあと `docker start` | Docker Desktop の再起動で container は戻らないので momo が起こす。Gateway の停止中は port を他の process に取られ得る |
| 外部効果 | isolated の internal network は pass、既定の internal network は VM の service に届くので fail（模擬） | `run.sh probe momo-cmp-d-iso`、`portscan.py`、tcpdump（模擬の Gateway と囮） | 中継は絞らないと外部・host・LAN に届く（agent からは中継の port だけ） |

## Mac の再起動のあと（2026-10-16 に実測）

`reboot-check.sh` を、再起動して login した 4 分後に流した。

- AutoStart は off のままだったが、script を流す前から Docker Desktop が動いていて、docker API も応答した。login 項目か macOS の再開によるとみられ、原因は確かめていない。
- network の `momo-cmp-d-int` と `momo-cmp-d-iso` は残っていた。container は 3 つとも Exited のままだった。`unless-stopped` の `momo-cmp-d-agent-rp` は再起動の前に手で止めていたので、起きないのは仕様どおり。
- 中継の alias（`gateway`）は残っていた。`docker start` は 1 秒以内に終わった。
- isolated の network の probe は blocked が 51 件で、届いたのは中継の 2 つの port だけだった。cgroup の値（cpu・memory・swap・pids）と uid も前と同じだった。
- Gateway の停止中は connect のあとすぐ EOF になり、再起動のあとは container を起こし直さずに戻った。
- 再起動の前の Agent SDK の session を resume でき、`sameSession: true` になった。
- Gateway の socket の dir（TMPDIR の下）は消えていた。
