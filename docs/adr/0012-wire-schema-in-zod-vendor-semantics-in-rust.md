# wire schema の正本は zod に置き、vendor の意味は Rust だけが解釈する

TS と securityd の間を通る message（管理 IPC と、Gateway の型付き操作）の schema は、`packages/contracts` の zod 4 を正本にする。`z.toJSONSchema` で出した JSON Schema を repo に commit し、securityd の build.rs が typify で serde の型を生成する。operation catalog は 2 層に分ける。Operation kind ごとの引数と結果の形は contracts に置く。承認の要否、承認カードに出す行、vendor の HTTP への変換と応答の整形、P8 の HTTP から kind への写像は、securityd の Rust だけに置く。

こう決めたのは、runner の in-process MCP が kind ごとの引数を model に示すのに zod が要るからである。Agent SDK の TypeScript の `tool()` は zod の schema しか受けない。Rust を正本にしても、TS に生成されるのは型だけで、実行時の validator は出ない（ts-rs、typeshare）。zod を出す specta-zod は未成熟なので、runner の zod は手で書くことになり、二重管理になる。境界の検証は、sandbox の外にある securityd が deserialize と domain の型への変換で行う。正本が TS にあっても、Rust 側の検証は弱くならない。vendor の意味を Rust に閉じたのは、承認カードの行を securityd が作れば、表示した行と digest の対象が同じ処理から出るからである。UI が kind ごとにカードを描くと、行を作る処理が TS と Rust に分かれ、食い違ったときに表示と違う内容が承認される。

## Considered Options

- **Rust の型を正本にし、ts-rs などで TS の型を生成する。** 境界の deserialize と正本が一致するが、runner と backend の zod を手で書く必要がある。
- **JSON Schema を手で書いて両方を生成する。** TS 側で zod を使えず、Ajv と生成した型を組み合わせることになる。
- **protobuf。** ProtoJSON の oneof はフィールド名がキーになり、`kind` で判別する tagged union の JSON にならない。
- **Operation の結果として vendor の JSON の body を返す。** kind を足すのは安いが、vendor の癖が runner に漏れ、応答に紛れた識別子も Bot に届く。

## Consequences

- typify は 0.x で、数値の範囲を Rust で強制しない。securityd は wire の型を domain の型に変えるときに範囲を検証する。
- JSON の約束をそろえる。すべて `z.strictObject` にし、JSON Schema は output モードで出す。`null` は使わずキーを省く。整数は 2^53 未満にし、ID は文字列にする。union は `kind` で判別する。秘密の項目は印を付け、Rust では `secrecy` の型に置き換える。
- Operation の失敗は contracts の閉じた error kind と momo が書いた文で返し、vendor の error body は返さない。添付は base64 で結果に入れ、kind ごとの上限を超えたら error にする。
- protocol version を contracts から 1 つ生成し、runner と backend が送る。一致しなければ securityd は拒否する。v1 は後方互換を持たない。
- CI では次の 2 つを必須にする。
  - 生成した JSON Schema と Rust の型に差分が無いこと
  - kind ごとの golden JSON を zod と Rust が同じく受け入れ、同じく拒否すること
- mailbox の message（TS どうし）の zod も contracts に置くが、JSON Schema には出さない。
