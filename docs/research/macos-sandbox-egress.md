# macOS で sandbox の通信を Gateway だけに絞る方式

- ticket: [#3](https://github.com/ashigirl96/momo/issues/3)（map [#1](https://github.com/ashigirl96/momo/issues/1)）
- 確認日: 2026-10-15。文書・release notes・source を読んだだけで、install も実行もしていない。
- 表記: **確認** は一次情報の引用と URL がある事実。**推論** は確認した事実から導いた判断。**未確認** は実機で測るまで分からないこと（[#14](https://github.com/ashigirl96/momo/issues/14) に渡す）。

## 結論

1. Docker Desktop for Mac の既定構成（bridge と `HTTP_PROXY`）では Gateway だけに絞れない。container の通信はすべて host の `com.docker.backend` から出る。`host.docker.internal` は host の localhost として扱われる。このため、直結も、host の 127.0.0.1 で待つ他の port への接続も通ると見るべきである。NanoClaw `f2934ab` もこの既定構成で動き、文書に "Default: egress is open." と書いている。
2. VM に NIC を持たせず、host の UDS を 1 本だけ中継する方式が、Gateway だけに絞る形にいちばん近い。macOS で使える候補は次の 3 つ。
   - Apple `container` 1.5.0 の `--network none` と、UDS の bind mount（vsock で中継される）。macOS 26 が要る。
   - Docker Desktop 4.40 以降の `--network none` と、UDS の bind mount。4.87 の時点では Docker VMM と feature flag が要る。
   - Docker Sandboxes（`sbx`）の Locked Down と `localhost:<port>` の許可。Docker の policy proxy を経由する別製品である。
3. VM を使わない候補として、Seatbelt（`sandbox-exec`）がある。sandbox-runtime と同じく、profile で 1 つの localhost port か 1 つの UDS だけを許す。UDP/QUIC/ICMP と他の port は塞げる。ただし kernel を host と共有し、API は deprecated で、system resolver 経由の DNS が塞がるかは文書の記述が食い違う。
4. Docker の `--internal` network と中継 container の組み合わせも成り立つ（NanoClaw の egress lockdown、Docker の mcp-gateway と同じ形）。この場合、中継 container は internet と host の loopback に届くので、信頼する部品として最小にする必要がある。
5. 使えない、または補助にしかならないもの:
   - container 内の iptables（Claude Code の reference dev container）。UDP 53、TCP 22、host の /24 を宛先を問わず開け、IPv6 を扱っていない。
   - Docker Desktop の ECI と `containersProxy`。Business subscription が要り、`containersProxy` は TCP しか扱わない。
   - Lima と colima。user-mode の NIC を外す設定がなく、`host.lima.internal` から host の 127.0.0.1 の全 port に届く。
   - host の pf。VM の NAT 経由の通信は user を判別できず、pf は既定で有効にならない。

## 塞ぐ経路と評価の軸

[SECURITY-ACCEPTANCE](../planning/SECURITY-ACCEPTANCE.md) D 節に合わせて、各候補を次の経路で評価する。

- 直接の internet（proxy の環境変数を無視する program を含む）
- DNS
- IPv6
- UDP/QUIC
- IP literal
- host の他の port（backend や securityd の管理面）
- host gateway
- metadata と private IP
- Gateway が止まったときに fail closed になるか、再起動で制限が外れないか

## 候補ごとの評価

### D1. Docker Desktop の既定 bridge と `HTTP_PROXY`（NanoClaw の既定）

仕組み: container を既定の bridge に置き、`HTTPS_PROXY=http://host.docker.internal:<port>` で Gateway を指す。

確認:

- "All outbound container network traffic originates from the `com.docker.backend` process." [Docker Desktop networking](https://docs.docker.com/desktop/features/networking/)
- `host.docker.internal` は "Resolves to the internal IP address of your host"。[networking how-tos](https://docs.docker.com/desktop/features/networking/networking-how-tos/)
- Docker 自身が、air-gapped containers の PAC の例で `host === "host.docker.internal" || host === "localhost"` を "Block access to developer's localhost" として扱っている。[air-gapped containers](https://docs.docker.com/desktop/enterprise/hardened-desktop/air-gapped-containers/)
- Docker Sandboxes の文書: "The sandbox proxy translates `host.docker.internal` to `localhost` before forwarding the request." [sandboxes development](https://docs.docker.com/ai/sandboxes/workflows/development/)
- NanoClaw `f2934ab` の network 引数は、lockdown が無効なら macOS で何も付けない（`return os.platform() === 'linux' ? [...host-gateway] : []`）。[src/drivers/index.ts L80-L87](https://github.com/nanocoai/nanoclaw/blob/f2934abaf2d89f5b95b19ac1809a0ddc1eda1f79/src/drivers/index.ts#L80-L87)
- NanoClaw の SECURITY.md: "The `HTTPS_PROXY` env var only redirects *proxy-aware* clients — a tool that ignores it (or a raw socket) could reach the internet directly"、"**Default: egress is open.**" [docs/SECURITY.md L179-L215](https://github.com/nanocoai/nanoclaw/blob/f2934abaf2d89f5b95b19ac1809a0ddc1eda1f79/docs/SECURITY.md#L179-L215)
- Agent SDK の文書も "Note that not all programs respect `HTTP_PROXY`/`HTTPS_PROXY`." と書く。[secure-deployment](https://code.claude.com/docs/en/agent-sdk/secure-deployment#traffic-forwarding)

推論: すべての経路が開いている。host の 127.0.0.1 に bind した管理面も、`host.docker.internal:<port>` で届く可能性が高い。旧 VPNKit の source は host の IP 宛てを localhost へ中継していた。現行の gVisor の stack については文書に明記がない。host 側の firewall では、container の通信と Docker Desktop 自身の通信を `com.docker.backend` として区別できない。

未確認: 現行の Docker Desktop で、host の 127.0.0.1 にだけ bind した service へ `host.docker.internal` から届くか。

### D2. Docker Desktop の `--network none` と、host の UDS の bind mount

仕組み: Agent SDK の文書が示す構成そのもの。`--network none` で NIC をなくし、host の Gateway の UDS を `-v` で mount する。container の中では socat などの shim で TCP の proxy port を UDS に変換する。

確認:

- Agent SDK: "With `--network none`, the container has no network interfaces at all. The only way for the agent to reach the outside world is through the mounted Unix socket" [secure-deployment#containers](https://code.claude.com/docs/en/agent-sdk/secure-deployment#containers)。この例は Linux を前提にしている。
- none driver: "Within the container, only the loopback device is created."、"No IPv6 loopback address is configured for containers using the `none` driver." [none driver](https://docs.docker.com/engine/network/drivers/none/)
- 4.40.0（2025-03-31）の Mac 向け: "Docker Desktop now allows Unix domain sockets to be shared with containers"。4.86.0: "AF_UNIX sockets shared over VirtioFS now work in both directions (host to guest and guest to host)."。4.93.0: "Fixed a security vulnerability that allowed VM-side code to request Unix socket port forwards, which could expose arbitrary host paths to manipulation." [Docker Desktop release notes](https://docs.docker.com/desktop/release-notes/)
- Docker の engineer の 2026-08-17 の comment: "try the latest Docker 4.87, ensure you're using Docker VMM"、"Ensure you have the system process `com.docker.sailor` running (otherwise the feature flag might not be enabled" [docker/for-mac#483](https://github.com/docker/for-mac/issues/483#issuecomment-5318394126)
- 2026-10-15 時点の最新版は 4.95.0（2026-10-12）。[release notes](https://docs.docker.com/desktop/release-notes/)

推論:

- NIC がないので、直結、DNS、IPv6、UDP、IP literal、host の他の port、host gateway、metadata/private IP はすべて塞がる。
- Gateway が止まれば UDS への connect が失敗し、他に経路がないので fail closed になる。
- `--network none` は container の設定なので、`docker start` をやり直しても外れない。
- 弱点は UDS の共有が feature flag と VMM の種類に左右されることである。Docker Desktop の更新や flag の配信で挙動が変わりうる。4.93.0 で直った脆弱性のとおり、UDS の中継の仕組み自体も攻撃面になる。

未確認:

- 使う Docker Desktop の版と VMM で、UDS の mount が動くか。
- Gateway を止めたときに、中継が connect を即座に失敗させるか。
- Gateway を再起動したあとに、同じ path で再接続できるか。

### D3. Docker の `--internal` network と中継 container

仕組み: agent を `--internal` network だけに置く。internal network と通常の network の両方につないだ中継 container が、決め打ちの宛先 `host.docker.internal:<Gateway port>` だけへ TCP を転送する。

確認:

- `--internal`: "no default route is configured and firewall rules are set up to drop all traffic to or from other networks. Communication with the gateway IP address (and thus appropriately configured host services) is possible" [docker network create](https://docs.docker.com/reference/cli/docker/network/create/)
- internal network でも bridge には address が付き、"containers in the network can access host services listening on that bridge address (including services listening on "any" host address, `0.0.0.0` or `::`)"。gateway mode を `isolated` にすると "No address is assigned to the bridge"。[port publishing](https://docs.docker.com/engine/network/port-publishing/)
- Engine 26.0.0（CVE-2024-29018）: "Do not forward requests to external DNS servers for a container that is only connected to an 'internal' network." [Engine 26.0 release notes](https://docs.docker.com/engine/release-notes/26.0/)
- NanoClaw の egress lockdown はこの形をとる。`network create --internal nanoclaw-egress` を作り、gateway の container を alias 付きで接続する（[src/egress-lockdown.ts L62-L99](https://github.com/nanocoai/nanoclaw/blob/f2934abaf2d89f5b95b19ac1809a0ddc1eda1f79/src/egress-lockdown.ts#L62-L99)）。既定では無効で（[src/config.ts L104-L108](https://github.com/nanocoai/nanoclaw/blob/f2934abaf2d89f5b95b19ac1809a0ddc1eda1f79/src/config.ts#L104-L108)）、文書は "a gateway that lives on the host or in a session-local container cannot join an internal network, and lockdown refuses rather than degrading" と書く。[docs/SECURITY.md](https://github.com/nanocoai/nanoclaw/blob/f2934abaf2d89f5b95b19ac1809a0ddc1eda1f79/docs/SECURITY.md#L179-L215)。OneCLI の skill はこれを有効にしない。
- Docker の `docker/mcp-gateway` は、internal の `docker-mcp-proxies-int` と外向きの `docker-mcp-proxies-ext` を作り、両方に proxy sidecar をつなぐ。[proxy.go L42-L65](https://github.com/docker/mcp-gateway/blob/a34df45d4ec0e941a9853ad768c4f6cd818966b3/pkg/gateway/proxies/proxy.go#L42-L65)

推論:

- Docker Desktop では、bridge の gateway は Linux VM 側の address であり macOS ではない。internal network から `host.docker.internal` には route がない。
- 中継 container は internet と host の loopback の全 port に届く。宛先を固定した、それ以外のことをしない部品にする必要がある。
- 同じ internal network に複数の agent を置くと agent 同士が届く。NanoClaw は 1 つの network を全 agent で共有している。Run ごとに network を分けるか、中継の待ち受けを Run ごとにする必要がある。
- Gateway が止まると中継の connect が失敗するので、fail closed になる。
- network は engine の状態として VM の disk に残る。一方、"Clean up data" や factory reset では消える。そのため起動のたびに冪等に作り直し、作れなければ起動を拒む必要がある（NanoClaw の fail-fast と同じ）。

未確認:

- Docker Desktop の internal network から、gateway の IP、`192.168.65.x`、`169.254.169.254`、IPv6、UDP 53、`*.docker.internal` の名前に届くか。gateway mode `isolated` の有無で差が出るか。
- 起動の途中に経路が広がる瞬間がないか。

### D4. container 内の iptables（Claude Code の reference dev container）

確認:

- `init-firewall.sh` は `iptables -A OUTPUT -p udp --dport 53 -j ACCEPT` と `iptables -A OUTPUT -p tcp --dport 22 -j ACCEPT` で宛先を問わず DNS と SSH を開け、既定 route から求めた host の /24 全体を許す。ip6tables の行はない。[init-firewall.sh L27-L35, L92-L109](https://github.com/anthropics/claude-code/blob/94506ff0d3bd9185f1752da36e968775021fb48f/.devcontainer/init-firewall.sh#L27-L109)
- `--cap-add=NET_ADMIN` と `--cap-add=NET_RAW` を付け、`"postStartCommand": "sudo /usr/local/bin/init-firewall.sh"` で起動のたびに流す。[devcontainer.json](https://github.com/anthropics/claude-code/blob/94506ff0d3bd9185f1752da36e968775021fb48f/.devcontainer/devcontainer.json#L12-L56)

推論: rule は container の network namespace にあり、dev container の tool を通さずに起動すると適用されない。つまり再起動で fail open になりうる。agent が root か `NET_ADMIN` を得ると rule を消せる。DNS tunnel、IPv6、host の他の port を塞がない。Gateway だけに絞る用途には向かず、外側の制限に重ねる補助にとどまる。

### D5. Docker Desktop の管理機能（ECI、air-gapped containers）

確認:

- Settings Management の前提は "A Docker Business subscription" と "Enforce sign-in" で、"If either condition isn't met, the settings file is ignored."。[configure-json-file](https://docs.docker.com/desktop/enterprise/hardened-desktop/settings-management/configure-json-file/)
- `containersProxy` は "intercepts container TCP connections and applies proxy rules only for ports listed in `transparentPorts`"。設定がなければ "running container traffic bypasses `containersProxy` entirely"。"Hostname is available for ports 80 and 443, but only IP addresses for other ports."、"If PAC file download fails, containers block requests to target URLs."、"Advanced users might bypass restrictions through various means" [air-gapped containers](https://docs.docker.com/desktop/enterprise/hardened-desktop/air-gapped-containers/)
- host networking は Enhanced Container Isolation が有効だと動かない。[host driver](https://docs.docker.com/engine/network/drivers/host/)

推論: ECI に egress の policy はない。`containersProxy` は UDP、QUIC、DNS を扱わない。個人利用のローカル v1 で Business subscription を前提にするのは、BRIEF の想定と合わない。

### DS. Docker Sandboxes（`sbx`）

確認:

- microVM で動き、Docker Desktop を必要としない別製品。[Claude Code の sandbox-environments](https://code.claude.com/docs/en/sandbox-environments#virtual-machine)
- "All outbound TCP traffic passes through a proxy on your host"、"The sandbox routes traffic through either a forward proxy or a transparent proxy depending on the client's configuration."、"Both enforce the network policy."、"Outbound UDP is disabled by default."、"ICMP is blocked."、"DNS queries use the sandbox's internal resolver, which enforces network policy."、"TCP connections are allowed only when a policy rule matches the destination." [sandboxes isolation](https://docs.docker.com/ai/sandboxes/security/isolation/)
- 127.0.0.1 と LAN の IP は "not reachable from inside the sandbox"。host の service には `sbx policy allow network localhost:11434` のように port を指定して許可し、`host.docker.internal` で接続する。[sandboxes development](https://docs.docker.com/ai/sandboxes/workflows/development/)
- 0.45.0: "Network and filesystem access now fail closed with accurate errors when policy evaluation fails"。0.47.0（2026-10-05、最新）の notes に、v0.46.0 で直った "raw TCP connections to denied hostnames being permitted by an allow rule for the hostname's resolved IP address" がある。[sandboxes release notes](https://docs.docker.com/ai/sandboxes/release-notes/)
- "SSH agent forwarding is enabled by default."。clipboard への書き込み、host で動く stdio MCP server、host で走る lifecycle の command がある。[sandboxes isolation](https://docs.docker.com/ai/sandboxes/security/isolation/)

推論: 経路は proxy で強制されるので、環境変数を無視する program も policy に従う。Locked Down で `localhost:<Gateway port>` だけを許せば、Gateway だけに絞る形に近い。ただし Docker の policy proxy が Gateway の手前に入る。SSH agent の転送などの host 向けの経路を個別に閉じる必要もある。

未確認:

- 自前の agent-runner の image と process の形で動かせるか。
- IPv6 をどう扱うか。
- policy が再起動後も残るか。
- Gateway の CONNECT/TLS 終端と二段の proxy になったときに動くか。

### AC. Apple `container` の `--network none` と UDS の中継

仕組み: container ごとに軽量の VM を立てる。`--network none` で NIC を持たせず、Gateway の UDS を `-v` で mount すると、Containerization が vsock で host の UDS へ中継する。

確認（`apple/container` 1.5.0、2026-09-29、`d265d669`。Containerization 0.47.0 を固定している）:

- "it runs a lightweight VM for each container that you create"。network には vmnet を使う。[technical-overview](https://github.com/apple/container/blob/1.5.0/docs/technical-overview.md)
- "`container` is supported on macOS 26"。[README](https://github.com/apple/container/blob/1.5.0/README.md)
- 0.6.0 の release notes: "Add `container run --network none` for containers with no network connectivity"。[0.6.0](https://github.com/apple/container/releases/tag/0.6.0)
- source では、`none` を指定すると `config.networks = []` になり、他の network との併用は "no other networks may be created along with network none" で拒まれる。[Utility.swift L198-L205](https://github.com/apple/container/blob/1.5.0/Sources/Services/ContainerAPIService/Client/Utility.swift#L198-L205)。`--network none` は command-reference には載っていない。
- socket を source とする mount は `UnixSocketConfiguration(..., direction: .into)` になる。[RuntimeService.swift L1153-L1168](https://github.com/apple/container/blob/1.5.0/Sources/Services/RuntimeLinux/Server/RuntimeService.swift#L1153-L1168)。`.into` は "sharing a unix socket on your host into the container/guest"。[UnixSocketConfiguration.swift](https://github.com/apple/containerization/blob/0.47.0/Sources/Containerization/UnixSocketConfiguration.swift)
- 中継は guest からの vsock の接続ごとに host の UDS へ `hostSocket.connect()` し、失敗すればその接続を閉じる。[UnixSocketRelay.swift L136-L216](https://github.com/apple/containerization/blob/0.47.0/Sources/Containerization/UnixSocketRelay.swift#L136-L216)
- `container network create --internal` は host-only network で、container は host と通信できる。host の service に届く文書上の経路は `container system dns create ... --localhost <ip>` で、pf の rdr を入れる。docs には "The local domain packet filter rule is removed on a restart." とある。[host-integration](https://github.com/apple/container/blob/1.5.0/docs/host-integration.md)。この rdr は宛先を `127.0.0.1` にする。[PacketFilter.swift L59](https://github.com/apple/container/blob/1.5.0/Sources/Services/ContainerAPIService/Client/PacketFilter.swift#L59)

推論:

- NIC がないので、D2 と同じくすべての経路が塞がる。中継は VM の外の host の process が行い、Docker Desktop の feature flag にも依存しない。
- Gateway が止まると各接続の connect が失敗するので、fail closed になる。Gateway が同じ path で再起動すれば、新しい接続は path を引き直すので戻る。
- `--localhost` の rdr は port を区別しないので、host の 127.0.0.1 の管理面まで開く。使わない。
- NanoClaw は 2.0.0 で Apple container を既定の setup から外し、2.1.17 で `convert-to-apple-container` skill を廃止した（[CHANGELOG L203, L259](https://github.com/nanocoai/nanoclaw/blob/f2934abaf2d89f5b95b19ac1809a0ddc1eda1f79/CHANGELOG.md#L259)）。同じ CHANGELOG には、Apple Container の利用者向けに "do NOT run `/init-onecli`, it requires Docker." とある（L270）。OneCLI の導入が Docker を前提にしていたことは読み取れるが、Apple container をやめた理由の全体は確認していない。

未確認:

- `--network none` のとき guest に `lo` があって up になっているか。NIC も IPv6 もないか。DNS、UDP、IP literal が失敗するか。
- 中継が非 root の user で動き、Gateway を止めると接続が即座に閉じるか。
- socket がないとき起動が失敗するか。`container stop/start`、`container system stop/start`、host の再起動のあとも同じか。
- guest から AF_VSOCK で、host 側の他の vsock port（stdio 用など）に届かないか。

### L. Lima と colima

確認（Lima v2.2.1、colima v0.10.3）:

- "By default Lima only enables the user-mode networking aka "slirp"."、"The loopback addresses of the host is `192.168.5.2` and is accessible from the guest as `host.lima.internal`." [user.md](https://github.com/lima-vm/lima/blob/v2.2.1/website/content/en/docs/config/network/user.md)。gvproxy は gateway を `127.0.0.1` へ NAT する。[gvproxy.go L80-L81](https://github.com/lima-vm/lima/blob/v2.2.1/pkg/networks/usernet/gvproxy.go#L80-L81)
- `portForwards` の `reverse` は "can only be used for unix sockets right now"。既定で guest の 127.0.0.1 の 1-65535 を host の 127.0.0.1 へ forward する fallback の rule が付く。[default.yaml L543-L560](https://github.com/lima-vm/lima/blob/v2.2.1/templates/default.yaml#L543-L560)
- VZ の driver は user-mode の NIC を常に付ける。[vm_darwin.go L414-L448](https://github.com/lima-vm/lima/blob/v2.2.1/pkg/driver/vz/vm_darwin.go#L414-L448)
- colima は常に `user-v2` を付け、`PortForward` に `Reverse` の field がない。[yaml.go L139-L141](https://github.com/abiosoft/colima/blob/v0.10.3/environment/vm/lima/yaml.go#L139-L141)

推論: NIC を外す設定がないため、guest の中の nftables に頼るしかない。既定では guest に passwordless sudo があり、agent がその rule を外せる。現状では候補から外す。

### S. Seatbelt（`sandbox-exec`）で host のプロセスごとに絞る

仕組み: agent-runner を host のプロセスとして `sandbox-exec -p <profile>` で起動する。profile を `(deny default)` にし、network は Gateway の `localhost:<port>` 1 つか UDS の path 1 つだけを許す。VM がないので、host の UDS をそのまま使える。

確認:

- sandbox-runtime の macOS 実装は、profile を `(deny default ...)` で始める。proxy の port には `(allow network-outbound (remote ip "localhost:${httpProxyPort}"))` だけを足す。UDS は既定で塞ぎ、`allowUnixSockets` に挙げた path だけを開ける。[macos-sandbox-utils.ts L1257-L1346](https://github.com/anthropics/sandbox-runtime/blob/9a277e5e04af1ab1b04feea4400a6ed8a5b72039/src/sandbox/macos-sandbox-utils.ts#L1257-L1346)
- "The Seatbelt profile allows communication only to a specific localhost port." [README L126](https://github.com/anthropics/sandbox-runtime/blob/9a277e5e04af1ab1b04feea4400a6ed8a5b72039/README.md#L126)。外部の proxy の port を `network.httpProxyPort` で指せる。[README L383](https://github.com/anthropics/sandbox-runtime/blob/9a277e5e04af1ab1b04feea4400a6ed8a5b72039/README.md#L383)
- "macOS: the Seatbelt sandbox framework by default blocks connections other than the one to the sandbox proxy"、"Anything that isn't TCP: UDP, HTTP/3 over QUIC, and ICMP tools such as `ping` can't leave the sandbox" [sandboxing](https://code.claude.com/docs/en/sandboxing#network-isolation)
- `allowLocalBinding` を有効にすると、sandbox 内の command が "connect to any port on localhost, which includes every other service listening there"。[sandboxing](https://code.claude.com/docs/en/sandboxing#a-command-fails-to-reach-a-server-on-localhost)
- `(remote ip "localhost:N")` は 127.0.0.1 と ::1 に一致し、`::ffff:127.0.0.1` には一致しない。[macos-sandbox-utils.ts L1523-L1537](https://github.com/anthropics/sandbox-runtime/blob/9a277e5e04af1ab1b04feea4400a6ed8a5b72039/src/sandbox/macos-sandbox-utils.ts#L1523-L1537)
- sandbox-runtime の Windows 節には "DNS resolution via the system resolver is not fenced. ... This mirrors the macOS behaviour." とある。[README L800](https://github.com/anthropics/sandbox-runtime/blob/9a277e5e04af1ab1b04feea4400a6ed8a5b72039/README.md#L800)。一方、macOS の profile は mDNSResponder への mach-lookup を許していない（同 L1100-L1116）。
- `enableWeakerNetworkIsolation` は "opens a potential data exfiltration vector through the trustd service"。`allowAppleEvents` は "removes code-execution isolation"。[README L1067-L1068](https://github.com/anthropics/sandbox-runtime/blob/9a277e5e04af1ab1b04feea4400a6ed8a5b72039/README.md#L1067-L1068)
- "Same-host kernel: Unlike VMs, sandboxed processes share the host kernel." [secure-deployment#sandbox-runtime](https://code.claude.com/docs/en/agent-sdk/secure-deployment#sandbox-runtime)
- macOS 26.6 の man page:
  - `sandbox(7)`: "New processes inherit the sandbox of their parent."、"if the application already has a file descriptor opened for writing, it may use that file descriptor regardless of restrictions."
  - `sandbox-exec(1)`: "The sandbox-exec command is DEPRECATED."

推論:

- 直結、UDP/QUIC/ICMP、IP literal、IPv6、host の他の port、host gateway、metadata/private IP は profile で塞がる。ただし `allowLocalBinding` を使わないことが条件になる。
- Gateway が止まれば、許した宛先が失敗するだけで fail closed になる。制限は exec のたびに付き、子に継承されるので、Gateway の再起動では外れない。
- localhost の port は Gateway が止まっている間に別の process が bind できる。UDS を securityd だけが書ける directory に置くほうが安全である。
- 起動側から fd を漏らさない必要がある。
- 許した mach service（trustd や Apple Events）は、外へ出る経路になる。
- VM の境界がない分、ROADMAP 1.1 節が求める「OS/コンテナ」の境界としては弱い。

未確認:

- `getaddrinfo` による DNS の問い合わせが host の外へ出るか（文書が食い違う）。
- 許した UDS 以外の mach service や XPC 経由で外へ出られないか。
- Claude Agent SDK の native CLI と Bun がこの profile で動くか。

### P. host の pf（補助）

確認（macOS 26.6 の man page と `/etc/pf.conf`）:

- `pf.conf(5)` の `user`: "This rule only applies to packets of sockets owned by the specified user."、"For forwarded connections, where the firewall is not a connection endpoint, the user and group are unknown."、"Only TCP and UDP packets can be associated with users"。
- `/etc/pf.conf` の冒頭: "PF will not be automatically enabled, however. Instead, each component which utilizes PF is responsible for enabling and disabling PF via -E and -X"。

推論:

- Docker Desktop の通信は `com.docker.backend`、つまりログイン中の user の process から出るので、pf の `user` では container を区別できない。
- vmnet の NAT を通る VM の通信は forward の扱いになり、user が unknown になる。
- 起動時に有効化する仕組みを自分で持たない限り、再起動で fail open になる。
- 主の境界にはせず、bridge の interface ごとの rule を重ねる補助として測る程度にとどめる。

## 経路ごとの比較

「塞ぐ」は推論を含む。各節の確認と未確認を参照。

| 候補 | 直結 | DNS | IPv6 | UDP/QUIC | IP literal | host の他 port | host gateway | metadata・private | Gateway 停止 | 再起動後 |
|---|---|---|---|---|---|---|---|---|---|---|
| D1 Docker 既定 + proxy 変数 | 破れる | 破れる | 未確認 | 破れる | 破れる | 破れる見込み | 破れる | 破れる | fail open | 制限なし |
| D2 Docker `none` + UDS | 塞ぐ | 塞ぐ | 塞ぐ | 塞ぐ | 塞ぐ | 塞ぐ | 塞ぐ | 塞ぐ | 未確認 | 版と flag 次第 |
| D3 Docker `--internal` + 中継 | 塞ぐ | 塞ぐ（26.0 以降） | 未確認 | 塞ぐ見込み | 塞ぐ | 中継次第 | `isolated` で塞ぐ | 未確認 | 中継次第 | 作り直しが要る |
| D4 container 内 iptables | 一部 | 破れる | 破れる | UDP 53 が開く | 一部 | /24 が開く | 開く | 一部 | 規則次第 | fail open の恐れ |
| DS Docker Sandboxes | 塞ぐ | policy で制御 | 未確認 | 既定で塞ぐ | 規則次第 | `localhost:<port>` だけ | 塞ぐ | 塞ぐ | policy 次第 | 未確認 |
| AC Apple container `none` + UDS | 塞ぐ | 塞ぐ | 塞ぐ | 塞ぐ | 塞ぐ | 塞ぐ | 塞ぐ | 塞ぐ | fail closed（code から推論） | 未確認 |
| L Lima/colima | 破れる | 破れる | 未確認 | 破れる | 破れる | 破れる | 破れる | 破れる | fail open | 制限なし |
| S Seatbelt | 塞ぐ | 未確認 | 塞ぐ | 塞ぐ | 塞ぐ | 塞ぐ（`allowLocalBinding` なし） | 塞ぐ | 塞ぐ | fail closed | 外れない |

## macOS に固有の注意

- Linux の例はそのまま成り立たない。
  - Agent SDK の UDS mount の例は、Docker Desktop for Mac では 4.40 以降にしか使えず、4.87 の時点では Docker VMM と feature flag が要る。
  - NanoClaw の `--add-host ...:host-gateway` は Linux でしか付かない。
  - Linux では container の localhost は host の localhost と別である。Docker Desktop と Lima では、`host.docker.internal` と `host.lima.internal` が host の localhost へつながる。
- VM の外へ出る通信は、userspace の network stack を通る（Docker Desktop の `com.docker.backend`、Lima の gvproxy）。このため、host の firewall からは container ごとに区別できない。
- UDS は VM の境界を自然には越えない。越えるのは、Apple container の vsock 中継、Docker Desktop の VirtioFS 越しの AF_UNIX（版と flag 次第）、Lima の SSH の reverse forward（colima では設定できない）のような、明示的な中継だけである。
- curl や Node の `HTTP_PROXY` は TCP の proxy を前提にする。UDS だけの sandbox では、sandbox 内の loopback で待つ shim が要る。shim が使う `lo` が `--network none` で使えるかを測る必要がある。

## #14 で実測すること

試す macOS、実行基盤、版（Docker Desktop と VMM の種類、`container`、`sbx`、sandbox-runtime）を記録し、各候補で sandbox の中から次を試す。

1. proxy の環境変数を消して、`https://` の hostname と IP literal へ直結する。IPv4 と IPv6 の両方で試す。
2. DNS を試す。
   - system resolver（`getaddrinfo`）、UDP 53、TCP 53、公開 resolver への直接の問い合わせ。
   - 一意な名前を引いて、NXDOMAIN が返るか（上流に届いた）、ローカルで失敗するかを見分ける。
3. UDP 443（QUIC）と ICMP を試す。
4. host の 127.0.0.1 と 0.0.0.0 に置いたダミーの listener の、Gateway 以外の port へつなぐ。宛先は次の 6 つ。
   - `host.docker.internal`
   - `gateway.docker.internal`
   - `192.168.65.x`
   - `192.168.64.1`
   - `host.lima.internal`
   - host の LAN の IP
5. `169.254.169.254` と、LAN の他の private IP へつなぐ。
6. D3 と AC で、同じ network の他の container や VM に届くか。AC では AF_VSOCK で host の他の port に届くか。
7. Gateway を止めて 1 から 6 をやり直し、Gateway の port や path を別の process が取れるかも見る。
8. Gateway の再起動、container の再起動、実行基盤の再起動、Mac の再起動のそれぞれのあとで、1 から 6 をやり直す。
9. D2 と AC で、UDS の中継を非 root で使えるか、`--network none` で `lo` が使えるかを確かめる。

## 未確認の点

- Docker Desktop の現行の gVisor の stack で、host の 127.0.0.1 の任意の port へ `host.docker.internal` から届くか。
- Docker Desktop の既定の dual-stack で、container から外への IPv6 が通るか。
- "Use kernel networking for UDP" を有効にしたとき、UDP が `com.docker.backend` 以外の経路で出るか。
- Docker Sandboxes で自前の image と process を動かせるか。policy が永続するか。
- Seatbelt で `getaddrinfo` による DNS が外へ出るか。
- NanoClaw が Apple container をやめた理由。
