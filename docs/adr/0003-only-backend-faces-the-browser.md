# ブラウザに面するのは backend だけにし、login は所有者だけが開ける socket から始める

ローカル v1 の UI は、同じ Mac のブラウザで `momo.localhost` の固定 port を開いて使う。ブラウザが話す相手は backend だけで、securityd はブラウザ向けの listener を持たない。securityd に届くのは、backend からの管理 IPC と、sandbox からの Gateway の実行面の 2 本だけにする。所有者が入力する秘密（client secret、API key、手動で登録する token）も、OAuth の callback が運ぶ code と state も、backend が受けて管理 IPC で securityd に渡す。token との交換は securityd が行う。ブラウザの login は、所有者だけが開ける Unix socket（mode 0600）から `momo open` が受け取る 1 回限りの token で始める。

こう決めたのは、loopback の port には攻撃者も届くからである。Docker Desktop の既定構成では sandbox から host の 127.0.0.1 に届き、sandbox のコードは Host も Origin も偽れる。ブラウザ側の Local Network Access は Safari に無く、Chrome と Firefox でも top-level の navigation は止めない。そこで、秘密をいちばん多く持つ securityd にはブラウザから来た HTTP を解釈させず、届く経路を 2 本に限る。login の起点は、sandbox と他の macOS ユーザーが開けない file permission に置く。

## Considered Options

- securityd が、秘密の入力と callback のための自分の origin を持つ。秘密は Bun を通らないが、login と Origin・Host の検査を securityd にも作ることになり、いちばん守りたい process がブラウザに面する。
- ブラウザが securityd の公開鍵で秘密を暗号化し、backend は暗号文を中継する。Bun は平文を見ない。ただ backend は配る JS を差し替えられるので、防げるのは backend の不注意による漏れだけで、そのために暗号の部品が増える。
- 参照の OneCLI 1.42.0 と同じく、loopback に届いた要求を無認証で所有者として扱う。sandbox や任意の Web page から承認を決裁できてしまうので採らない。
- 最初に開いたブラウザを所有者とみなす。sandbox や他の process と先着を争うことになるので採らない。
- Tauri の殻で TCP の port を無くす。custom protocol は応答を一括でしか返せず SSE を流せないので、v1 では採らない。

## Consequences

- 秘密が backend の memory を一瞬通る。backend は脅威モデルで信頼する側なので境界は崩れないが、秘密を通す route では、本文を log・例外・trace に出さないように保つ。
- 所有者と同じ macOS ユーザーで動く process は socket を開けるので、login を得られる。脅威モデルはログイン中の所有者と host を信頼しているので、これは防がない。
- Workspace を別の backend に分けるなら、host 名も分ける。cookie は port で分かれないため。
