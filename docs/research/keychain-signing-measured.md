# securityd の署名ごとの Keychain の挙動（実測）

測定日 2026-10-16。macOS 26.6.2（25G83）、Apple silicon、rustc 1.95.0、`security-framework` 3.7.0。

[ADR-0020](../adr/0020-vault-root-key-in-login-keychain-readable-only-by-securityd.md) の 2 つの候補を比べた。

- ad-hoc 署名（`cargo build` の linker が付ける署名のまま）。
- 自己署名の identity。user の trust settings で Code Signing の trustRoot にし、秘密鍵の ACL に `/usr/bin/codesign` を載せる。monica で「常に許可」を押した状態と同じ。

## 結論

**login keychain では、ad-hoc と自己署名の挙動は同じだった。** item の partition list には、作った binary の `cdhash:<…>` が入る。build し直した securityd と、別の binary（同じ identity と identifier で署名したものを含む）は、どちらも確認なしには読めなかった。自己署名にしても dialog は減らず、署名用の keychain を持つ意味も無い。

**`security create-keychain` で作った keychain では、partition list が付かなかった。** 自己署名の場合、同じ identity で署名した別の binary が確認なしで読めた。P3 の試験で一時の keychain を使うと、login keychain と逆の結果になる。

## 手順

`probe/` は、`SecKeychain::set_generic_password` と `find_generic_password` を呼ぶだけの binary。`--no-ui` を付けると `SecKeychain::disable_user_interaction` を効かせる。`PROBE_VARIANT` を build 時に変えると cdhash が変わる。

`run.sh <keychain> <label>` は、ad-hoc と自己署名のそれぞれで次を行う。

1. v1 を build（自己署名なら署名）し、item を作る。ACL と partition を dump する。
2. v1 で読む。
3. v2 を build し直して同じ path に置き、UI なしで読む。
4. 別の path に別の binary（imposter）を build し、自己署名なら同じ identity と `-i com.momo.securityd` で署名して、UI なしで読む。

自己署名の identity は openssl で作った code signing 用の証明書を専用の keychain に `security import -T /usr/bin/codesign` で入れ、`security add-trusted-cert -r trustRoot -p codeSign` で信頼させた。`codesign --keychain` はこの keychain の identity を見つけられず、user の検索 list に足したときだけ署名できた。

## 結果

| | 一時の keychain | login keychain |
|---|---|---|
| ACL の trusted application | 作った path と、ad-hoc なら `cdhash`、自己署名なら `identifier "com.momo.securityd" and certificate leaf = H"…"` | 同じ |
| partition list | 無い | `cdhash:<作った binary>`（自己署名でも） |
| ad-hoc の v2 | `-25293` | `-25293` |
| ad-hoc の imposter | `-25293` | `-25293` |
| 自己署名の v2 | 読めた | `-25293` |
| 自己署名の imposter | 読めた | `-25293` |

`-25293` は errSecAuthFailed。research で予想した errSecInteractionNotAllowed（`-25308`）ではなかった。

### dialog

login keychain の ad-hoc の item を、build し直した v2 から UI を出す設定で読んだ。

- dialog には login keychain の password の入力欄があった。
- password を入れて許可すると、ACL に v2 の path と cdhash が足され、partition list にも `cdhash:<v2>` が足された。v1 の entry は消えずに残る。
- その後、v2 は UI なしで読めた。imposter は `-25293` のままだった。

### LaunchAgent

`launchctl bootstrap gui/<uid>` で読み込んだ LaunchAgent（`agent.plist`）から、UI なしで読めた。backend の子 process に当たる、shell から起こした process からも読めた。

### 測っていないこと

- 画面 lock と sleep のあと。この Mac の login keychain は `no-timeout` で、`lock-on-sleep` も付いていない。画面 lock の前後 2 分は読めたが、sleep には入っていない。keychain を `security lock-keychain` で lock して読ませる試験は、P3 の実装で行う。
- Apple Development と Developer ID の署名。この Mac に証明書が無い。research の source では `teamid:` の partition になる。
- `user/<uid>` の domain と、`UserName` 付きの daemon。
