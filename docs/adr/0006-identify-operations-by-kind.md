# 外部操作を host ではなく Operation kind で識別する

Grant と承認の要否は、momo の operation catalog が定める Operation kind と対象に対して決め、宛先の host や path には書かない。型付き操作は呼び出しが kind を名乗り、P8 の TLS 終端は host・method・path・body を catalog で kind に写す。同じ API に別名の経路（旧 `www.googleapis.com/gmail/` など）があれば、それも同じ kind に写す。kind に写せない資格情報付きの要求は拒否する。

こう決めたのは、host に書いた規則は、同じ API に届く別名の host を取りこぼすからである。NanoClaw の PR #3115（merge されずに close）は、`gmail.googleapis.com` に書いた OneCLI 1.42.0 の規則を、旧 `www.googleapis.com/gmail/` の経路で迂回できると報告している。kind で書けば、入口が型付き操作でも TLS 終端でも、同じ Grant と承認を通る。

## Considered Options

- OneCLI 1.42.0 と同じく、host・path・method に規則を書く。catalog は要らないが、別名の経路が見つかるたびに規則が漏れる。
- 型付き操作は kind で、TLS 終端は host で書き、両方を持つ。同じ操作に規則が 2 つ並び、片方だけを直す取り違えが起きる。

## Consequences

- catalog に無い API は、資格情報を付けて呼べない。P8 で任意の CLI や SDK を通しても、動くのは catalog にある操作だけになる。
- provider が host や path を増やすと、catalog に写しを足すまでその経路は拒否される。
- 承認カードに出す行も、kind ごとに catalog が決める。OneCLI の app ごとの承認要約とは合わせない。
