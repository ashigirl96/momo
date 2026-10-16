# TLS 終端の CA を、provider の host に NameConstraints で限った専用の CA にする

Gateway が資格情報を付ける要求の TLS を終端するために、installation 全体で 1 つの専用の CA を作る。この CA には NameConstraints を付け、permitted の範囲を securityd の catalog にある provider の host に限る。秘密鍵は securityd だけが持ち、sandbox には公開鍵の証明書だけを read-only で mount する。ADR-0018 の CA（中継と Gateway の server 証明書の pin 先）とは分ける。sandbox がこの CA を信頼しても、偽れるのは provider の host だけになる。これで ADR-0005 の「CA を信頼させる範囲を provider の host に限る」を、運用の約束ではなく証明書の性質で守る。

## Considered Options

- OneCLI 1.42.0 と同じ、制約の無い 1 つの CA。sandbox が全 host の偽の証明書を信頼することになる。
- Session ごとの CA。秘密鍵はどれも同じ securityd が持つので守りは増えず、発行と mount の手間だけが増える。
- ADR-0018 の CA を兼ねる形。pin 先の CA が leaf を自由に発行できると、中継の確認と sandbox の信頼が同じ鍵に依存する。

## Consequences

- provider の host を catalog に足すと CA を作り直す。新しい CA は、その後に作る Session から mount する。
- provider の host への CONNECT は必ず終端する。placeholder の無い要求は、Authorization・Cookie などの資格情報が無ければ注入せずに Web として中継し、資格情報があれば拒否する。Chromium で provider の Web ページを開けるようにするため。
- Chromium にも NSS の db を通してこの CA を信頼させる。OpenSSL・BoringSSL・NSS が root の NameConstraints を守るかは、P8 の gate で実測する。
