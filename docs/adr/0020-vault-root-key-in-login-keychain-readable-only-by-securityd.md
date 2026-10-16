# Vault の root key を login keychain に 1 つだけ置き、securityd にだけ読ませる

securityd が持つ秘密（Slack と Google の token、Model credential、ADR-0018 と ADR-0019 の CA の秘密鍵）は、Workspace ごとのランダムな data key で暗号化して security.db に置く。data key は installation 全体で 1 つの root key で包み、root key だけを login keychain（file-based）の item に置く。item の ACL と partition list は securityd だけに合わせ、同じ macOS ユーザーの別の process からは確認なしに読めないようにする。ADR-0004 では会話と記憶を同じユーザーの software から守らないと決めたが、Vault の鍵は守る。Slack の token には期限が無く、setup-token も 1 年もつので、生の値が Mac の外へ出ると被害が長く続くため。

securityd は所有者が source から build し、更新のたびに所有者の password か確認を 1 回挟む。Keychain からは、正規の更新と、同じ署名で自分を署名し直した malware を区別できないため。確認なしで署名できる identity が login keychain にあれば、同じユーザーの malware も securityd になりすませる。securityd は `cargo build` の ad-hoc 署名のまま使う。login keychain は item の partition list に作った binary の cdhash を入れるので、build し直した securityd が読むには、macOS の dialog で所有者が login keychain の password を入れる必要がある。別の binary は、同じ identity で署名しても確認なしには読めない。自己署名の identity で署名しても partition は cdhash のままなので、dialog は減らなかった（[実測](https://github.com/ashigirl96/momo/blob/55225af225d336f47f09a90a81deb3870037d29a/docs/research/keychain-signing-measured.md)）。

## Considered Options

- OneCLI 1.42.0 と同じく、鍵を DB と同じ場所の file か環境変数に置く。data dir や backup の複製だけで復号できてしまい、SECURITY-ACCEPTANCE C を満たさない。
- ACL を開けたまま Keychain に置く。build し直しても dialog が出ないが、同じユーザーの process が `security` command で鍵を取り出せる。
- data protection keychain と Secure Enclave。provisioning profile を埋め込んだ app 風の bundle が要り、source から build する形と合わない。
- Workspace ごとに Keychain の item を持つ。Workspace を消すと暗号的に消去できるが、item の数だけ dialog と ACL の手間が増える。
- monica と同じく、login keychain の自己署名 identity か Apple Development 証明書で署名し、更新しても確認を出さない。`codesign` が確認なしに署名できると、同じユーザーの malware も同じ署名を作れ、同じユーザーの process から守るという決定が見かけだけになる。自己署名では、login keychain の partition が cdhash になるので、そもそも確認は消えなかった。
- 署名の identity をふだんは lock した専用の keychain に置き、install の時だけ開く。自己署名では ad-hoc と挙動が同じで、手間だけが増える。
- 作者が Developer ID で署名した binary を配る。dialog は出なくなるが、年額の Apple Developer Program が要り、source から build する形（ADR-0017）から外れる。

## Consequences

- 更新のたびに、最初に Vault を開くときの dialog で login keychain の password が 1 回要る。dialog が出る時と理由を、install の手順に書く。UI を出せないと Vault は開かない。
- 許可した版の cdhash は ACL と partition list に残り続ける。古い版の binary を消さずに残すと、それを起こした process も読める。
- `security create-keychain` で作った keychain には partition list が付かず、同じ identity で署名した別の binary が読めてしまう。なりすましの試験は login keychain と同じ挙動の keychain で行う。
- root key は momo の暗号化 backup に入れない。同じ Mac での restore は戻るが、別の Mac では全 Connection をつなぎ直し、Model credential を貼り直し、CA を作り直す。
- Workspace を消すと、包んだ data key と security.db の行を消す。backup に残った行は root key で開けるので、その期間の限界を画面に出す。
- Keychain の item が無いか開けないときは fail closed にする。秘密を捨てて作り直すのは所有者が明示したときだけで、自動ではしない。
- login keychain は daemon の global context からは使えないので、securityd は GUI login の user context で動かす。
- 開発用の build は、本番とは別の service 名の item を使う。
