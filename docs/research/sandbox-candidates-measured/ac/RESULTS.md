# 候補 2: Apple `container` 1.5.0 の `--network none` と UDS の中継

- ticket: [#28](https://github.com/ashigirl96/momo/issues/28)（map [#1](https://github.com/ashigirl96/momo/issues/1)）。前段の実測は [#14](https://github.com/ashigirl96/momo/issues/14) の [macos-sandbox-egress-measured.md @ 948e3e8](https://github.com/ashigirl96/momo/blob/948e3e8fc934a379b2ae0bc3215c78e458d490e5/docs/research/macos-sandbox-egress-measured.md)。
- 測定日: 2026-10-16。実 token は使っていない。Gateway は banner を返すだけの偽物と、#16 の偽の Anthropic endpoint を host の UDS で待たせたもの。
- 表記: **実測** はこの Mac で動かした結果。**推論** は実測から導いた判断。**未実施** は今回測っていないこと。

## 環境

| 項目 | 値 |
|---|---|
| macOS | 26.6.2（25G83）、arm64 |
| Apple `container` | 1.5.0（`d265d66`）。vminit 0.47.0（初回の `run` で 66 MB を取得）。kernel は既存の 6.18.15 を `--disable-kernel-install` で使った |
| probe image | alpine 3.22 に python3・socat・iputils-ping（[Dockerfile.probe](Dockerfile.probe)） |
| runner image | oven/bun 1.4.2-slim に Agent SDK 0.3.300（CLI 2.1.300）と probe・sidecar を焼き込んだもの（[sdk/Dockerfile](sdk/Dockerfile)）。glibc 2.41 |
| host 側の listener | Gateway: UDS と 127.0.0.1:47300。囮: 127.0.0.1 と ::1 の 47301、0.0.0.0 の 47302（TCP）と 47303（UDP） |

## 再現

| script | 測るもの |
|---|---|
| [run.sh](run.sh) | image の作成、偽の Gateway と囮、container の作成、probe |
| [gw-restart.sh](gw-restart.sh) | 動いている container に対する Gateway の停止・再起動と、同じ path のなりすまし |
| [restart.sh](restart.sh) | container の stop・start、socket が無いときの start、`container system` の stop・start |
| [limits.sh](limits.sh) | memory・CPU・PID の上限と zombie |
| [sqlite.sh](sqlite.sh)・[mailbox.sh](mailbox.sh)・[sqlite_test.py](sqlite_test.py) | host と guest からの同じ SQLite・JSONL への同時アクセス |
| [sdk.sh](sdk.sh)・[sdk/sidecar.ts](sdk/sidecar.ts)・[sdk/fake-uds.ts](sdk/fake-uds.ts)・[tools/netprobe.ts](tools/netprobe.ts) | read-only root・uid 1000 の runner、resume、Gateway 以外への接続の試み |
| [reboot-check.sh](reboot-check.sh) | Mac の再起動のあと（親が流す） |

`sdk/sidecar.ts` は guest の root が動かす。`127.0.0.1:8080` から mount した Gateway の socket への中継と、`127.0.0.1:53` の DNS の記録（どの名前にも 127.0.0.1 を返す）と、`127.0.0.1:443`・`:80` への接続の記録をする。`--dns 127.0.0.1` と組み合わせ、runner が外へ出ようとした宛先を guest の中で見えるようにした。

## 結果

### 境界

proxy の環境変数は付けずに測った。「塞ぐ」は Gateway 以外への接続がすべて失敗したことを指す。

| 経路 | 1.5.0 の結果 | #14 の 1.1.0 |
|---|---|---|
| Gateway（陽性対照） | UDS で届く。`lo` の socat shim と Bun の shim 経由でも届く | 同じ |
| 直結（hostname、v4 literal、v6 literal） | 塞ぐ（EAI_AGAIN、ENETUNREACH） | 同じ |
| DNS（`getaddrinfo`、UDP/TCP 53） | 塞ぐ（resolv.conf が空、ENETUNREACH） | 同じ |
| UDP/QUIC・ICMP | 塞ぐ | 同じ |
| host の 127.0.0.1 と ::1 だけの port（backend の port を模した囮） | 塞ぐ（guest の `lo` は host と別で refused） | 同じ |
| host の 0.0.0.0 の port（LAN の IP） | 塞ぐ | 同じ |
| `192.168.64.1`・`192.168.65.254`・`host.docker.internal` | 塞ぐ | 同じ |
| metadata（169.254.169.254）・LAN の router・10.0.0.1 | 塞ぐ | 同じ |
| AF_VSOCK（CID 1/2/3、port 0–65535） | どの port も開いていない（CID 1・2 は reset、CID 3 は ENODEV） | 同じ |
| 共有 dir の中に host が作った UDS | 使えない（guest の `stat` も `connect` も EOPNOTSUPP） | 測っていない |

host の囮の log には、どの測定でも `listening` 以外の行が無かった。

### 1.1.0 の中継の不具合

実測（[gw-restart.sh](gw-restart.sh)、container を起こし直さずに続けて試した）:

| 手順 | 1.5.0 | 1.1.0（#14） |
|---|---|---|
| Gateway を止める（socket の file は残る）→ guest から接続 | connect は成功し、すぐ EOF | 同じ |
| Gateway を同じ path で起こし直す → guest から接続 | **届く** | 届かない（container の stop・start が要った） |
| Gateway を止め socket の file も消す → 接続 → 起こし直す | 消している間は EOF、起こし直すと届く | — |
| Gateway の停止中に別の process が同じ path を bind | **なりすましに届く**（`SPOOF` が返った） | 中継が止まっていて判断できなかった |
| socket が無いときの `container start` | `mount source path ... does not exist` で失敗（0.04 秒） | 同じ |

推論:

- containerization#933 の修正どおり、中継は 1 回の失敗で止まらず、接続のたびに host の path へ connect し直す。securityd の更新や crash のあとも、動いている container を起こし直さずに済む。
- 中継は path で接続するので、Gateway の socket を置く dir は securityd だけが書ける 0700 にする必要がある。Seatbelt の UDS と同じ条件。

### socket の権限

実測:

- guest の socket の owner は常に `root:root` で、mode は **container を start した時点の** host の socket の mode が写る。host で `0755` のまま作った container では uid 1000 が EACCES、host で `0666` にしてから作った container では uid 1000 から届いた。
- start の後に host で socket を作り直して mode が `0755` に戻っても、guest の mode は `0666` のままで、uid 1000 から届き続けた。
- dir ごとの mount（virtiofs）の中に置いた socket は、guest からは使えない。socket は file 単位で `-v <socket>:<path>` する必要がある。

推論:

- securityd は socket を `0666` で作り、置き場所の dir を 0700 にすれば、root の shim を挟まずに非 root の runner から直接届く。dir の 0700 は host 側の他のユーザーを締め出し、guest には dir の mode は見えない。

### 起動時間と disk

実測:

| 操作 | 時間 |
|---|---|
| 1 個目の container の作成と最初の start（probe image、vminit の取得 6 秒を含む） | 3 分 26 秒 |
| 2 個目（同じ image、別の `exec` と並行） | 4 分 40 秒 |
| runner image の container（他の作成と重ならないとき） | 3 分 2 秒、2 分 51 秒 |
| 止めた container の `start` | 0.58〜0.59 秒 |
| `stop`（PID 1 が SIGTERM を無視する `sleep`） | 5.3 秒（5 秒の timeout） |
| `stop`（`--init` あり） | 1 秒 |
| `rm` | 4〜25 秒（途中で止めた作成は 65 秒） |
| `container system stop` / `start` | 5.4 秒 / 3 秒 |

- **container ごとに、約 513 GiB の `rootfs.ext4` が host の disk に実際に確保される。** image の snapshot は 512 GiB の sparse な ext4 で、確保されているのは 1〜2 GB だけだった。container を作ると、それを sparse でない file として container の dir に写す。`stat` の block 数は file の大きさと同じで、container を 1 つ消すと free space が 513 GiB 戻った。`initfs.ext4` の 640 MB も container ごとに確保される。
- 最初の start にかかる時間の大半は、この 512 GiB の書き出しだった（書き出しの間、file の大きさが 1 秒に約 3.6 GB 伸びた）。#14 で 1.1.0 が 6〜7 分かかった原因も、同じ処理とみられる。
- 測定の途中で、container 2 個と作成中の 1 個で **host の disk が 100% になった**（free 1.8 GiB）。作成中の container を止めて消して戻した。disk が詰まると書き出しは 1 秒に 21 MB まで落ちた。
- **作成中の container があると、動いている別の container への `container exec` が、その作成が終わるまで返らない。** 1 回目は 3 分ほど待たされ、2 回目は 9 分半待っても返らなかった（disk が詰まっていた間）。`container list` は返った。
- 既定の資源は CPU 4・memory 1 GB（`container system property` の `[container]`）。
- upstream には、container の disk の容量を設定できるようにする要望 [container#887](https://github.com/apple/container/issues/887)（open）と、snapshot は sparse だという回答 [container#784](https://github.com/apple/container/issues/784)（closed）がある。container の rootfs が sparse でなくなる報告は見つけていない。

推論:

- 1 つの Session に 1 つの container を作る前提（#15）だと、Session を 1 つ作るたびに約 3 分待ち、host の disk を 513 GiB 使う。disk の空きが 1 TB 程度の Mac でも、同時に持てる Session は 1〜2 個になる。止めた container は再び 0.6 秒で起きるが、disk は消すまで戻らない。
- 作成中は他の Session の container に `exec` できないので、Session の作成が他の Session の Run も止める。backend が Run を `exec` で起こす作りなら、この待ちがそのまま見える。
- このままでは「Session ごとの container」を Apple `container` 1.5.0 で回せない。回すなら、container を Bot か Workspace ごとに使い回して Session ごとに dir を分けるか、rootfs の容量を小さくする手段（#887 の `--storage` 相当）を待つことになる。ただし後者は今回の版に無い。

### 資源の上限・init・root fs

実測（[limits.sh](limits.sh)、`--cpus 2 --memory 512M`）:

- `--cpus`: guest の `cpu.max` が `200000 100000` になり、busy loop 4 本を 5 秒回して CPU 時間は 10 秒だった（既定の 4 CPU では 20 秒）。guest の `nproc` は指定より 1 多い。
- `--memory`: `memory.max` が 536870912 になり、uid 1000 が 900 MiB を確保すると OOM で kill された（rc 137、`oom_kill 1`）。VM の MemTotal は指定より約 100 MB 多い。
- PID: CLI に PID の上限は無い（[container#2401](https://github.com/apple/container/issues/2401) は open）。`pids.max` は既定で `max`。guest の root が `/sys/fs/cgroup/pids.max` に 64 を書くと効き、uid 1000 の fork は `Resource temporarily unavailable` で止まった。uid 1000 は `pids.max` を書き換えられなかった（EACCES）。cgroup 全体にかかるので、上限に達している間は root の `exec` も fork できない。
- `container run --ulimit nproc=512:512` は PID 1 と、そのあとの `exec` で起こした process の両方に効いた。`container exec --ulimit` は効かなかった（`ulimit -u` が既定の値のまま）。
- `--init` があると PID 1 が `/.cz-init` になり、親を失って終わった process を回収した（zombie 0）。無いと PID 1 の `sleep` の下に zombie が溜まり続けた。runner で Bash tool を cancel したあとも、`--init` の下では子が残らなかった。
- `--read-only` で root fs が ro になり、uid 1000 も root も `/app` や `/etc` に書けない。`--tmpfs /tmp` は使えるが、`noexec` は付かず、`/tmp` に写した実行 file を uid 1000 が実行できた。`--tmpfs` に mount の option を渡せるかは試していない。
- `-u`・`--uid`・`--gid`・`--cap-drop`・`--read-only-path`・`--masked-path` がある。

推論:

- PID の上限は、`--ulimit nproc` を `container run` に付けるか、起動直後に guest の root が `pids.max` を書くかで付けられる。container ごとに VM が分かれるので、uid 1000 の `nproc` はそのまま container 単位の上限になる。
- init は `--init` で足りる。#16 で runtime が PID 1 のときに残った zombie は、これで出ない。

### 共有 dir の所有者

実測:

- virtiofs で mount した host の dir と file は、guest では **覗いた process の uid の持ち物に見える**。root が `ls` すると uid 0、uid 1000 が `ls` すると uid 1000 で、host の mode が 0700 の dir にも uid 1000 が書けた。host 側では、guest のどの uid が作った file も host のユーザーの持ち物になる。

推論:

- 共有 dir の中で、guest の root と uid 1000 を mode で分けることはできない。runner に書かせたくない file（inbound の mailbox など）は、`--mount ...,readonly` で別に mount する必要がある。

### 共有 dir の SQLite と JSONL（#22 の入力）

実測（[sqlite.sh](sqlite.sh)、[mailbox.sh](mailbox.sh)。host の SQLite は 3.51.0、guest は 3.49.2）:

| 形 | rollback journal（DELETE） | WAL |
|---|---|---|
| 両側が同じ DB に read-modify-write を同時に 5〜6 秒 | **更新が消えた**。counter は 297 で、host の 9044 回は消え、guest は 16101 回 `disk I/O error`・`unable to open database file` | **更新が消えた**。counter は guest の 14300 回分だけで、host の 114709 回が消えた。error は出ない |
| host が書き、guest が開いたままの接続で poll | guest は 50 行のうち 0 行しか見えなかった | 同じく 0 行 |
| guest が書き、host が開いたままの接続で poll | 50 行とも見えた（遅れの中央値 0.06 秒） | 50 行とも見えたが、遅れの中央値 2.7 秒、最大 5.3 秒 |
| 書くのは片側だけ（host は inbound、guest は outbound）、読む側は poll のたびに read-only で開き直す | **両方向とも 50 行が見え、遅れは 0.05〜0.12 秒**。host の読み取りで `attempt to write a readonly database` が 1 回 | guest の読み取りで `disk I/O error` が 18 回、host の読み取りで `unable to open database file` が 27 回 |
| 書いている側を kill -9 したあと | `integrity_check` は ok、両側とも開き直して書けた | 同じ |

- `PRAGMA integrity_check` は、更新が消えた場合も含めてすべて `ok` だった。
- JSONL: 片側だけが追記し、もう片側が file を開き直して読むと、両方向とも 50 行が見え、途中で切れた行は無かった（遅れは 0.1 秒以内）。**両側が同じ file に同時に追記すると、guest の行が host の行で上書きされて消え**、切れた行が 1 行残った。追記する側を kill -9 しても、それまでの行は読めた。

推論:

- host と guest の間で SQLite の lock も WAL の共有 memory も効かない。同じ DB に両側から書くと、error も破損も出ないまま更新が消える。
- NanoClaw と同じ「inbound は backend だけ、outbound は runner だけが書く」形なら、rollback journal の DB を読む側が poll のたびに開き直すことで使える。WAL は使えない。読む側の一時的な error には retry が要る。
- JSONL も「1 つの file に書くのは片側だけ」にすれば使える。

### Agent SDK の runner（#16 の入力）

実測（[sdk.sh](sdk.sh)。`--network none --init --read-only --tmpfs /tmp --dns 127.0.0.1`、runner は `exec -u 1000`）:

- 書き込める dir 4 つのうち `CLAUDE_CONFIG_DIR`・`HOME`・`cwd` を host の Session の dir から mount し、`/tmp` を tmpfs にした。runner は uid 1000 で動き、transcript は host の `cfg/projects/-work/` に書かれた。
- `ANTHROPIC_BASE_URL=http://127.0.0.1:8080` から guest の shim と mount した UDS を通って、host の偽の endpoint に届いた。`apiKeySource` は `ANTHROPIC_API_KEY`（placeholder）。
- **resume**: 1 個目の container で session を作り、container を消して同じ mount で作り直した 2 個目で `resume` すると、同じ session id で続き、前の発言を覚えていた（`sameSession: true`）。
- Gateway 以外への接続の試み（sidecar の記録）:

| 設定 | 試みた宛先 |
|---|---|
| 何も付けない | 1 回の `query()` で `api.anthropic.com` の名前解決を 6 回、443 への接続を 5 回 |
| `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` | なし |
| 何も付けずに WebFetch | 上と同じ `api.anthropic.com` に加え、preflight が失敗して "Unable to verify if domain example.com is safe to fetch" |
| `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` と `skipWebFetchPreflight` で WebFetch | `example.com` の名前解決と 443 への接続だけ |

推論:

- #16 を Docker で測った結果と同じで、Apple `container` の共有 dir でも runner は動き、resume も続く。
- `--network none` では、sidecar の DNS が無ければこれらの試みは名前解決の時点で失敗する。WebFetch を Gateway の tunnel に通す設定は、#1 の「HTTPS CONNECT/TLS 終端」で決める。

### 再起動のあと

実測（[restart.sh](restart.sh)）:

- container の `stop`・`start`、`container system stop`・`start` のあとも、probe の結果は最初と同じだった（REACHED は Gateway の 2 つだけ）。
- `container system stop` は動いている container を止め、`system start` のあとも container は自動では起きなかった。起こすと 0.6 秒で動いた。
- Mac の再起動のあとは [reboot-check.sh](reboot-check.sh) で測る（下の「未実施」）。

## 使いやすさ

| 観点 | 結果 |
|---|---|
| setup の手数 | 署名付き installer を入れるのに管理者の password が 1 回要る（今回は事前に済）。`container system start` は管理者権限なしで、初回は vminit を 66 MB 取得する。kernel は既に入っていた。feature flag は無い。**macOS 26 が要る**。apiserver は `gui/<uid>` の LaunchAgent で動く |
| Session を作ったときの待ち時間 | 新しい container は約 3 分（disk が詰まるともっと）、止めた container は 0.6 秒。作成中は他の container に `exec` できない |
| disk | container 1 つにつき約 513 GiB を実際に確保する |
| NanoClaw の runner のコードの読み替えやすさ | CLI の flag は `docker run` に近い（`-v`・`-e`・`-u`・`--read-only`・`--tmpfs`・`--init`・`--cpus`・`--memory`）。違うのは、network を `--network none` にして Gateway を socket の file で mount すること、PID の上限を `--ulimit nproc` か `pids.max` で付けること、mount の中で uid を分けられないこと、Docker の `--internal` network と中継の container が要らないこと |

## 未実施

- Mac の再起動のあとの確認。`momo-cmp-a-keep` を残してあり、親が [reboot-check.sh](reboot-check.sh) を流す。
- 別 Workspace の sandbox の間の到達。どちらも `--network none` で network を持たず、AF_VSOCK も開いていないので、経路は見つかっていない。
- `--tmpfs` に `noexec` などの option を渡せるか。
- rootfs の容量を小さくする方法。CLI の help と property には見当たらなかった。
- container の数を増やしたときの memory の重さ（VM ごとに約 100 MB 多い）。
- AF_VSOCK の 65536 以上の port。

## 検証証拠（SECURITY-ACCEPTANCE K）

| 項目 | 状態 | 証拠/再現コマンド | 残る制約 |
|---|---|---|---|
| Workspace越境 | 未実施 | — | 別 Workspace の container の間は network が無く、AF_VSOCK も閉じていた。直接の試験はしていない |
| 秘密非露出 | 未実施 | 実 token を使っていない | placeholder の key で runner が動くことだけを確かめた |
| 再起動復旧 | Gateway・container・`container system` の再起動は pass、Mac の再起動は未実施 | `gw-restart.sh`、`restart.sh`（模擬） | Gateway の停止中に同じ path を取った process には届く。dir を 0700 にする |
| 外部効果 | pass（Gateway 以外へ出ない） | `run.sh probe`、`run.sh vsock`、`tools/netprobe.ts`、host の囮の log（模擬） | — |

## Mac の再起動のあと（2026-10-16 に実測）

`sh reboot-check.sh` を、再起動して login した 4 分後に、何も起こす前に流した。

- apiserver は launchd に残らず、`container system status` は "not registered with launchd" だった。`container system start` は 1 秒で返った。
- `momo-cmp-a-keep` は stopped のままだった。Gateway の socket が無いと `container start` は失敗し、socket を置くと 1 秒で起きた。
- uid 1000 の probe は、Gateway の UDS と lo の shim だけに届き、ほかはすべて塞がった。host の囮の log は `listening` だけだった。
- 再起動の前に作った Agent SDK の session を resume でき、`sameSession: true` になった。
- 推論: 再起動のあとは momo が `container system start` を呼ぶ必要がある。Gateway の socket の dir は TMPDIR の下では消えるので、momo のデータ dir に置く。
