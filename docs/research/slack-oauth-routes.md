# Slack で Bot token と User token を得る OAuth 経路

- ticket: [#5](https://github.com/ashigirl96/momo/issues/5)（map [#1](https://github.com/ashigirl96/momo/issues/1)）
- 確認日: 2026-10-15。docs.slack.dev は各ページの `.md` 版を読んだ。GitHub の source は commit を固定した permalink で示す。
- 方法: Slack の公開 docs、Slack Help Center、Slack 公式の GitHub（`slackapi`、`slack-samples`）の source と issue を読んだだけ。Slack App も workspace も作っておらず、実 token も live の試験も使っていない。
- 表記: 「確認済み」は原文を引用し URL を付けた事実。「推論」は確認済みの事実から導いた結論。「未検証」は docs で確かめられなかったか、出典同士が食い違う点。

## 要点

1. bot scope を要求できるかは redirect の種類で決まる。desktop redirect（custom URI と、PKCE を有効にした App の localhost）では bot scope を要求できない。HTTPS の server redirect なら bot scope と user scope を 1 回の install で要求でき、`oauth.v2.access` の応答に bot token（top level）と user token（`authed_user`）が両方入る。
2. 「PKCE を有効にしたことのない App の `http://localhost`」は docs だけでは決着しない。OAuth の guide は HTTPS を必須とし、PKCE の guide はその localhost を server redirect と同じに扱うと書く。Slack 公式 repo の issue（2026-03）には、App 設定画面が `http://localhost:3118/callback` の登録を "Please use a complete URL beginning with https (for security)" で拒んだという報告があり、Slack の member は否定せずに ngrok を案内した。一方で Slack 公式 sample の manifest には `http://localhost/slack/oauth_redirect` と bot scope が並んでいる。登録できるかも bot scope が通るかも実機でしか確かめられないので、#18 は残る。
3. redirect を使わない経路がある。配布しない App は、App 設定画面の Install to Workspace で token を得られる。docs はこれを "without any code for handling authorization" と書いている。自分用の Bot なら、bot token と、install した本人の user token をこの経路で手で登録できる（user token が画面に出る点は推論）。
4. server flow では、code の交換にも refresh にも client secret が要る。PKCE の flow は code の交換で secret を送らず、desktop redirect で得た token の refresh にも secret が要らない。Slack 公式の Node SDK の OAuth 実装は client secret を必須にしており、PKCE を実装していない。
5. token rotation は opt-in で、一度有効にすると戻せない。access token は 12 時間で切れ、refresh token は 1 回使うと失効する。PKCE を有効にした App では、すべての refresh token が 30 日で切れる。
6. 配布しない App は、App を作った workspace にしか install できない。会社の Slack に入れるには、会社の workspace で App を作るか、App を配布する。workspace の owner は全プランで App の承認制を有効にでき、Enterprise では org の app 管理 policy があると承認制が自動で有効になる。配布した App には redirect URL の SSL が求められ、Marketplace 外で商用配布した App は `conversations.history` が 1 分 1 回・15 件に絞られる。
7. Socket Mode の app-level token（`xapp-`）は OAuth では得られず、App 設定画面で作る。Socket Mode の App は Slack Marketplace に載せられないが、自分用の App ならこの制約は関係しない。app-level token も opt-in で rotation できる。
8. 初期 API の 5 つ（`auth.test`、`conversations.info`、`conversations.history`、`conversations.list`、`chat.postMessage`）は、どれも bot token と user token の両方で呼べる。違いは見える範囲で、bot token は bot が参加している会話だけを読み、user token は参加していない public channel も読める。

## 1. 経路ごとの比較

| 経路 | bot scope | user scope | code 交換の client secret | rotation | refresh token の期限 |
|---|---|---|---|---|---|
| HTTPS の server redirect、PKCE を有効にしたことのない App | 可（確認済み） | 可（確認済み） | 要る（確認済み） | 設定で opt-in、戻せない（確認済み） | 30 日の期限なし（PKCE の docs の "instead of lasting indefinitely" からの推論） |
| HTTPS の server redirect、PKCE を有効にした App | 可（推論。desktop redirect の定義に当たらない） | 可（推論） | 未検証。PKCE 引数は任意（確認済み） | 設定で opt-in（確認済み） | 30 日（確認済み） |
| `http://localhost`、PKCE を有効にしたことのない App | docs 上は server redirect 扱いなので可。ただし登録できるかが未決着（未検証） | 同左 | server 扱いなら要る（推論） | 設定で opt-in | 30 日の期限なし（推論） |
| desktop redirect（custom URI、PKCE を有効にした App の localhost） | 不可（確認済み） | 可（確認済み） | 送らない。`code_verifier` を送る（確認済み） | custom URI は常に rotation（確認済み）。localhost は docs に記載なし（未検証） | 30 日（確認済み） |
| App 設定画面の Install to Workspace（redirect なし） | 可（確認済み） | install した本人の分（推論） | 不要。token は設定画面に出る（確認済み） | 未検証 | 未検証 |
| `oauth/v2_user/authorize` と `oauth.v2.user.access` | 不可。user scope 専用（確認済み） | 可（確認済み） | confidential なら要る。PKCE なら不要（確認済み） | 未検証 | 未検証 |

### 1.1 HTTPS の server redirect（確認済み）

出典: [Installing with OAuth](https://docs.slack.dev/authentication/installing-with-oauth/)、[oauth.v2.access](https://docs.slack.dev/reference/methods/oauth.v2.access/)

- bot と user の scope を同じ URL で要求できる: "Bot scopes should be added as `scope=<bot_scope>`, and user scopes should be added as `user_scope=<user_scope>`." "If you requested scopes for a user token, you'll find them with a user access token under the `authed_user` property."
- `oauth.v2.access` の応答例 "Successful token request with scopes for both a bot user and a user token." では、top level が `"token_type": "bot"`、`authed_user` が `"token_type": "user"` になっている。
- HTTPS の要件: "The `redirect_uri` must use HTTPS. Alternatively, you can configure a Redirect URL in the **App Management** page under **OAuth & Permissions**. A Redirect URL must also use HTTPS."
- 一致の規則: "Your `redirect_uri` must match or be a subdirectory of a Redirect URL configured under **App Management**." 複数の Redirect URL があるときは、authorize と access の両方で同じ `redirect_uri` を送らないと `bad_redirect_uri` になる。
- code と state: code は "expires after ten minutes"。"Check the `state` parameter if you sent one along with your initial user redirect. If it doesn't match what you sent, consider the authorization a forgery."
- client secret が要る理由として "You have to prove both that you have the right temporary authorization code, _and_ that you have your app's client secret." と書かれている。
- scope は足し算で、減らせない: "There is no way to remove scopes from an existing token without revoking it entirely."

### 1.2 desktop redirect と PKCE（確認済み）

出典: [Using PKCE](https://docs.slack.dev/authentication/using-pkce/)、[PKCE is now generally available!](https://docs.slack.dev/changelog/2026/03/30/pkce/)（2026-03-30）

- bot scope の禁止: "Desktop redirects are not allowed to request bot scopes. Refreshes for those tokens do not require a `client_secret` because they are intended to be used on a public client."
- desktop redirect の定義: "Custom URI schemes (e.g. `myApp://auth`) are always treated as desktop redirects. We will reject any custom URI schemes if PKCE parameters are not used." "Redirects to `localhost` (e.g. `http://localhost:8080/auth`) are treated as desktop redirects if the app has opted into PKCE. If the app has never enabled PKCE, they will be treated like a server redirect."
- 有効化は戻せない: "Enabling PKCE marks your app as a public client, which is is a one-way operation. It cannot be disabled without contacting Slack support."
- PKCE 引数は任意: "Once the PKCE setting is enabled, your app may use the PKCE arguments (e.g. `code_challenge` , `code_challenge_method` and `code_verifier` ) for any OAuth request. However, your app **must** use the PKCE arguments if you are redirecting to a custom URI scheme."
- code の交換で secret を送らない: "The client should call the `oauth.v2.access` API method, but should not include `client_secret` in the parameters. Instead, the client should provide the code and the `code_verifier` secret it created earlier." `code_challenge_method` は S256 だけ。
- changelog は GA 前の状態を "Previously available in early access by request only" と書き、desktop redirect を "(custom URI schemes and `localhost` redirects for PKCE-enabled apps)" と言い直している。PKCE を有効にしたことのない App の localhost には触れていない。

推論: PKCE を有効にしても HTTPS の redirect は desktop redirect に当たらないので、bot scope を要求できるはず。ただしこの組み合わせで client secret を省けるか、refresh に secret が要るかは書かれていない（未検証）。

### 1.3 user token だけの flow（確認済み）

出典: [Installing with OAuth](https://docs.slack.dev/authentication/installing-with-oauth/)、[oauth.v2.user.access](https://docs.slack.dev/reference/methods/oauth.v2.user.access/)、[Slack MCP server overview](https://docs.slack.dev/ai/slack-mcp-server/)

- `https://slack.com/oauth/v2_user/authorize` で始め、`oauth.v2.user.access` で交換する。method page は "This method is used to initiate the OAuth flow using just user scopes (no bot scopes)." と書き、使う場面に "You only need user tokens, not bot tokens" と "You're building MCP integrations with desktop IDE clients like Cursor or Claude Code" を挙げる。応答は `"token_type": "user"` と `id_token` を含む。
- guide は "Use the `oauth.v2.access` API method unless your client cannot support passing `scope` and `scope_user` in the same request." と書いている。
- MCP の docs は "Slack supports confidential OAuth for MCP clients. You'll need to use your app's `client_id` and `client_secret` for Slack OAuth." と書き、続けて "Looking to use desktop clients? PKCE support is now available!" とある。

### 1.4 redirect を使わない install（確認済み）

出典: [Quickstart: app settings](https://docs.slack.dev/app-management/quickstart-app-settings/)、[Distribution](https://docs.slack.dev/app-management/distribution/)

- 設定画面の手順は "Install your app by selecting the **Install to Workspace** button." で、続けて "After installation, navigate back to the **OAuth & Permissions** page. You'll see an **access token** under **OAuth Tokens**." とある。
- distribution の guide は "Once created, your app can be installed to its associated workspace without any code for handling authorization. The one-click install for an unlisted single-workspace app generates an access token, which can then be used to authenticate API requests, but only within that associated workspace." と書く。
- [Tokens](https://docs.slack.dev/authentication/tokens/) は user token を "They are issued for the user who installed the app and for users who authenticate the app." と説明する。
- Slack CLI は公開 docs に method page のない `apps.developerInstall` で install し、応答の `api_access_tokens` に `bot`、`app_level`、`user` を持つ（[app.go L43](https://github.com/slackapi/slack-cli/blob/06c2fd4cde412dddd4caae705529f2a04265276d/internal/api/app.go#L43)、[L732-L739](https://github.com/slackapi/slack-cli/blob/06c2fd4cde412dddd4caae705529f2a04265276d/internal/api/app.go#L732-L739)）。`slack run` はこの bot token と app-level token を `SLACK_BOT_TOKEN` と `SLACK_APP_TOKEN` に入れる（[install.go L788-L808](https://github.com/slackapi/slack-cli/blob/06c2fd4cde412dddd4caae705529f2a04265276d/internal/pkg/apps/install.go#L788-L808)）。

推論: user scope も付けておけば、Install to Workspace で install した本人の user token も得られる。設定画面にそれが出るかは docs に書かれていない（未検証）。`apps.developerInstall` は CLI 内部の method なので、momo から直接呼ぶ前提にはしない。

## 2. localhost の食い違い

### 確認済み

1. OAuth の guide は redirect に HTTPS を求めている（1.1 の引用）。localhost の例外は書かれていない。
2. PKCE の guide は、PKCE を有効にしたことのない App の localhost を "treated like a server redirect" と書く（1.2 の引用）。
3. [Distribution](https://docs.slack.dev/app-management/distribution/) は、SSL を配布した App の要件として書く: "Slack apps open to installation by other workspaces have additional security requirements. Your app must support SSL for all of the following URLs:" の最初の項目が "OAuth redirect URLs"。
4. [App manifest reference](https://docs.slack.dev/reference/app-manifest/) の `oauth_config.redirect_urls` は "An array of strings containing OAuth redirect URLs. A maximum of 1000 redirect URLs can be included in this array." とだけ書く。slash command の url や Events API の request_url には "full `https` URL" と書いてあるのに、redirect_urls には HTTPS の条件がない。
5. Slack 公式 sample [bolt-js-upgrade-app の manifest.json L38-L40](https://github.com/slack-samples/bolt-js-upgrade-app/blob/9e9d4eaa16ee4ccdd3d644914976cd3113bc2633/manifest.json#L38-L40) は `"redirect_urls": ["http://localhost/slack/oauth_redirect"]` と `"bot": ["chat:write", "commands"]` を持ち、`pkce_enabled` はない。この redirect は 2022-06-16 の最初の commit（`d2cc2cc`）からあり、2026-10 の commit 後も残っている。[README L14-L17](https://github.com/slack-samples/bolt-js-upgrade-app/blob/9e9d4eaa16ee4ccdd3d644914976cd3113bc2633/README.md#L14-L17) は "From an app manifest" を選んで manifest.json の中身をそのまま貼る手順を書く。同じ README の [L65](https://github.com/slack-samples/bolt-js-upgrade-app/blob/9e9d4eaa16ee4ccdd3d644914976cd3113bc2633/README.md#L65) は "When using OAuth, Slack requires a public URL where it can redirect requests so your app can generate a token." と書き、ngrok の HTTPS URL を Redirect URL に足させている。
6. [slackapi/slack-skills-plugin#21](https://github.com/slackapi/slack-skills-plugin/issues/21)（2026-03-24 起票）で、利用者が自作 App に `http://localhost:3118/callback` を登録しようとして "Please use a complete URL beginning with https (for security)" で拒まれたと報告した。Slack の member（association: MEMBER）は 2026-03-30 に "The Slack MCP Server requires a User Token (xoxp). This is always a painful spot for local development, but we're actively working to make this easier for developers." と答え、ngrok を案内した。報告そのものは利用者の観察で、Slack が仕様として書いたものではない。
7. Slack の docs が Claude Code 向けに載せる設定は、Claude 用の Slack App の client ID と `"callbackPort": 3118` を使う（[Connect to Claude](https://docs.slack.dev/ai/slack-mcp-server/connect-to-claude/)）。#21 の報告では、この形の設定が送る redirect は `http://localhost:3118/callback` だった。MCP の flow は user token だけを扱う（1.3）。
8. Slack 公式の OAuth 実装に localhost を特別に扱う code は見つからなかった。GitHub code search で `slackapi/node-slack-sdk`、`slackapi/python-slack-sdk`、`slackapi/bolt-python` を "localhost" で検索し、OAuth の実装に当たる hit はなかった（examples と test を除く）。"code_verifier" は、この 3 つと `slackapi/bolt-js` のどれでも hit しなかった。code search の index が漏れている可能性は残る。

### 推論

- 1 と 2 は、2 が「登録済みの localhost をどう分類するか」を書いたものだと読めば両立する。HTTPS の規則は新しく登録する URL の検査で、2 は manifest で入った URL や古い登録の扱いを書いた可能性がある。ただしこの読み方を支える Slack の記述はない。
- 6 の報告は PKCE の GA（2026-03-30）の 6 日前で、当時 PKCE は申請制だった。報告者の App は PKCE を有効にしたことのない App だった可能性が高い。そうなら、設定画面は「PKCE を有効にしたことのない App の `http://localhost`」を受け付けていなかったことになる。
- 5 の sample は manifest からの作成で `http://localhost` が通ることを示唆する。ただし README 自体が HTTPS の公開 URL を使わせており、その redirect で bot scope の install が通ったという記録はない。
- 3 は、配布しない App には SSL の要件を課していないとも読める。これは 1 の無条件の書き方と食い違う。

### 未検証（#18 で確かめること）

- 設定画面で、PKCE を有効にしたことのない App に `http://localhost:<port>/<path>` を登録できるか。拒まれたらエラー文言を記録する。
- manifest から App を作るとき、`redirect_urls` の `http://localhost` が受け付けられるか。
- 受け付けられたとき、`scope`（bot）と `user_scope` を付けた authorize が通り、`oauth.v2.access` の応答に bot token と `authed_user` の user token が両方返るか。

docs、changelog、公式 sample、公式 SDK のどれもこれに直接答えていない。#18 は閉じずに残す。

## 3. client secret の扱い

### 確認済み

- code の交換に secret が要る（1.1）。`oauth.v2.access` の method page は "If at all possible, avoid sending `client_id` and `client_secret` as parameters in your request. We strongly recommend supplying the Client ID and Client Secret using the HTTP Basic authentication scheme" と書く。
- rotation の refresh にも要る: "Note that `client_id` and `client_secret` are still required for this call as well."（[Using token rotation](https://docs.slack.dev/authentication/using-token-rotation/)）。長期 token を rotation に切り替える `oauth.v2.exchange` にも `client_id` と `client_secret` が要る。
- PKCE の desktop redirect では、code の交換で secret を送らない。refresh の例は "POST oauth.v2.access grant_type=refresh_token refresh_token=xoxe-1-abcd client_id=123.456" で、secret を含まない（1.2）。
- refresh token の保管について "Store the refresh token as you would an access token, in a database or secure datastore (not in code)." とある。
- Slack 公式の Node SDK（`@slack/oauth` の `InstallProvider`）は secret がないと初期化で失敗する: `'You must provide a valid clientId and clientSecret'`（[install-provider.ts L108-L110](https://github.com/slackapi/node-slack-sdk/blob/2f5954b0252efd9bd5d2e8f22f4433b91753ab65/packages/oauth/src/install-provider.ts#L108-L110)）。refresh も `client_secret` を付けて `oauth.v2.access` を呼ぶ（[L308-L315](https://github.com/slackapi/node-slack-sdk/blob/2f5954b0252efd9bd5d2e8f22f4433b91753ab65/packages/oauth/src/install-provider.ts#L308-L315)）。このファイルには `code_verifier` も `code_challenge` も出てこない。

### 推論

- HTTPS の server redirect で bot token を得るなら、client secret は code の交換と refresh のたびに使う。callback を受ける側（momo では securityd）が secret を持つ必要がある。
- Slack の SDK を使っても PKCE は手で実装することになる。momo は Bun でスクラッチに書くので、この点は差にならない。

## 4. token rotation と refresh の期限（確認済み）

出典: [Using token rotation](https://docs.slack.dev/authentication/using-token-rotation/)、[Tokens](https://docs.slack.dev/authentication/tokens/)、[Using PKCE](https://docs.slack.dev/authentication/using-pkce/)、[Installing with OAuth](https://docs.slack.dev/authentication/installing-with-oauth/)

- rotation しない token は失効しない: "OAuth tokens do not expire." 失効するのは "if a workspace owner fully uninstalls the app, a user individually removes their configurations, or the account of the user who initially authenticated the Slack app is deactivated" のとき。
- 有効化は戻せない: "Token rotation may not be turned off once it's turned on"。対象は "granular bot, user, or app-level tokens"。
- access token の期限: "With token rotation, it expires every 12 hours." `expires_in` は "It will always expire in 43,200 seconds, which is 12 hours."
- refresh token は使い捨て: "The previous token stops working as soon as it is redeemed, so an app that keeps reusing its original refresh token will fail on the second refresh." "After calling the `oauth.v2.access` API method, the refresh token you used is revoked after a short grace period."
- 有効な token は 2 つまで: "we will enforce a limit of 2 active tokens. If more than 2 tokens exist after the refresh, the oldest additional token will be revoked."
- 既存の長期 token は `oauth.v2.exchange` で 1 回だけ交換できる: "You won't be able to exchange the same access token for a refresh token more than once." 最初の refresh の後、元の長期 token は失効する。
- PKCE を有効にした App: "Note that if PKCE is enabled, all refresh tokens issued to your app will expire in 30 days instead of lasting indefinitely." custom URI の redirect は rotation の設定に関係なく rotation する。changelog は "OAuth installations issued to a standard web URL (e.g. `myWebshite.com/auth`) will only receive rotating tokens if the 'token rotation' setting is enabled." と書く。
- rotation 中の `auth.revoke` は install を消さない: "For apps _with_ token rotation, the `auth.revoke` API method will revoke a single token without changing the underlying installation."
- Node SDK は、期限切れか 2 時間以内に切れる token を refresh する（[install-provider.ts L228-L233](https://github.com/slackapi/node-slack-sdk/blob/2f5954b0252efd9bd5d2e8f22f4433b91753ab65/packages/oauth/src/install-provider.ts#L228-L233)）。

### 推論

- PKCE の 30 日は refresh token 1 本ごとの期限と読める。refresh のたびに新しい refresh token が返るので、30 日以内に refresh し続ければ再同意は要らないはず。30 日が最初の同意から数えた絶対期限かどうかは書かれていない（未検証）。
- rotation を有効にした App で Install to Workspace を使ったとき、設定画面が refresh token を出すかは書かれていない（未検証）。出さないなら、手で登録した token は 12 時間で使えなくなる。手での登録を採るなら、rotation を有効にしない前提になる。

## 5. 会社の Slack に自作 App を install するとき

### 確認済み

- 配布しない App は、App を作った workspace にしか入らない。[Installing with OAuth](https://docs.slack.dev/authentication/installing-with-oauth/) の表に "Your app can only be installed on the workspace that owns it." とあり、違う workspace では `invalid_team_for_non_distributed_app` になる。Enterprise の org で作った org-wide の App は、同じ org の workspace に入れられる。
- 配布した App の要件: redirect URL などの SSL（2 の 3）。distribution の guide は承認についても "Workspaces can also enable admin approval requirements so that users can't directly install apps, but can request installation via a guided interface." と書く。
- workspace の承認制（[Manage app approval for your workspace](https://slack.com/help/articles/222386767-Manage-app-approval-for-your-workspace)、en-gb の版を読んだ）: "Apps connect third-party services to Slack, and by default, members can install them without approval from a workspace owner." 設定できるのは workspace の owner で、"Available on all subscriptions"。"Note: If you're a workspace owner in an Enterprise organisation, app approval will automatically be enabled for your workspace if an org owner has set an app management policy."
- Enterprise の org（[Manage apps in an Enterprise organization](https://slack.com/help/articles/360000281563-Manage-apps-in-an-Enterprise-organization)）: App の出自は "Apps can be from the Slack Marketplace, Internal if built by someone in your organisation or Distributed if a developer hasn't submitted it to the Slack Marketplace for review." と分類される。承認は scope を見て行う: "Review the app's scopes, then click on Approve."
- 承認の API（[Managing app approvals](https://docs.slack.dev/admins/managing-app-approvals/)、Enterprise plan のみ）: `app_requested` event の `developer_type` に `internal` がある。承認時に `bot_scopes` と `user_scopes` で optional scope の一部だけを許可できる。
- Slack CLI の install は、承認待ちになると "Your request to install the app is pending" と出す（[install.go L254-L256](https://github.com/slackapi/slack-cli/blob/06c2fd4cde412dddd4caae705529f2a04265276d/internal/pkg/apps/install.go#L254-L256)）。
- install した人が抜けると App が消える: "Apps that use scopes beyond those listed above will be automatically uninstalled if the user who installed it leaves the workspace or becomes a guest user."（[Distribution](https://docs.slack.dev/app-management/distribution/)）。bot token については "Since acting independently allows your app to stay installed even when an installing user is deactivated, using bot tokens is usually for the best." とある（[Tokens](https://docs.slack.dev/authentication/tokens/)）。
- Marketplace 外で商用配布した App の制限（[Rate limit changes for non-Marketplace apps](https://docs.slack.dev/changelog/2025/05/29/rate-limit-changes-for-non-marketplace-apps/)、2025-05-29）: `conversations.history` と `conversations.replies` は 1 分 1 回、`limit` の最大は 15 件になる。"Internal customer-built applications are not impacted by these changes." 内製の App は 50 回以上/分、最大 1,000 件のまま。

### 推論

- 個人の Slack と会社の Slack の両方で同じ App を使うには、App を配布する必要がある。配布すると redirect URL に SSL が要り、`conversations.history` の制限の対象になるおそれがある。Slack workspace ごとに別の App を作り、どれも配布しないほうが、momo の Workspace 分離にも合う。
- 会社の Slack で承認制が有効なら、install は承認の request になり、admin は bot scope と user scope の両方を見て判断する。

### 未検証

- 会社が member による App の作成そのものを禁止できるか。読んだ docs には出てこなかった。
- 自分用に 1 つの別 workspace へ配布した App が「商用配布」に当たり、`conversations.history` の制限を受けるか。changelog は "commercially distributed" と書くだけで、判定の基準は書いていない。
- 承認済みの App で、別の user が後から user token を得るときに承認がもう一度要るか。

## 6. Socket Mode の app-level token（確認済み）

出典: [Using Socket Mode](https://docs.slack.dev/apis/events-api/using-socket-mode/)、[Tokens](https://docs.slack.dev/authentication/tokens/)

- 公開の Request URL が要らない: "Socket Mode allows your app to use the Events API and interactive features—_without_ exposing a public HTTP **Request URL**."
- app-level token は設定画面で作る: "Under **Basic Information**, scroll to the **App-level tokens** section and click the button to generate an app-level token." この token で `apps.connections.open` を呼び、WebSocket の URL を得る。Slack 公式 sample の手順では scope に `connections:write` を付ける（[bolt-js-upgrade-app README L24](https://github.com/slack-samples/bolt-js-upgrade-app/blob/9e9d4eaa16ee4ccdd3d644914976cd3113bc2633/README.md#L24)）。
- 配布の制約: "Apps using Socket Mode are _not_ currently allowed in the public Slack Marketplace." Enterprise の org 全体へは "you can make your app deployable organization-wide" とある。
- 接続: "Socket Mode allows your app to maintain _up to 10_ open WebSocket connections at the same time." "No matter what, you'll need to handle connection refreshes once every few hours."
- 受信した event の検証は要らない: "there's no need to verify or validate inbound events, because you're receiving the events over a pre-authenticated WebSocket."
- app-level token の rotation: 既定では失効しない（"App-level tokens do not expire by default."）。opt-in すると "Rotating app-level token strings begin with `xoxe.xapp-`"、"Associated access tokens expire 12 hours after they're issued. Refresh tokens are single-use."、"A rotating app-level token's access and refresh token values are each shown only once when creating the token." refresh は `oauth.v2.access` に client の資格情報を付けて呼ぶ。
- Tokens のページは manifest の `settings.app_level_token_rotation_enabled` を挙げるが、App manifest reference にはこの key が載っていない。

推論: app-level token は OAuth の経路とは別に、所有者が設定画面で作って手で登録する。Marketplace に出さない自分用の App では、Socket Mode の配布制約は効かない。Socket Mode は Request URL を不要にするだけで、OAuth の redirect URL は別に要る。

## 7. 初期 API の token 対応表（確認済み）

各 method page の "Scopes" 欄による。

| API | bot token | user token | 要る scope（bot と user で同じ） | 注意 |
|---|---|---|---|---|
| [`auth.test`](https://docs.slack.dev/reference/methods/auth.test/) | 可 | 可 | なし（"No scopes required"） | bot token の応答には `bot_id` が入る |
| [`conversations.info`](https://docs.slack.dev/reference/methods/conversations.info/) | 可 | 可 | `channels:read`、`groups:read`、`im:read`、`mpim:read` のうち会話の種類に合うもの | |
| [`conversations.list`](https://docs.slack.dev/reference/methods/conversations.list/) | 可 | 可 | `channels:read`、`groups:read`、`im:read`、`mpim:read` | |
| [`conversations.history`](https://docs.slack.dev/reference/methods/conversations.history/) | 可 | 可 | `channels:history`、`groups:history`、`im:history`、`mpim:history` | bot token は "Any conversation the relevant bot is a member of."、user token は "Any private conversation the user is a member of, and all public conversations."。`not_in_channel` は "Only user tokens can access public channels they are not in." 商用配布の制限は 5 を参照 |
| [`chat.postMessage`](https://docs.slack.dev/reference/methods/chat.postMessage/) | 可 | 可 | `chat:write` | bot は "New Slack apps do _not_ begin life with the ability to post in all public channels." で、全 public channel に投稿するには `chat:write.public` が要る。user token の `not_in_channel` は "Cannot post user messages to a channel they are not in."。`as_user` は classic app 専用 |

推論: bot token で読めない public channel を user token で読めてしまうので、Bot token で失敗した要求を User token で救済しないという ROADMAP の方針（P5）は、この違いを前提にした安全側の規則として効く。

## 8. map への含意（推論）

- #19「Slack Bot/User の接続経路」の候補に、redirect を使わない Install to Workspace を明示して並べるとよい。Slack workspace ごとに配布しない App を作るなら、bot token と自分の user token を redirect なしで得られ、localhost も公開 callback も要らない。ただし rotation を有効にすると手での登録と噛み合わない可能性がある（4 の未検証）。
- #19 には「1 つの App を配布して複数の Slack workspace で使うか、Slack workspace ごとに配布しない App を作るか」という軸も要る。配布は SSL の redirect と `conversations.history` の制限につながる（5）。
- #18「Slack のテスト App で localhost redirect を確かめる」は残す。手順には、設定画面での登録と manifest での登録の両方を入れる（2 の未検証）。#19 で Install to Workspace か HTTPS の callback を採るなら、#18 は不要になる。
- map の「Slack からの受信」は、app-level token が OAuth の外で作られ、rotation も選べる点を前提にできる（6）。

## 出典

確認日はすべて 2026-10-15。

- [Installing with OAuth](https://docs.slack.dev/authentication/installing-with-oauth/)
- [Using PKCE](https://docs.slack.dev/authentication/using-pkce/)
- [PKCE is now generally available!](https://docs.slack.dev/changelog/2026/03/30/pkce/)（2026-03-30）
- [oauth.v2.access](https://docs.slack.dev/reference/methods/oauth.v2.access/)
- [oauth.v2.user.access](https://docs.slack.dev/reference/methods/oauth.v2.user.access/)
- [oauth.v2.exchange](https://docs.slack.dev/reference/methods/oauth.v2.exchange/)
- [Using token rotation](https://docs.slack.dev/authentication/using-token-rotation/)
- [Tokens](https://docs.slack.dev/authentication/tokens/)
- [Using Socket Mode](https://docs.slack.dev/apis/events-api/using-socket-mode/)
- [App manifest reference](https://docs.slack.dev/reference/app-manifest/)
- [Distribution](https://docs.slack.dev/app-management/distribution/)
- [Quickstart: app settings](https://docs.slack.dev/app-management/quickstart-app-settings/)
- [Managing app approvals](https://docs.slack.dev/admins/managing-app-approvals/)
- [Rate limit changes for non-Marketplace apps](https://docs.slack.dev/changelog/2025/05/29/rate-limit-changes-for-non-marketplace-apps/)（2025-05-29）
- [Slack MCP server overview](https://docs.slack.dev/ai/slack-mcp-server/)、[Connect to Claude](https://docs.slack.dev/ai/slack-mcp-server/connect-to-claude/)
- method page: [auth.test](https://docs.slack.dev/reference/methods/auth.test/)、[conversations.info](https://docs.slack.dev/reference/methods/conversations.info/)、[conversations.list](https://docs.slack.dev/reference/methods/conversations.list/)、[conversations.history](https://docs.slack.dev/reference/methods/conversations.history/)、[chat.postMessage](https://docs.slack.dev/reference/methods/chat.postMessage/)
- Help Center: [Manage app approval for your workspace](https://slack.com/help/articles/222386767-Manage-app-approval-for-your-workspace)、[Manage apps in an Enterprise organization](https://slack.com/help/articles/360000281563-Manage-apps-in-an-Enterprise-organization)
- GitHub: [slackapi/slack-skills-plugin#21](https://github.com/slackapi/slack-skills-plugin/issues/21)、[slack-samples/bolt-js-upgrade-app@9e9d4ea](https://github.com/slack-samples/bolt-js-upgrade-app/tree/9e9d4eaa16ee4ccdd3d644914976cd3113bc2633)、[slackapi/slack-cli@06c2fd4](https://github.com/slackapi/slack-cli/tree/06c2fd4cde412dddd4caae705529f2a04265276d)、[slackapi/node-slack-sdk@2f5954b](https://github.com/slackapi/node-slack-sdk/tree/2f5954b0252efd9bd5d2e8f22f4433b91753ab65)
