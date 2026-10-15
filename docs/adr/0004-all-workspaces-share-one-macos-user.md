# 全 Workspace を 1 つの macOS ユーザーで扱い、会話と記憶は同じユーザーの software から守らない

ローカル v1 では、会社用も含めたすべての Workspace を、所有者の macOS ユーザーで動く 1 組の backend と securityd で扱う。`app.db` と `security.db` も Workspace ごとには分けず、それぞれ 1 つにする。会社用 Workspace の会話・記憶・添付は、次の相手からは守る。

- Bot と sandbox
- Workspace の取り違え
- 他の macOS ユーザー
- 電源を切った Mac の持ち出し
- backup の複製

所有者と同じ macOS ユーザーで動く software（開発で入れる package や、sandbox なしで動かす coding agent など）はこれらの file を読めるが、v1 では防がない。

こう決めたのは、この相手を止めるには別の macOS ユーザー以上の分離が要るからである。アプリ単位の暗号化では止まらない。Bun の binary は `allow-dyld-environment-variables` と `disable-library-validation` を持つので、同じユーザーの process は backend に dylib を注入して鍵を取れる。FileVault も、一度 unlock した後の file は守らない。今の会社用途の規程は、これ以上の分離を求めていない。

## Considered Options

- **会社用 Workspace を別の macOS ユーザーで動かす。** 他のユーザーからは `~/Library` が読めなくなる。採らない理由は次のとおり。
  - Docker Desktop は 1 台の Mac で 1 ユーザーしか動かせず、Apple `container` も single-user の設計である。
  - GUI でログインしていないユーザーの keychain を daemon から使う形は、macOS 26 では支援外とされている。
  - 所有者は admin なので、別のユーザーにしても所有者の権限から読める。
- **SQLCipher などで `app.db` を暗号化する。** 上に書いたとおり、同じユーザーの process は止められない。防げるのは file の複製だけで、それは Time Machine からの除外で足りる。ほかにも次の問題がある。
  - bun:sqlite で SQLCipher を動かした実績が見つからない。
  - `drizzle-kit migrate` には、暗号化した DB の key を渡す手段が無い。
  - 添付と Agent SDK の transcript は DB の外に置かれ、平文のまま残る。
- **Workspace ごとに物理 DB を分ける。** すべての file を同じ backend が開くので、分けても越境を防いだ証拠にはならない。さらに次の負担が増える。
  - Channel binding の重複禁止と、Installation の一意性（ADR-0002）を検査するための共有 DB が別に要る。
  - WAL では、複数の file にまたがる transaction が原子的にならない。

## Consequences

- momo のデータ dir は 0700、DB と鍵まわりの file は 0600 にする。初期化のときに、データ dir を Time Machine の対象から外す。
- backup は、momo 自身が暗号化して取るものだけにする。それができる P9 までは、Mac を失うと会話と記憶も失う。Time Machine 以外の backup tool を使うなら、その tool でもデータ dir を除外する。
- 電源を切った Mac の持ち出しへの備えは FileVault に任せる。FileVault が無効なら、起動時に UI で警告する。
- 全 Workspace を 1 つの DB に入れるので、Workspace を消しても行の中身が空きページに残ることがある。そこで `secure_delete` を有効にし、消した行を上書きする。
- 会社用と個人用の sandbox が、同じ Linux kernel を共有してよい。container からの脱出は v1 の脅威モデルに入れない。
- 会社の規程がこれ以上の分離を求めたら、別の macOS ユーザーではなく、別の Mac にもう 1 組の momo を置く。その場合、Installation の一意性と Channel binding の重複禁止は、Mac をまたいでは検査できない。
