# Slack の token は Install to Workspace で得て、所有者が貼る

v1 の Slack 接続では OAuth の redirect を使わない。所有者は momo が出す manifest で、配布しない Slack App を作る。設定画面の Install to Workspace で install し、Bot token・User token・app-level token を momo に貼る。momo は client secret と signing secret を持たない。token rotation は manifest で無効に固定する。User token は任意で、無いときは所有者の Slack user id を、所有者が Bot に DM で送る 1 回限りの合言葉から得る。

こう決めたのは、redirect を使う経路が、どれも既に決めた形とぶつかるか、確かめられないからである。HTTPS の server redirect には公開の callback が要り、受信を Socket Mode に限った理由（公開の受け口を持たない）に反する。desktop PKCE の redirect は bot scope を要求できない。PKCE を有効にしたことのない App の `http://localhost` は、docs の記述が食い違い、`momo.localhost` を redirect 先にできるかも書かれていない。一方、Socket Mode の app-level token は OAuth では得られず、所有者はどの経路でも設定画面を開く。手で貼る値の数は redirect の経路とほぼ変わらない。

## Considered Options

- PKCE を有効にしたことのない App の localhost への redirect。momo の中で同意が完結し rotation も選べるが、Slack が受け付けるかを実測するまで決められず、通らなければこの形に戻る。
- User token だけを desktop PKCE の別 App で得る。Workspace と Slack team の組ごとに App を 1 つにする形に反する。
- NanoClaw と同じく、manifest API と config token で App を自動で作って入れる。後の版にした。

## Consequences

- token に期限が無い。Slack の社員によると、rotation を有効にした App は Install to Workspace ではなく OAuth の flow で install する必要がある。Slack 側で rotation を一度有効にすると戻せないので、UI で有効にしないよう注意を出す。
- scope を足すと、所有者が設定画面で reinstall して貼り直す。それまで既存の token は古い scope のまま動く。
- 配布しない App は Enterprise org 単位では入れられないので、v1 は Slack team 単位の install だけを扱う。App の承認制がある team では、install が admin への申請になる。
- momo で Connection を消すと、Slack 側でもその token を `auth.revoke` で失効させる。rotation の無い App では Bot token の失効で installation ごと消え得るので、Bot を消すときは User の Connection も失効すると示す。
