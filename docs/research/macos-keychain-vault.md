# macOS Keychain に securityd の鍵を置く条件

issue #35 の調査結果。bundle を持たない Rust の daemon（securityd）が、Workspace 別の鍵を macOS の Keychain に置いて読み続けるには何が要るかを、一次情報で確かめた。

- 調べた日: 2026-10-16
- 読んだ版: `security-framework` 3.7.0 / `security-framework-sys` 2.17.0 / `keyring` 4.2.0 / `apple-native-keyring-store` 1.0.2 / `keyring-core` 1.0.1（いずれも crates.io の最新の安定版）、OneCLI 1.42.0（commit `3912c74d7029505f0f5389745568111d643adc68`）、Apple の Security の open source（tag `Security-61901.120.67`）、Xcode に入っている macOS 27.0 SDK の header、macOS 26.6 の man page
- Keychain の item は作っていない。読んだのは文書・source・header・man page と、手元の login keychain の設定（`security show-keychain-info`）だけである。

各項目に次の印を付ける。

- **[文書]** Apple の文書・TN・man page・header・DTS の Forums の投稿に書いてある。
- **[source]** crate や Apple の open source のコードで確かめた。
- **[推測]** 上の 2 つから導いたが、そのものを書いた一次情報は無い。
- **[未検証]** 実機で測らないと決まらない。測り方は 8 節に書く。

## 0. 判断を縛る事実

1. data protection keychain を使うには、keychain access group を与える entitlement を provisioning profile で認可し、その profile を app 風の bundle に埋め込む必要がある。素の実行ファイルには profile を置く場所が無い。**[文書]**
2. data protection keychain と Secure Enclave は、GUI login の user context でしか使えない。launchd daemon からは使えない（DTS は「支援しない」と明言）。LaunchAgent は user context なので対象に入る。**[文書]**
3. file-based keychain（login keychain）は署名も entitlement も要らない。代わりに item ごとの ACL と partition list でアクセスを決め、その鍵は作った process の署名から決まる。**[文書][source]**
4. partition ID は署名の種類で決まる。Apple Development・Developer ID で署名すると `teamid:<Team ID>` で、build し直しても変わらない。ad-hoc 署名（Apple silicon で linker が自動で付ける署名を含む）や自前の証明書の署名では `cdhash:<cdhash>` になり、build のたびに変わる。**[source]**
5. ad-hoc 署名の DR（designated requirement）はその版のコードにしか合わない。したがって ad-hoc 署名の securityd を build し直すと、login keychain の item の ACL と partition list のどちらにも合わなくなり、確認の dialog（または UI 不可のときは失敗）になる。**[文書][推測]**
6. `kSecAttrAccessible*` と `kSecAttrSynchronizable` は data protection keychain の属性で、file-based keychain では効かない。**[文書]**
7. `keyring` 4.2.0 の既定（`v1` feature）は file-based の login keychain を使い、ACL を指定する手段を持たない。`security-framework` 3.7.0 にも legacy の ACL（`SecAccessCreate`・`SecTrustedApplication`）と partition list を操作する binding は無い。**[source]**
8. OneCLI 1.42.0 は Keychain を使わない。Vault の master key は docker volume の file（`/app/data/secret-encryption-key`、0600）か環境変数 `SECRET_ENCRYPTION_KEY` に置く。**[source]**
9. macOS 26.4 以降、file-based keychain の file は `/var/db/SystemKeys` の protected entropy file を参照することがあり、keychain の file だけを別の Mac に写しても開けないことがある。**[文書]**

## 1. file-based keychain と data protection keychain

### 違い

TN3137（[On Mac keychain APIs and implementations](https://developer.apple.com/documentation/technotes/tn3137-on-mac-keychains)）による。**[文書]**

- macOS には file-based keychain と data protection keychain の 2 つの実装がある。SecKeychain API は常に file-based を対象にする。SecItem API は既定で file-based を対象にし、`kSecUseDataProtectionKeychain` か `kSecAttrSynchronizable` を true にすると data protection keychain を対象にする。
- file-based keychain は「廃止に向かっている」。正式には deprecated でないが、`SecKeychainCreate` などは deprecated で、iCloud Keychain のような新機能は data protection keychain を要する。macOS 27.0 SDK の `SecKeychain.h` も冒頭で「SecKeychain is deprecated」とし、SecItem と `kSecUseDataProtectionKeychain` への移行を勧めている。`SecKeychainAddGenericPassword` などは `API_DEPRECATED(..., macos(10.2, 10.10))` だが、宣言も `Security.tbd` の symbol も残っている。**[文書]**
- アクセス制御の仕組みが違う。file-based keychain は ACL（`SecAccess`）を使う。data protection keychain は keychain access group と、任意で付ける `SecAccessControl` を使う。
- data protection keychain は user login context でしか使えず、launchd daemon からは使えない。user ごとに 1 つで、呼び出し元の context から選ばれる。
- file-based keychain は file に保存される。user context の search list は login keychain と System keychain で、既定は login keychain。
- iCloud Keychain、biometrics での保護、Secure Enclave での鍵の保護は data protection keychain を要する。

### data protection keychain に要るもの

- macOS は、data protection keychain の access group の一覧を、プログラムの code signing entitlement から作る。その entitlement は provisioning profile で認可されている必要があり、profile を埋め込むには app 風の bundle 構造が要る。command-line tool を app 風の構造で包む方法は [Signing a daemon with a restricted entitlement](https://developer.apple.com/documentation/xcode/signing-a-daemon-with-a-restricted-entitlement) にある。包んでも、user context で動かさないと使えない（TN3137）。**[文書]**
- access group の一覧は、`keychain-access-groups`、app ID（`$(teamID).<bundle id>`、macOS の entitlement 名は `com.apple.application-identifier`）、app group を連結したもので、先頭が既定の group になる（[Sharing access to keychain items among a collection of apps](https://developer.apple.com/documentation/security/sharing-access-to-keychain-items-among-a-collection-of-apps)）。属さない group を指定すると `errSecMissingEntitlement`（-34018）になる。**[文書]**
- `keychain-access-groups` は restricted entitlement で、profile の認可が要る。macOS は App Store と Developer ID の両方の配布で profile を扱い、profile は `MyApp.app/Contents/embedded.provisionprofile` に置く。daemon や command-line tool のような単体の実行ファイルは restricted entitlement を持てないので、app 風の構造で包む（[TN3125](https://developer.apple.com/documentation/technotes/tn3125-inside-code-signing-provisioning-profiles) の「Entitlements on macOS」）。Developer ID の profile は有効期限がずっと先に設定される（同 TN3125）。**[文書]**
- DTS の Quinn は、command-line tool で data protection keychain が使いにくい理由として、entitlement が restricted で profile が要ること、tool に profile を置く簡単な方法が無いことを挙げ、これが -34018 の原因だとしている（[thread 714752](https://developer.apple.com/forums/thread/714752)、2022-09）。**[文書]**
- 包む例の bundle の構造は `X.app/Contents/{Info.plist, MacOS/X, _CodeSignature/, embedded.provisionprofile}` で、launchd の plist は `Contents/MacOS/X` を直接指す（[Signing a daemon with a restricted entitlement](https://developer.apple.com/documentation/xcode/signing-a-daemon-with-a-restricted-entitlement)）。Xcode 以外の build system でも、同じ構造を作ればよいとされている。**[文書]**
- Quinn は、profile を持てるのは app と app extension に限らず「launchd agent のようなもの」も含むとし、同じ team の 2 つのプログラムが同じ GUI user context で動くなら data protection keychain と共有の access group を勧めている。third-party の launchd daemon は使えない（[thread 747366](https://developer.apple.com/forums/thread/747366)、2024-02、[thread 729092](https://developer.apple.com/forums/thread/729092)、2023-05）。**[文書]**
- Developer ID の証明書は、Apple Developer Program の team の Account Holder でないと作れない（[Developer ID](https://developer.apple.com/developer-id/)）。**[文書]** 無料の Apple Account（Personal Team）で macOS 用の profile を作り、securityd の bundle に埋め込めるかは確かめていない。**[未検証]**

### file-based keychain に要るもの

- 署名・entitlement・profile・bundle は要らない。SecKeychain API か、`kSecUseDataProtectionKeychain` を付けない SecItem API で、user context の default keychain（login keychain）に item を足せる（TN3137）。**[文書]**
- 代わりに、item のアクセスは ACL と partition list で決まり、それが作った process の署名に結び付く（2 節）。

## 2. 署名の種類と ACL・partition list、build し直したとき

### ACL の初期値

- `SecAccessCreate` の header は、trusted application の一覧に NULL を渡すと「item を作った application だけ」が既定になると書いている。SecKeychain API の `SecKeychainAddGenericPassword` は access を引数に取らないので、この既定になる。**[文書]**（macOS 27.0 SDK の `SecAccess.h`・`SecKeychain.h`）
- Quinn は「変えない限り、keychain item の ACL は作った app の DR に設定される」と書いている（[thread 649081](https://developer.apple.com/forums/thread/649081)、2020-06）。item を作った時に DR が記録され、後の版はその DR を満たす必要がある。Developer ID（と Mac App Store）の署名ならこれが自動で成り立つ（[thread 98484](https://developer.apple.com/forums/thread/98484)、2018-03）。**[文書]**
- `kSecAttrAccess`（`SecAccess`）は、`kSecAttrSynchronizable` と `kSecUseDataProtectionKeychain` のどちらも付けない macOS の item にだけ効く（[kSecAttrAccess](https://developer.apple.com/documentation/security/ksecattraccess)）。**[文書]**

### DR は署名の種類で変わる

[TN3127 Inside Code Signing: Requirements](https://developer.apple.com/documentation/technotes/tn3127-inside-code-signing-requirements) による。**[文書]**

- 署名なしのコードには DR が無い。ad-hoc 署名（Xcode の Sign to Run Locally）のコードには DR があるが、その版のコードにしか合わない。どちらも macOS はコードの identity を追えない。TN3127 は例として、コードを少し変えて再実行するとマイクの許可を再び聞かれることを挙げている。
- Developer ID の DR は `anchor apple generic and identifier "<id>" and (... and certificate leaf[subject.OU] = <Team ID>)` の形で、team と code signing identifier に結び付く。
- Apple Development の DR は `identifier "<id>" and anchor apple generic and certificate leaf[subject.CN] = "Apple Development: …" and certificate 1[...]` の形で、leaf の証明書の Common Name に結び付く。Developer ID・Mac App Store の DR とは互換が無い。
- `codesign -s -` の ad-hoc 署名は「identity を使わず、ちょうど 1 つのコードの instance を識別する」（`man codesign`）。**[文書]**
- Apple silicon の macOS 11 以降は、native の実行ファイルに署名が無いと実行させない。ad-hoc 署名で足り、Xcode 12 以降の `clang`・`ld` は link 時に自動で ad-hoc 署名する（[macOS Big Sur 11.0.1 Universal Apps Release Notes](https://developer.apple.com/documentation/macos-release-notes/macos-big-sur-11_0_1-universal-apps-release-notes)）。したがって Apple silicon で `cargo build` した securityd は、何もしなければ linker の ad-hoc 署名になる。**[文書][推測]**

### partition list

- partition list は file-based keychain に後から足された仕組みで、ACL の中の追加の条件として、application の code signature でアクセスを絞る（`man security` の `set-generic-password-partition-list`）。変えるには keychain の password が要る。Keychain Access の ACL の editor は partition list を表示せず、操作する public API も無い。`security` command に初歩的な対応があるだけである（[thread 778797](https://developer.apple.com/forums/thread/778797)、2025-04）。**[文書]**
- partition ID の決め方は Apple の open source の `securityd/src/clientid.cpp` の `ClientIdentification::partitionIdForProcess` にある（[Security-61901.120.67](https://github.com/apple-oss-distributions/Security/blob/Security-61901.120.67/securityd/src/clientid.cpp)）。**[source]**
  - 署名なし: `unsigned:`
  - Apple の署名: `apple:`（`security` command だけ `apple-tool:`）
  - Mac App Store・TestFlight の署名: `teamid:<Team ID>`
  - Developer ID、Mac Development、Mac Distribution の証明書（WWDR か Developer ID の CA の下）の署名: `teamid:<leaf の OU>`
  - それ以外の署名（ad-hoc や自前の CA の証明書）: `cdhash:<cdhash>`

### build し直す・署名し直すと何が起きるか

| securityd の署名 | DR | partition ID | 同じ署名方法で build し直した後 |
|---|---|---|---|
| 署名なし（Intel のみ。Apple silicon では実行できない） | 無し | `unsigned:` | trusted application の照合に失敗する **[推測]** |
| ad-hoc（Apple silicon の既定） | その版の cdhash だけ | `cdhash:<旧>` | DR も partition も合わず、dialog が出る **[推測]** |
| 自前の CA の証明書 | 証明書に結び付く | `cdhash:<旧>` | DR は合うが partition が合わず、dialog が出る **[推測]** |
| Apple Development | 証明書の CN に結び付く | `teamid:<Team ID>` | 同じ証明書なら dialog は出ない **[推測]**。証明書を作り直すと CN が変わり得る **[未検証]** |
| Developer ID | Team ID と identifier に結び付く | `teamid:<Team ID>` | dialog は出ない。DTS が推す形 **[文書]** |

- 「dialog が出る」場合の中身。user が「常に許可」を選ぶと、その版が ACL に足される。partition list に合わないときは、keychain の password の入力を求める dialog になる。この細部を書いた Apple の文書は見つからなかった。**[未検証]**
- UI を出せない context（`SecKeychainSetUserInteractionAllowed(false)` 中や、GUI の無い session）では、dialog の代わりに `errSecInteractionNotAllowed`（-25308）で失敗する。DTS はこの error を「user との対話が要るが、実行 context のせいで対話できない」ときのものと説明している（[thread 714752](https://developer.apple.com/forums/thread/714752)）。**[文書]**
- item そのものは消えない。読めなくなるのは、ACL・partition list に合わない状態で、user が許可しない（または UI を出せない）ときである。**[推測]**
- ACL が正しくない item は、user の承認なしには ACL を直せない（[thread 747366](https://developer.apple.com/forums/thread/747366)）。**[文書]**
- data protection keychain では ACL を使わない。access group の entitlement と profile が同じなら、build し直しても読める。**[推測]**（TN3137 と access group の文書から。Quinn も「この種の問題を避ける一つの方法は iOS 型の keychain に移ることだ」と書いている。[thread 649081](https://developer.apple.com/forums/thread/649081)）

## 3. LaunchAgent から login keychain を使えるか

- launchd の文書上の区別。`~/Library/LaunchAgents` は user の per-user agent。`LimitLoadToSessionType` は agent にだけ効き、特権の system context には session の区別が無い（`man launchd.plist`）。`launchctl` の `gui/<uid>` は user-login domain を指し、`user/<uid>` の user domain は login した user が居なくても存在し得る（`man launchctl`）。**[文書]**
- DTS の Matt Eaton は、daemon は system context、agent は user context で動き、`UserName` を付けた daemon は「特定の user として振る舞う global context の system daemon」で、user context で動かすには agent にする必要があると書いている（[thread 685967](https://developer.apple.com/forums/thread/685967)、2021-07）。**[文書]**
- GUI login 中の LaunchAgent は user context なので、file-based の login keychain も、profile 付きの bundle なら data protection keychain も対象になる（TN3137、[thread 747366](https://developer.apple.com/forums/thread/747366)）。**[文書]** 実際に ad-hoc 署名の Rust の実行ファイルを LaunchAgent で動かして login keychain を読めることは測っていない。**[未検証]**
- login 前。per-user の LaunchAgent は GUI login で user の session ができるまで起動されない。data protection keychain は user login context でしか使えない（TN3137）。securityd は login 前には鍵を読めない前提で作ることになる。**[文書][推測]**
- login keychain の lock。login keychain は「一定時間使わないと lock」と「sleep 時に lock」の設定を持つ（`man security` の `set-keychain-settings` の `-u`・`-t`・`-l`、[If your Mac keeps asking for your keychain password](https://support.apple.com/guide/keychain-access/mac-keychain-password-kyca1242/mac)）。手元の Mac の login keychain は `no-timeout` だった（既定値を書いた Apple の文書は見つからない）。lock 中の file-based keychain を読むと unlock の dialog か `errSecInteractionNotAllowed` になる。**[文書][推測]**
- 画面の lock（スクリーンセーバー・lock screen）だけで login keychain が lock されるかを書いた Apple の文書は見つからなかった。**[未検証]**
- data protection keychain の `kSecAttrAccessibleWhenUnlocked` は「device が unlock されている間だけ」読める。だが Apple Platform Security は「macOS では Data Protection を直接使ってこの保証を enforce しない」と書いており（[Keychain data protection](https://support.apple.com/guide/security/keychain-data-protection-secb0694df1a/web)）、Mac の画面 lock 中に `WhenUnlocked` の item が読めるかは文書から決まらない。**[未検証]**
- user の login password を変えると login keychain の password とずれることがあり、ずれると login 時に unlock されない（[If you need to update your keychain password on Mac](https://support.apple.com/guide/keychain-access/if-you-need-to-update-your-keychain-password-kyca2429/mac)）。そのとき securityd は fail closed にする必要がある（SECURITY-ACCEPTANCE C）。**[文書]**

## 4. accessibility・同期・Time Machine・移行アシスタント

### 属性の効く範囲

- `kSecAttrAccessible` は、macOS では `kSecUseDataProtectionKeychain` か `kSecAttrSynchronizable` を true にした item にだけ使える（[kSecAttrAccessible](https://developer.apple.com/documentation/security/ksecattraccessible)、SDK 27.0 の `SecItem.h` の注記も同じ）。Quinn も「file-based keychain では `kSecAttrAccessible` は関係ない」と書いている（[thread 714752](https://developer.apple.com/forums/thread/714752)）。**[文書]**
- `kSecAttrSynchronizable` を true にした item は iCloud で user の全 device に同期される。`ThisDeviceOnly` で終わる accessibility とは組み合わせられない。`SecAccess`（`kSecAttrAccess`）も使えない。同期する item の更新と削除は全 device の copy に効く（[kSecAttrSynchronizable](https://developer.apple.com/documentation/security/ksecattrsynchronizable)）。同期を伴わずに iOS 型の item にするには `kSecUseDataProtectionKeychain` を使う（[kSecUseDataProtectionKeychain](https://developer.apple.com/documentation/security/ksecusedataprotectionkeychain)）。**[文書]**
- 既定は `kSecAttrAccessibleWhenUnlocked`（[kSecAttrAccessibleWhenUnlocked](https://developer.apple.com/documentation/security/ksecattraccessiblewhenunlocked)）。**[文書]**

### 鍵の移り方

| 属性 | 文書の記述 |
|---|---|
| `WhenUnlocked`・`AfterFirstUnlock` | 暗号化した backup で新しい device に移る |
| `WhenUnlockedThisDeviceOnly`・`AfterFirstUnlockThisDeviceOnly` | 新しい device には移らない。別の device の backup から戻すとその item は無い |
| `WhenPasscodeSetThisDeviceOnly` | 移らない、backup されない、iCloud Keychain に同期しない。passcode を外すと item が消える |
| `kSecAttrSynchronizable = true` | iCloud Keychain で同期する（`ThisDeviceOnly` と併用不可） |

出典は各定数の文書（[AfterFirstUnlock](https://developer.apple.com/documentation/security/ksecattraccessibleafterfirstunlock)、[AfterFirstUnlockThisDeviceOnly](https://developer.apple.com/documentation/security/ksecattraccessibleafterfirstunlockthisdeviceonly)、[WhenUnlockedThisDeviceOnly](https://developer.apple.com/documentation/security/ksecattraccessiblewhenunlockedthisdeviceonly)、[WhenPasscodeSetThisDeviceOnly](https://developer.apple.com/documentation/security/ksecattraccessiblewhenpasscodesetthisdeviceonly)）と [Restricting keychain item accessibility](https://developer.apple.com/documentation/security/restricting-keychain-item-accessibility)、[Keychain data protection](https://support.apple.com/guide/security/keychain-data-protection-secb0694df1a/web)。後者は、`ThisDeviceOnly` の item は backup の際に device の UID で保護され、別の device に戻すと使えないとしている。**[文書]**

注意: これらの文書の「backup」「新しい device」は iOS の暗号化 backup の文脈で書かれている。Mac の Time Machine と移行アシスタントで `ThisDeviceOnly` の item がどう扱われるかを書いた Apple の文書は見つからなかった。**[未検証]**

### file-based keychain の場合

- login keychain は `~/Library/Keychains/login.keychain-db` の file で、iCloud Keychain には同期しない（iCloud Keychain は data protection keychain を要する。TN3137）。**[文書]**
- macOS 26.4 以降、keychain の file は `/var/db/SystemKeys` の protected entropy file を参照することがあり、unlock には keychain の password とその file の両方が要る。backup 製品はその directory も backup するよう求められている。この directory は root でも直接読めない（TN3137 の「Backing up a file-based keychain」、2026-09-24 追記）。**[文書]**
- Time Machine と移行アシスタントが protected entropy file を運ぶかは TN3137 に書いていない。**[未検証]**
- momo への含意。ADR-0004 はデータ dir を Time Machine から外すが、login keychain は `~/Library/Keychains` にあるので、除外しない限り鍵は Time Machine に入る（keychain の password で暗号化された形で）。逆に、`security.db` だけを別の Mac に戻しても、鍵が付いて来なければ復号できない。**[推測]**

## 5. Secure Enclave の鍵を bundle なしで使えるか

- Secure Enclave の鍵は NIST P-256 だけで、署名・検証と ECDH（とそれを使った対称暗号）に使える。既存の鍵は取り込めず、Secure Enclave で生成する必要がある。対応するのは Touch ID と Touch Bar を持つ Mac か、M1 以降の Mac（[Protecting keys with the Secure Enclave](https://developer.apple.com/documentation/security/protecting-keys-with-the-secure-enclave)）。`kSecKeyAlgorithmECIESEncryptionCofactorX963SHA256AESGCM` で wrap に使える。**[文書]**
- Secure Enclave での鍵の保護は data protection keychain を要する（TN3137）。Quinn は「SE で守る鍵を扱うには iOS 型の keychain を使う必要があり、それには profile で認可された entitlement が要る。tool には profile を置く場所が無いので、app 風の構造で包む」と答えている（[thread 125510](https://developer.apple.com/forums/thread/125510)、2021-10）。**[文書]**
- launchd daemon からの Secure Enclave の利用は支援外で、「この道に進まないで」とされている（[thread 799625](https://developer.apple.com/forums/thread/799625)、2025-09）。**[文書]**
- 結論として、文書の上では bundle と profile なしに Secure Enclave の鍵は使えない。CryptoKit の `SecureEnclave.P256` で `kSecAttrIsPermanent` を付けない鍵を作り、`dataRepresentation`（その Secure Enclave でしか戻せない暗号化された blob）を自分で保存する形なら entitlement 無しで動くという報告は第三者にあるが、Apple の一次情報で確かめられなかった。**[未検証]**

## 6. Rust の crate がどれに対応しているか

### security-framework 3.7.0 / security-framework-sys 2.17.0

source: <https://crates.io/crates/security-framework/3.7.0>、<https://github.com/kornelski/rust-security-framework>。**[source]**

- file-based keychain: `os::macos::keychain::SecKeychain`（`default()`、`open()`、`unlock()`、`set_settings()`、`disable_user_interaction()`）と `os::macos::passwords`。`SecKeychain::set_generic_password` は既存の item があれば中身を更新し、無ければ `SecKeychainAddGenericPassword` で足す。access は渡さないので、ACL は 2 節の既定（作った application だけを信頼）になる。
- legacy の ACL: `SecAccess` の型（`SecAccessGetTypeID`）だけがあり、`SecAccessCreate`、`SecTrustedApplicationCreateFromPath`、`SecKeychainItemSetAccess` の binding は sys crate にも無い。partition list を操作する API も無い。trusted application を足すには自前で FFI を書く必要がある。
- data protection keychain: `passwords::PasswordOptions::use_protected_keychain()` が `kSecUseDataProtectionKeychain = true` を付ける（`OSX_10_15` feature が要る）。`set_access_group`・`set_access_control`・`set_access_synchronized` がある。`item::Location::DataProtectionKeychain` の doc comment は「この keychain は、呼び出す binary が access group の entitlement 付きで署名されている必要がある」と書き、TN3137 を参照している。
- accessibility: `access_control::ProtectionMode` が `kSecAttrAccessible*` の 5 つ（`WhenPasscodeSetThisDeviceOnly`、`WhenUnlockedThisDeviceOnly`、`WhenUnlocked`、`AfterFirstUnlockThisDeviceOnly`、`AfterFirstUnlock`）を持ち、`SecAccessControl::create_with_protection` で渡す。
- 同期: `PasswordOptions::set_access_synchronized`（`kSecAttrSynchronizable`）。鍵の生成で同期を指定する `GenerateKeyOptions::set_synchronizable` は `sync-keychain` feature の下にある。
- Secure Enclave: `key::Token::SecureEnclave`（`kSecAttrTokenIDSecureEnclave`）と `GenerateKeyOptions`、`SecKey::new`（`SecKeyCreateRandomKey`）。`SecKey::encrypt_data`・`decrypt_data` と `key_exchange` があり、sys crate は `kSecKeyAlgorithmECIESEncryptionCofactorX963SHA256AESGCM` などを持つ。

### keyring 4.2.0 / apple-native-keyring-store 1.0.2

source: <https://crates.io/crates/keyring/4.2.0>、<https://crates.io/crates/apple-native-keyring-store/1.0.2>。**[source]**

- `keyring` 4.x は store を別 crate に分けた。`keyring` の既定 feature `v1` は `apple-native-keyring-store/keychain` を有効にし、macOS では `apple_native_keyring_store::keychain::Store::new()` を使う（`src/v1.rs`）。
- `keychain` module は file-based keychain を対象にし、既定は User（login）keychain。`security-framework` の `SecKeychain::set_generic_password` と `find_generic_password` を呼ぶだけで、ACL・partition list・accessibility を指定する手段は無い。
- `protected` module（`protected` feature）は data protection keychain を対象にし、`use_protected_keychain()` を付ける。access policy は `AfterFirstUnlock`、`AfterFirstUnlockThisDeviceOnly`、`WhenUnlocked`（既定）、`WhenUnlockedThisDeviceOnly`、`WhenPasscodeSetThisDeviceOnly`、`RequireUserPresence`。`cloud-sync` で `kSecAttrSynchronizable` を付けられるが、その store では access policy を指定できない。`access-group` も指定できる。
- README は「profile で署名していない client（command-line app など）は `keychain` module を使え」「`protected` を署名していない app で動かすと -34018 になる」と書いている。`protected.rs` の doc comment には「command-line tool は profile で署名できない」とあるが、Apple の文書は app 風の構造に包めば可能としている（1 節）。crate の説明は Apple の文書より狭い。
- Secure Enclave の鍵を扱う API は無い。

## 7. OneCLI 1.42.0 の Vault の master key

source: <https://github.com/onecli/onecli/tree/3912c74d7029505f0f5389745568111d643adc68>（`package.json` の version は `1.42.0`、commit message は `chore(main): release 1.42.0 (#439)`）。**[source]**

- Keychain は使わない。repo 全体で `keychain`・`keyring`・`SecItem` を検索しても、該当するのは `Cargo.lock` の `security-framework` だけで、これは `native-tls` と `rustls-native-certs` が TLS の信頼のために引いているものである。
- master key は `SECRET_ENCRYPTION_KEY`（base64 の 32 byte、AES-256-GCM）。gateway は `crypto::CryptoService::from_env()` で環境変数から読む（`apps/gateway/src/crypto.rs`、`apps/gateway/src/main.rs`）。web と API も同じ環境変数を読む（`packages/api/src/lib/crypto.ts`）。
- 未設定なら container の `docker/entrypoint.sh` が `/dev/urandom` の 32 byte を base64 にして `/app/data/secret-encryption-key` に書き、`chmod 600` して環境変数に export する。`/app/data` は docker compose の named volume `app-data` である（`docker/docker-compose.yml`）。
- gateway の TLS 終端の CA の秘密鍵も、環境変数 `GATEWAY_CA_KEY` が無ければ `{data_dir}/gateway/ca.key` に 0600 で置く。`data_dir` の既定は Linux で `/app/data` があればそこ、それ以外は `~/.onecli`（`apps/gateway/src/ca.rs`、`main.rs`）。
- つまり OneCLI は、鍵を DB と同じ volume の file に置く。SECURITY-ACCEPTANCE C の「key は OS Keychain 等に保護され、平文の DB・設定・配布 binary 内に同居しない」は満たさないので、momo の参考にはならない。**[推測]**

## 8. 未検証の項目と測り方

どれも実機の Mac で、捨ててよい service 名の item を使って測る。

1. **ad-hoc 署名の securityd を build し直した後の挙動。** Apple silicon で `cargo build` した binary（linker の ad-hoc 署名）から `SecKeychainAddGenericPassword` で item を作り、`security dump-keychain -a` でその item の ACL と partition（`cdhash:...` になるはず）を見る。source を 1 行変えて build し直し、同じ item を読む。dialog が出るか、何という dialog か（「常に許可」か password の入力か）、`SecKeychainSetUserInteractionAllowed(false)` のときの OSStatus を記録する。
2. **Apple Development と Developer ID で署名し直した後の挙動。** 1 と同じ手順を、`codesign -s "Apple Development: ..."` と `codesign -s "Developer ID Application: ..." -i <固定の identifier>` で行う。partition が `teamid:<Team ID>` になり、build し直しても dialog が出ないことを確かめる。Apple Development の証明書を作り直した後も読めるかも見る。
3. **LaunchAgent から login keychain を読めるか。** `~/Library/LaunchAgents` の plist で 1 の binary を `launchctl bootstrap gui/$(id -u)` で起動し、item を読めるか、dialog が出せるかを見る。比較として `launchctl bootstrap user/$(id -u)` と、`UserName` 付きの LaunchDaemon でも試す。
4. **lock の状態ごとの挙動。** 3 の agent で 10 秒ごとに item を読み、OSStatus を log に出す。画面 lock、sleep と復帰、`security lock-keychain ~/Library/Keychains/login.keychain-db`、fast user switching で別の user に切り替えた状態、をそれぞれ通す。data protection keychain の `WhenUnlocked` と `AfterFirstUnlock` の item でも同じことをする（profile 付きの bundle が要る）。
5. **data protection keychain を app 風の bundle で使えるか。** `securityd.app/Contents/{Info.plist, MacOS/securityd, embedded.provisionprofile}` を作り、`com.apple.application-identifier` を claim して Developer ID か Apple Development で署名し、LaunchAgent から `kSecUseDataProtectionKeychain` 付きで item を作って読む。build し直しても読めること、無料の Personal Team の profile で同じことができるかも確かめる。
6. **Secure Enclave を bundle なしで使えるか。** ad-hoc 署名の CLI から、`kSecAttrIsPermanent = false` で `kSecAttrTokenIDSecureEnclave` の P-256 鍵を作り、`SecKeyCopyExternalRepresentation` か CryptoKit の `dataRepresentation` を file に保存し、別 process で復元して ECIES で wrap した鍵を戻せるかを見る。-34018 になるかを記録する。同じことを 5 の bundle でも行う。
7. **Time Machine と移行アシスタント。** 1 の file-based の item と、5 の data protection の item（`WhenUnlocked` と `WhenUnlockedThisDeviceOnly` の 2 つ）を作ってから、Time Machine で別の Mac（または消去した同じ Mac）に戻し、移行アシスタントでも別の Mac に移す。それぞれの item が残るか、読めるかを見る。macOS 26.4 以降の Mac では、login keychain が protected entropy file を参照しているか（`security show-keychain-info -s` の salt と同名の file が `/var/db/SystemKeys` にあるか。見るには SIP の解除が要るので、log の `dp_login` category で代える）も記録する。
8. **画面 lock で login keychain が lock されるか。** 4 の測定に含める。既定の lock 設定は、新しく作った macOS ユーザーで `security show-keychain-info` を実行して確かめる。

## 出典

Apple の文書・TN

- TN3137 On Mac keychain APIs and implementations: <https://developer.apple.com/documentation/technotes/tn3137-on-mac-keychains>
- TN3125 Inside Code Signing: Provisioning Profiles: <https://developer.apple.com/documentation/technotes/tn3125-inside-code-signing-provisioning-profiles>
- TN3127 Inside Code Signing: Requirements: <https://developer.apple.com/documentation/technotes/tn3127-inside-code-signing-requirements>
- Signing a daemon with a restricted entitlement: <https://developer.apple.com/documentation/xcode/signing-a-daemon-with-a-restricted-entitlement>
- Sharing access to keychain items among a collection of apps: <https://developer.apple.com/documentation/security/sharing-access-to-keychain-items-among-a-collection-of-apps>
- kSecUseDataProtectionKeychain: <https://developer.apple.com/documentation/security/ksecusedataprotectionkeychain>
- kSecAttrSynchronizable: <https://developer.apple.com/documentation/security/ksecattrsynchronizable>
- kSecAttrAccessible: <https://developer.apple.com/documentation/security/ksecattraccessible>
- kSecAttrAccess: <https://developer.apple.com/documentation/security/ksecattraccess>
- Restricting keychain item accessibility: <https://developer.apple.com/documentation/security/restricting-keychain-item-accessibility>
- Protecting keys with the Secure Enclave: <https://developer.apple.com/documentation/security/protecting-keys-with-the-secure-enclave>
- macOS Big Sur 11.0.1 Universal Apps Release Notes: <https://developer.apple.com/documentation/macos-release-notes/macos-big-sur-11_0_1-universal-apps-release-notes>
- Developer ID: <https://developer.apple.com/developer-id/>
- Apple Platform Security, Keychain data protection: <https://support.apple.com/guide/security/keychain-data-protection-secb0694df1a/web>
- Keychain Access User Guide: <https://support.apple.com/guide/keychain-access/mac-keychain-password-kyca1242/mac>、<https://support.apple.com/guide/keychain-access/if-you-need-to-update-your-keychain-password-kyca2429/mac>
- macOS 27.0 SDK の `Security.framework/Headers/SecKeychain.h`・`SecAccess.h`・`SecItem.h`・`SecTrustedApplication.h`
- macOS 26.6 の `man security`・`man codesign`・`man launchd.plist`・`man launchctl`

Apple の open source

- `securityd/src/clientid.cpp`（Security-61901.120.67）: <https://github.com/apple-oss-distributions/Security/blob/Security-61901.120.67/securityd/src/clientid.cpp>

Apple Developer Forums の DTS の投稿

- thread 714752（Quinn、2022-09）: <https://developer.apple.com/forums/thread/714752>
- thread 649081（Quinn、2020-06）: <https://developer.apple.com/forums/thread/649081>
- thread 98484（Quinn、2018-03）: <https://developer.apple.com/forums/thread/98484>
- thread 778797（Quinn、2025-04）: <https://developer.apple.com/forums/thread/778797>
- thread 747366（Quinn、2024-02）: <https://developer.apple.com/forums/thread/747366>
- thread 729092（Quinn、2023-05）: <https://developer.apple.com/forums/thread/729092>
- thread 685967（Matt Eaton、2021-07）: <https://developer.apple.com/forums/thread/685967>
- thread 125510（Quinn、2021-10）: <https://developer.apple.com/forums/thread/125510>
- thread 799625（Quinn、2025-09）: <https://developer.apple.com/forums/thread/799625>

crate と OneCLI

- security-framework 3.7.0: <https://crates.io/crates/security-framework/3.7.0>
- security-framework-sys 2.17.0: <https://crates.io/crates/security-framework-sys/2.17.0>
- keyring 4.2.0: <https://crates.io/crates/keyring/4.2.0>
- apple-native-keyring-store 1.0.2: <https://crates.io/crates/apple-native-keyring-store/1.0.2>
- OneCLI 1.42.0（commit 3912c74）: <https://github.com/onecli/onecli/tree/3912c74d7029505f0f5389745568111d643adc68>
