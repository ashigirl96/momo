# Vault の root key を login keychain に 1 つだけ置き、securityd にだけ読ませる

securityd が持つ秘密（Slack と Google の token、Model credential、ADR-0018 と ADR-0019 の CA の秘密鍵）は、Workspace ごとのランダムな data key で暗号化して security.db に置く。data key は installation 全体で 1 つの root key で包み、root key だけを login keychain（file-based）の item に置く。item の ACL と partition list は securityd だけに合わせ、同じ macOS ユーザーの別の process からは確認なしに読めないようにする。ADR-0004 では会話と記憶を同じユーザーの software から守らないと決めたが、Vault の鍵は守る。Slack の token には期限が無く、setup-token も 1 年もつので、生の値が Mac の外へ出ると被害が長く続くため。

securityd は所有者が source から build し、build し直しても partition ID が変わらない署名を付ける。候補は monica と同じ Keychain の自己署名 identity、所有者の Apple Development 証明書、ad-hoc の順に実機で試し、更新のあとに確認の dialog が出ない最初のものを採る。どれも通らなければ ad-hoc にし、更新ごとに 1 度の dialog を受け入れる。

## Considered Options

- OneCLI 1.42.0 と同じく、鍵を DB と同じ場所の file か環境変数に置く。data dir や backup の複製だけで復号できてしまい、SECURITY-ACCEPTANCE C を満たさない。
- ACL を開けたまま Keychain に置く。build し直しても dialog が出ないが、同じユーザーの process が `security` command で鍵を取り出せる。
- data protection keychain と Secure Enclave。provisioning profile を埋め込んだ app 風の bundle が要り、source から build する形と合わない。
- Workspace ごとに Keychain の item を持つ。Workspace を消すと暗号的に消去できるが、item の数だけ dialog と ACL の手間が増える。
- 作者が Developer ID で署名した binary を配る。dialog は出なくなるが、年額の Apple Developer Program が要り、source から build する形（ADR-0017）から外れる。

## Consequences

- root key は momo の暗号化 backup に入れない。同じ Mac での restore は戻るが、別の Mac では全 Connection をつなぎ直し、Model credential を貼り直し、CA を作り直す。
- Workspace を消すと、包んだ data key と security.db の行を消す。backup に残った行は root key で開けるので、その期間の限界を画面に出す。
- Keychain の item が無いか開けないときは fail closed にする。秘密を捨てて作り直すのは所有者が明示したときだけで、自動ではしない。
- login keychain は daemon の global context からは使えないので、securityd は GUI login の user context で動かす。
- 開発用の build は、本番とは別の service 名の item を使う。
