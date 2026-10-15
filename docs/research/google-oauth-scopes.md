# Google Calendar と Gmail の OAuth client・scope・公開状態

- ticket: [#6](https://github.com/ashigirl96/momo/issues/6)（map [#1](https://github.com/ashigirl96/momo/issues/1)）
- 確認日: 2026-10-15。各 source の "Last updated" は末尾の一覧に書いた。
- 方法: Google の公開 docs と Help Center を読んだだけ。Cloud project や OAuth client は作っておらず、実 token も live の試験も使っていない。
- 表記: 「確認済み」は原文を引用し URL を付けた事実。「推論」は確認済みの事実から導いた結論。「未検証」は docs で確かめられなかったか、docs 同士が食い違う点。

## 要点

1. Desktop client、外部ブラウザ、loopback、PKCE の組み合わせは、Google が macOS の desktop app に推奨する経路そのもの。client secret は秘密として扱われない。
2. 最小 scope は次のとおり。Calendar 読み取りは `calendar.calendarlist.readonly` と `calendar.events.readonly`（自分の予定表に限るなら `calendar.events.owned.readonly`）。予定作成は `calendar.events.owned`。Gmail 読み取りは `gmail.readonly` で、これは restricted。Gmail 送信は `gmail.send` で、これは sensitive。Calendar の各 scope の分類は公開 docs に載っていない。
3. 7 日の失効が起きるのは External かつ Testing のときだけ。In production の未検証 app と Internal app には 7 日ルールがない。
4. 個人利用（100 人未満で全員が知人）と Internal は検証の対象外。代わりに、未検証 app の警告と、project の生涯で 100 人という上限が残る。
5. installed app では incremental authorization を使えないと native-app の docs に書かれている。一方 web-server の docs は、desktop client の付与も project 単位で合算されると書いている。
6. revoke は client 単位では効かない。user が project に付与した全 scope が取り消され、その project のすべての client の token が無効になる。
7. 会社の Workspace では、管理者がいつでも app を block できる。Gmail の read と send の scope は管理者の "high-risk" 一覧に入っている。管理者が client を Trusted にすると、test user の上限と 7 日失効も外れると overview に書かれている。

## 1. Desktop OAuth client（確認済み）

出典: [OAuth 2.0 for iOS & Desktop Apps](https://developers.google.com/identity/protocols/oauth2/native-app)（page title は現在 "iOS & Desktop"。SOURCES の S25 は "Mobile & Desktop" と書いている）

- 秘密を持てない前提: "Installed apps are distributed to individual devices, and it is assumed that these apps cannot keep secrets."
- 外部ブラウザ: "installed apps must open the system browser and supply a local redirect URI to handle responses from Google's authorization server."
- loopback: redirect_uri は "`http://127.0.0.1:port` or `http://[::1]:port`" とし、"Query your platform for the relevant loopback IP address and start an HTTP listener on a random available port." と書かれている。macOS は推奨対象で "Recommended usage: macOS, Linux, and Windows desktop (but not Universal Windows Platform) apps" "Set the application type to Desktop app." とある。`localhost` も使えるが "this configuration may cause issues with client firewalls" とある。
- loopback を deprecated にしたのは mobile だけ: "The loopback IP address redirect option is DEPRECATED for Android, Chrome app and iOS OAuth client types."
- custom URI scheme と OOB は使えない: "Custom URI schemes are no longer supported due to the risk of app impersonation." "The manual copy/paste option, also referred to as an out of band (OOB) redirect method, is no longer supported."
- PKCE: "S256 (recommended)"。verifier は "minimum length of 43 characters and a maximum length of 128 characters"。
- token 交換の `client_secret` は "Optional" とされ、"(The client_secret is not applicable to requests from clients registered as Android, iOS, or Chrome applications.)" と注記がある。
- refresh token: "Note that refresh tokens are always returned for installed applications."
- 埋め込みブラウザの禁止。出典は [OAuth 2.0 Policies](https://developers.google.com/identity/protocols/oauth2/policies) で、"A developer must not direct a Google OAuth 2.0 authorization request to an embedded user-agent under the developer's control." とある。
- client 情報の扱いも同じ Policies にあり、"You must never commit client credentials into publicly available code repositories." と書かれている。

推論: momo は public repo なので、client ID と secret を repo や配布物に入れられない。所有者が自分の Cloud project で Desktop client を作り、securityd に登録する形が素直に合う。この形は後述の「個人利用」の例外とも整合する。

## 2. 能力ごとの最小 scope と分類

API method ごとに受け付ける scope は reference の "Authorization scopes" 節を見た（確認済み）。

| 能力 | 呼ぶ method | method が受け付ける scope（確認済み） | 最小の候補 | 分類 |
|---|---|---|---|---|
| Calendar 読み取り: 予定表の選択 | `calendarList.list` | `calendar.readonly`, `calendar`, `calendar.calendarlist`, `calendar.calendarlist.readonly` | `calendar.calendarlist.readonly` | 公開 docs に記載なし（未検証） |
| Calendar 読み取り: 予定一覧 | `events.list` | `calendar.readonly`, `calendar`, `calendar.events.readonly`, `calendar.events`, `calendar.app.created`, `calendar.events.freebusy`, `calendar.events.owned`, `calendar.events.owned.readonly`, `calendar.events.public.readonly` | `calendar.events.readonly`。自分の予定表だけなら `calendar.events.owned.readonly` | 公開 docs に記載なし（未検証） |
| Calendar 予定作成 | `events.insert` | `calendar`, `calendar.events`, `calendar.app.created`, `calendar.events.owned` | `calendar.events.owned`。app が作った副予定表だけでよいなら `calendar.app.created` | 公開 docs に記載なし（未検証） |
| Gmail 読み取り（一覧・本文） | `users.messages.list`, `users.messages.get` | `mail.google.com`, `gmail.modify`, `gmail.readonly`, `gmail.metadata` | 本文が要るので `gmail.readonly` | restricted（確認済み） |
| Gmail 送信 | `users.messages.send` | `mail.google.com`, `gmail.modify`, `gmail.compose`, `gmail.send` | `gmail.send` | sensitive（確認済み） |

各 scope の説明（確認済み、[Calendar scopes](https://developers.google.com/workspace/calendar/api/auth)）:

- `calendar.events.readonly`: "View events on all your calendars."
- `calendar.events.owned`: "See, create, change, and delete events on Google calendars you own."
- `calendar.events.owned.readonly`: "See the events on Google calendars you own."
- `calendar.app.created`: "Make secondary Google calendars, and see, create, change, and delete events on them."
- `calendar.calendarlist.readonly`: "See the list of Google calendars you're subscribed to."

Gmail の分類（確認済み、[Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes)）:

- sensitive には `gmail.send` "Send email on your behalf." が入っている。
- restricted には `gmail.readonly` "View your email messages and settings." と `gmail.metadata` "View your email message metadata such as labels and headers, but not the email body." が入っている。`gmail.compose`、`gmail.modify`、`gmail.insert`、`mail.google.com` も restricted。
- 分類の定義は "Sensitive: ... They require additional OAuth App Verification." と "Restricted: These scopes provide wide access to Google user data and require restricted scope OAuth App Verification." で、加えて "If you store restricted scope data on servers (or transmit), then you must go through a security assessment." とある。
- `gmail.metadata` では検索できない。[messages.list](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list) の `q` に "Parameter cannot be used when accessing the api using the gmail.metadata scope." とある。

Calendar の分類について:

- 確認済み: [Sensitive scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification) に "Examples of sensitive scopes include reading events stored in Google Calendar" とある。
- 確認済み: 分類は Cloud Console で表示される。[OAuth App Verification Help Center](https://support.google.com/cloud/answer/13463073) に "When you add scopes to your project, scope categories (non-sensitive, sensitive, or restricted) are indicated automatically in the Google Cloud Console." とある。
- 推論: Calendar の scope は restricted ではない。Calendar の scope を restricted とする一次情報は見つからず、管理者の high-risk 一覧も Gmail、Drive、Docs、Chat に限られている。読み取りと予定作成の scope は sensitive とみなして設計するのが安全。
- 未検証: `calendar.events.owned`、`calendar.app.created`、`calendar.calendarlist.readonly` が non-sensitive かどうか。確かめるには、Cloud Console の Data Access 画面で scope を足して表示を見る必要があり、project を作る操作になる。

推論:

- Gmail の本文を API で読む方法は、Workspace add-on 用の `gmail.addons.*` を除くと restricted の scope しかない。add-on 用は desktop app では使えない。
- `calendar.events.owned` は、user が所有する予定表（primary を含む）への作成に足りる見込み。ただし共有された他人の予定表には書けない。この見込みは live で確かめていない。

## 3. 公開状態 × user type の行列

主な出典は [OAuth app state overview](https://developers.google.com/identity/protocols/oauth2/production-readiness/overview)、[Manage App Audience](https://support.google.com/cloud/answer/15549945)、[Using OAuth 2.0](https://developers.google.com/identity/protocols/oauth2)、[When is verification not needed](https://support.google.com/cloud/answer/13464323)。

| 構成 | 使える人 | Google の審査 | 同意前の警告 | refresh token | 人数の上限 |
|---|---|---|---|---|---|
| External / Testing | test user に登録した Google アカウントだけ | 不要（開発・試験の例外） | test 用の警告画面 | consent から 7 日で失効 | test user 100 人 |
| External / In production / 未検証 | 全 Google アカウント | sensitive か restricted を使うなら必要。ただし個人利用は例外 | sensitive か restricted を要求すると unverified app 画面。app 名とロゴも出ない | 7 日ルールなし（通常の失効条件だけ） | 未検証の scope を要求する間は、生涯で新規 100 人 |
| External / In production / 検証済み | 全 Google アカウント | brand 検証、sensitive の検証、restricted の検証。restricted で server を経由するなら年次の security assessment | なし（承認済みの scope の範囲で） | 通常 | 承認済みの scope だけなら上限なし |
| Internal（公開状態の区別なし） | 同じ Cloud Organization の member だけ | 不要 | なし | 7 日ルールなし | なし |

各セルの根拠（確認済み）:

- Testing の上限: "Projects configured with a publishing status of Testing are limited to up to 100 test users listed in the OAuth consent screen."（Audience）
- Testing の失効: "Authorizations by a test user will expire seven days from the time of consent. If your OAuth client requests an offline access type and receives a refresh token, that token will also expire."（Audience）。Using OAuth 2.0 にも "A Google Cloud Platform project with an OAuth consent screen configured for an external user type and a publishing status of "Testing" is issued a refresh token expiring in 7 days, unless the only OAuth scopes requested are a subset of name, email address, and user profile" とある。
- Testing の警告: "Users see a warning UI indicating the app is in testing, rather than the standard unverified app screen."（overview）。Audience では "Google will display a warning message before allowing a specified test user to authorize scopes" と書かれている。
- 組織の user も例外にならない: "Organization users are not exempt from these testing requirements unless the app's User Type is set to Internal."（overview）
- 未検証の production: "for apps requesting sensitive or restricted scopes, unverified app warnings (Danger UI) will be displayed to users, and a hard cap of 100 total users applies."（overview）
- 上限が戻らないこと: "The user cap applies over the entire lifetime of the project, and it cannot be reset or changed."（Audience）。表の値は "100 new users in total, after the app presents the unverified app screen" とある。
- Internal: "All users within your organization can access. Verification is not required. Consent screen may not list scopes."（overview）。加えて "Note: Your app will not be subject to the unverified app screen or the 100-user cap if it's designated as internal-only."（When is verification not needed）
- Internal の前提条件: "Projects associated with a Google Cloud Organization can configure Internal users"（Audience）。When is verification not needed には "The project must be owned by the organization, and its OAuth Consent Screen must be configured for internal use. In this case, your app might need approval from an organization administrator." とある。
- 個人利用の例外: "Personal Use apps: If the app is for your personal use (fewer than 100 users), you and your limited number of users can continue using the app without going through verification(users will be allowed to click through “unverified app” warning screens during sign-in)."（When is verification not needed）。[OAuth 2.0 Policies](https://developers.google.com/identity/protocols/oauth2/policies) は個人利用を "not shared with anyone else or will be used by fewer than 100 people (all of whom are known personally to you)" と定義している。
- 例外でも policy は守る: "All apps that integrate with Google APIs are required to comply with Google’s API Services User Data Policy regardless of whether they have been verified."（When is verification not needed）
- security assessment の条件: "Every app that requests access to Google users' restricted data and has the ability to access data from or through a third-party server must go through a security assessment"。また "complete a security assessment at least every 12 months"（[Restricted scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification)）
- 7 日ルール以外の失効条件は 6 節に書いた。

scope の分類だけで見ると次のようになる（確認済み、[Verification requirements](https://support.google.com/cloud/answer/13464321) と Gmail scopes）。

| 分類 | 検証 | 未検証のときの警告と上限 |
|---|---|---|
| non-sensitive だけ | 必須ではない。名前とロゴを出したいなら brand 検証 | unverified app 画面は出ない（Unverified apps の定義は sensitive か restricted を要求する app） |
| sensitive を含む（`gmail.send` など） | brand 検証に加え、許可された用途であること、デモ動画、Limited Use の遵守、より狭い scope では足りない理由の説明 | 警告が出て、100 人の上限 |
| restricted を含む（`gmail.readonly`） | sensitive と同じ要件に加え、server から、または server を経由して data に触れるなら年次の security assessment（CASA） | 警告が出て、100 人の上限 |

## 4. 個人の Google アカウントの場合

確認済み:

- Internal は Cloud Organization に属する project でしか選べない（3 節の Audience の引用）。
- test user でも、アカウントの設定で拒否されうる: "A test user may be unable to authorize scopes requested by your project's OAuth clients due to the availability of Google Services for the account or configured restrictions. ... an account enrolled in Advanced Protection may block most non-Google apps."（Audience）

推論: 個人の Gmail アカウントは Organization を持たないので、使えるのは External だけになる。選択肢は次の 2 つ。

| 案 | 起きること |
|---|---|
| External / Testing。自分を test user に登録する | restricted を含む全 scope を要求できる。警告は test 用のもので済む。consent から 7 日ごとに同意し直しが要る |
| External / In production / 未検証。個人利用の例外に頼る | 7 日失効はない。毎回の同意で unverified app 画面をクリックして進む。project の生涯で 100 人まで |

未検証: In production で未検証の app が restricted の `gmail.readonly` を要求したとき、docs のとおり警告をクリックして進めるのか、それとも "This app is blocked" で止まるのか。docs は警告と上限だと書いている。止まったという報告はあるが二次情報だけで、Google の一次情報では確かめられなかった。P0 で自分の project を使って確かめる必要がある。

## 5. 会社の Google Workspace で管理者が third-party app を制限している場合

出典: [Control which apps access Google Workspace data](https://support.google.com/a/answer/7281227)、[同（third-party & internal）](https://support.google.com/a/answer/13152743)、[Authorize unverified third-party apps](https://support.google.com/a/answer/9352843)、[Review & manage third-party app access requests](https://support.google.com/a/answer/16484119)、OAuth app state overview

確認済み:

- 管理者はいつでも block できる: "Google Workspace administrators can always Block any OAuth app, whether it is Internal or External, Testing or Published, or Verified or Unverified"（overview）
- app ごとの設定: "Trusted—App has access to all Google Workspace services (OAuth scopes), including restricted services." "Specific Google data—Can request data access only to scopes that you specify when configuring the app." "Limited—App can only access unrestricted services." "Blocked–App can't access any Google data."（7281227）
- service ごとの制限は Gmail に限らない: "if you set Calendar access as Restricted, only internal and third-party apps configured with a Trusted or Specific Google data access setting can access Calendar data."（7281227）
- Gmail の high-risk scope には `mail.google.com`、`gmail.compose`、`gmail.insert`、`gmail.metadata`、`gmail.modify`、`gmail.readonly`、`gmail.send`、`gmail.settings.basic`、`gmail.settings.sharing` が入る（7281227 と 13152743）。
- 制限すると既存の token も消える: "If you change access to Restricted, any previously installed apps that you haven't trusted stop working, and tokens are revoked."（7281227）。開発者側から見ると、この失効は "If an admin set any of the services requested in your app's scopes to Restricted (the error is admin_policy_enforced)." として返る（Using OAuth 2.0）。
- 設定されていない app の扱いには 3 つの選択肢がある: "Allow users to access any third-party apps (default)"、"Allow users to access third-party apps that only request basic info needed for Sign in with Google"、"Don't allow users to access any third-party apps"（7281227）。block されている場合、user は申請できる: "If a user requests access to a blocked app, it is added to a list of apps in the Google Admin console for your review."（16484119、Education 版にはない）
- Trusted にすると Testing の制約も外れる: "When a Google Workspace administrator marks an app as Trusted, it is treated as an internal application for that organization. This status overrides certain standard OAuth limitations for the organization's users, such as the 100-test-user cap and the 7-day refresh token expiration limit for apps in the Testing status."（overview）
- Internal app の restricted API: "If you build internal apps (owned by your organization), you can trust all apps to access restricted Google Workspace APIs."（13152743）。Audience にも "User authorization of scopes associated with restricted Google Workspace services, including high-risk Gmail and Drive scopes, might require additional configuration by your organization's administrators." とある。
- 未検証 app への Workspace 側の制限は、Gmail を使い 100 人を超える app にだけかかる: "Unverified third-party apps that access Gmail data and have more than 100 users worldwide are subject to restrictions. Currently, unverified third-party apps with fewer than 100 users worldwide, apps internal to your domain, and unverified third-party apps that access data for Google services other than Gmail aren't subject to restrictions."（9352843）
- Trusted の app には granular consent が出ない: "apps marked as Trusted, bypass the granular permissions consent screen. ... your app will either receive all requested scopes or none."（native-app）

推論: 会社のアカウントで使う経路は 3 つある。

| 経路 | 必要なもの | 結果 |
|---|---|---|
| W1: 個人の project（External）の client ID を、会社の管理者が Trusted か Specific Google data に設定する | 管理者の操作 | 制限された service でも使える。Trusted なら 7 日失効と test user の上限も外れる（overview の記述。live では未確認） |
| W2: 会社の Cloud Organization が所有する project で Internal app を作る | project を会社の Organization に置く権限。restricted の Gmail には「Trust internal apps」が要ることがある | 審査も警告も上限もない。project は会社の管理下に入る |
| W3: 管理者が何も制限していない（unconfigured app が既定の allow で、Gmail と Calendar も Unrestricted） | 何もしない | 個人アカウントと同じ挙動。Testing なら 7 日失効 |

会社が「Don't allow」にしているか、Gmail か Calendar を Restricted にしている場合は、W1 か W2 しか通らない。どちらも管理者の協力が要る。社内規程で許されるかどうかは技術の外の問題で、#10 の判断に関わる。

## 6. scope の追加（incremental authorization）と granular consent

確認済み:

- native-app: "Note: Incremental authorization is not supported for installed apps or devices." と "Note: incremental authorization with installed apps is not supported due to the fact that the client cannot keep the client_secret confidential."
- [web-server](https://developers.google.com/identity/protocols/oauth2/web-server) の `include_granted_scopes`: "If you set this parameter's value to true and the authorization request is granted, then the new access token will also cover any scopes to which the user previously granted the application access."
- 同じページで、付与は project 単位で合算される: "The combined authorization includes all scopes that the user granted to the API project even if the grants were requested from different clients. For example, if a user granted access to one scope using an application's desktop client and then granted another scope to the same application via a mobile client, the combined authorization would include both scopes."
- 一部だけ許可されることがある: "When requesting multiple permissions (scopes), users may not grant your app access to all of them. Your app must verify which scopes were actually granted"（native-app Step 6）。[Granular permissions](https://developers.google.com/identity/protocols/oauth2/resources/granular-permissions) には "Granular permission consent screens are displayed when applications request both Sign-In and non-Sign-In scopes, or more than one non-Sign-In scope." とある。
- token の数の上限: "There is currently a limit of 100 refresh tokens per Google Account per OAuth 2.0 client ID. If the limit is reached, creating a new refresh token automatically invalidates the oldest refresh token without warning."（Using OAuth 2.0）

未検証:

- Desktop client で `include_granted_scopes=true` を付けたときに、Google が拒否するのか、無視するのか、web と同じく合算するのか。native-app は「サポートしない」と書き、web-server は desktop client の付与も合算されると書いていて、2 つの docs が食い違う。
- `include_granted_scopes` を付けずに一部の scope だけを要求したとき、返る token がその scope だけに絞られるか。web-server の説明を裏返すとそう読めるが、明記はない。

推論（設計への含意）:

- `include_granted_scopes` に頼らず、Grant を足すたびに、その時点で要る scope をすべて列挙して authorization をやり直す。返ってきた `scope` を Grant の正本にし、要求と比べて足りなければその Grant を作らない。
- Calendar 用と Gmail 用で refresh token を分けることもできる（client あたり 100 本の上限の内側）。ただし 7 節のとおり revoke は分けられないので、token を分けても Google 側の取り消しは独立しない。

## 7. revoke が同じ client の他の接続に及ぼす影響

確認済み:

- "The token can be an access token or a refresh token. If the token is an access token and it has a corresponding refresh token, the refresh token will also be revoked."（native-app）
- "Key Point: Revocation removes all OAuth 2.0 scopes previously granted to a project, invalidating any issued access or refresh tokens for all clients registered under that project."（native-app と web-server）
- "If you revoke a token that represents a combined authorization, access to all of that authorization's scopes on behalf of the associated user are revoked simultaneously."（web-server）
- 反映には遅れがある: "Following a successful revocation response, it might take some time before the revocation has full effect."（native-app）

推論:

- revoke の単位は「Google アカウント × Cloud project」になる。momo の Calendar 接続で revoke を呼ぶと、同じアカウントの Gmail の token も消える。同じ project の別の client（たとえば将来の Web 用 client）の token も消える。
- 同じ Google アカウントを momo の 2 つの Workspace で、同じ Cloud project 経由で接続すると、片方の revoke でもう片方も切れる。ROADMAP 4 節の「同一 user/client の他の接続へ影響し得る」は、「同一 user/project」と読み替える必要がある。
- Workspace ごとに Google 側の取り消しを独立させたいなら、Workspace ごとに別の Cloud project を使うしかない。client を分けるだけでは足りない。

## 8. refresh token が使えなくなる条件（P6 gate の材料）

確認済み（[Using OAuth 2.0](https://developers.google.com/identity/protocols/oauth2) の "Refresh token expiration"）:

- "The user has revoked your app's access."
- "The refresh token has not been used for six months."
- "The user changed passwords and the refresh token contains Gmail scopes."
- "The user account has exceeded a maximum number of granted (live) refresh tokens."
- "The user granted time-based access to your app and the access expired."。このとき token 応答の `refresh_token_expires_in` に残り秒数が入る（web-server）。
- "If an admin set any of the services requested in your app's scopes to Restricted (the error is admin_policy_enforced)."
- External / Testing の 7 日失効（3 節）。

client 自体が消える条件もある。Policies に "Google reserves the right to delete unused OAuth clients if the client is inactive for at least 6 months." とあり、"Deleted clients can be restored in the Google Cloud Console for 30 days following deletion." と続く。native-app の error 一覧には `deleted_client` がある。

推論: Gmail の scope を持つ token はパスワード変更で切れる。そのため、Calendar と Gmail を 1 本の token にまとめると、パスワード変更で Calendar も一緒に止まる。

## 9. その他、後の判断に関わる制約

確認済み:

- 開発用と本番用で project を分ける: "you must create separate projects in the Google Cloud Console for each deployment tier, such as development, staging, and production."（Policies）
- Limited Use は AI の学習を制限する: "Transferring, selling, or using user data to create, train, or improve a machine learning or artificial intelligence model beyond that specific user’s personalized model for the appropriate use case or user-facing feature."（[Google Workspace user data and developer policy](https://developers.google.com/workspace/workspace-api-user-data-developer-policy)）
- 恒久的な複製を禁じる記述もある: "Note: Remember, our Terms of Service prohibits the scraping, building databases (including databases for model training purposes), or otherwise creating permanent copies of Google User data. This includes keeping cached copies longer than permitted by the cache header."（同上）

推論と未検証:

- 個人利用の例外に入れば検証は要らず、security assessment も要らない。もし将来検証を受けることになれば、Gmail の本文をモデルの API に送ることが "from or through a third-party server" にあたる可能性が高い。この解釈は未検証。
- 「記憶と Job」でメールの本文を保存するときは、上の「恒久的な複製」の記述に触れないかを確かめる必要がある。この ticket の範囲外。

## 未検証事項の一覧

1. Calendar の各 scope の分類（non-sensitive か sensitive か）。Cloud Console の Data Access 画面で確かめられる。
2. Desktop client で `include_granted_scopes` を使えるか。native-app と web-server の docs が食い違っている。
3. In production の未検証 app が `gmail.readonly` を要求したとき、警告で済むか block されるか。
4. Desktop client の token 交換で `client_secret` を省けるか。docs は "Optional" と書くが、live では確かめていない。
5. Workspace の管理者が Trusted にしたとき、Testing の 7 日失効が本当に外れるか。overview にだけ書かれており、Audience と Using OAuth 2.0 には書かれていない。
6. `calendar.events.owned` で primary 予定表に作成できるか。scope の説明からはできると読めるが、live では確かめていない。

## 出典（2026-10-15 に確認、括弧内はページの "Last updated"）

- [OAuth 2.0 for iOS & Desktop Apps](https://developers.google.com/identity/protocols/oauth2/native-app)（2026-09-14）
- [Using OAuth 2.0 to Access Google APIs](https://developers.google.com/identity/protocols/oauth2)（2026-05-26）
- [Using OAuth 2.0 for Web Server Applications](https://developers.google.com/identity/protocols/oauth2/web-server)（2026-09-14）
- [How to handle granular permissions](https://developers.google.com/identity/protocols/oauth2/resources/granular-permissions)（2026-05-26）
- [OAuth 2.0 Policies](https://developers.google.com/identity/protocols/oauth2/policies)（日付は取得できなかった）
- [OAuth app state overview](https://developers.google.com/identity/protocols/oauth2/production-readiness/overview)（2026-05-22）
- [Sensitive scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification)（2026-08-19）
- [Restricted scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification)（2026-08-19）
- [Choose Gmail API scopes](https://developers.google.com/workspace/gmail/api/auth/scopes)（2026-09-10）
- [Choose Google Calendar API scopes](https://developers.google.com/workspace/calendar/api/auth)（2026-09-03）
- Calendar reference: [events.list](https://developers.google.com/workspace/calendar/api/v3/reference/events/list)（2026-07-29）、[events.insert](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert)（2026-07-07）、[calendarList.list](https://developers.google.com/workspace/calendar/api/v3/reference/calendarList/list)（2026-07-29）
- Gmail reference: [messages.list](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list)、[messages.get](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/get)、[messages.send](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/send)（いずれも 2026-04-15）
- [Configure the OAuth consent screen and choose scopes](https://developers.google.com/workspace/guides/configure-oauth-consent)（2026-09-03）
- [Google Workspace user data and developer policy](https://developers.google.com/workspace/workspace-api-user-data-developer-policy)（2026-09-03）
- Google Cloud Help（日付の表示なし）: [Manage App Audience](https://support.google.com/cloud/answer/15549945)、[When is verification not needed](https://support.google.com/cloud/answer/13464323)、[Verification requirements](https://support.google.com/cloud/answer/13464321)、[Unverified apps](https://support.google.com/cloud/answer/7454865)、[OAuth App Verification Help Center](https://support.google.com/cloud/answer/13463073)
- Google Workspace Admin Help: [Control which apps access Google Workspace data](https://support.google.com/a/answer/7281227)（2026-10-13）、[Control which third-party & internal apps access Google Workspace data](https://support.google.com/a/answer/13152743)（2026-10-13）、[Authorize unverified third-party apps](https://support.google.com/a/answer/9352843)（2026-10-13）、[Review & manage third-party app access requests](https://support.google.com/a/answer/16484119)（2026-10-13）
