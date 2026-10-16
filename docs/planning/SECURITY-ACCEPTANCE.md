# セキュリティ・障害復旧の受入チェック

2026-10-15 / r2：domain別Drizzle構成に対応 / **提案する試験計画。実施結果ではない。**

この文書はSKILLのreviewを補う、この製品固有のリリースgateである。すべての攻撃や実装欠陥を網羅した保証書ではない。基本となる隔離・資格情報注入・OAuthの考え方は [S11](SOURCES.md#agent-sdk--runtime)、[S20–S28](SOURCES.md#slack)、[S29](SOURCES.md#security-standards) を参照する。

## A. 脅威モデルと検証環境

守る対象はvendor access/refresh token、OAuth client secret、LLM API key、Vault/CA秘密鍵、Workspaceごとの会話・記憶・添付、正当な人の承認、外部への書き込み。

攻撃者はメール/Web/リポジトリ/Slackメッセージに悪意ある内容を置ける。Botがそれに従ってsandbox内で任意コードを実行できる前提で試験する。ホストOS、trusted backend/securityd、コンテナ管理基盤はこの初期モデルでは信頼する。所有者と同じmacOSユーザーで動くsoftwareから会話・記憶・添付は守らない（[ADR-0004](../adr/0004-all-workspaces-share-one-macos-user.md)）。単なるprompt instructionや同じプロセス内のモジュール分割は攻撃者を隔離しない。

テストfixtureは少なくとも内部Workspace 2個、各Bot 2体、会話2個、Slack team 2個、Slack Bot/User主体、Google account 2個を用意する。通常のCIは模擬providerで行い、live OAuth/API試験は明示的に用意したテスト先に限定する。

**実tokenの導入前に:** P3のsandbox非露出/迂回不可/別Workspace拒否を模擬資格情報で通す。live試験には人が承認したfixtureと最小scopeを使う。

## B. Workspaceとidentity — P2から必須

- [ ] Workspace IDをURL/body/queryで別のものにすると、認証済みactor/run scopeに合わない要求が拒否される。
- [ ] Bot、Conversation、Session、Connection、Grant、Approval、Job、Memory、ArtifactのIDを差し替えても越境できない。
- [ ] 複合foreign keyまたは同等の永続層制約で、別Workspaceの親子を作れない。
- [ ] domainの公開操作が信頼側で確定したTenantContextを要求し、Drizzleのread/update/delete・JOIN・検索にもscope条件を適用する。既定Workspaceへの暗黙fallbackを持たない。
- [ ] Repository層を作らず、実migrationを適用した一時SQLiteと公開操作でWorkspace越境を試験する。Drizzleの採用やpackage分割そのものを認可の証拠にしない。
- [ ] cache key、全文検索、将来のvector検索、ページングcursor、SSE/WebSocket購読にも同じscopeがある。
- [ ] 「全件検索してから表示をfilter」ではなく、検索対象自体を先に限定する。
- [ ] Workspace切替中の遅延応答で前のWorkspaceのカード/メッセージを新しい画面へ混入させない。
- [ ] agentは管理用IPC/APIへ到達できず、自分へGrantを追加・Approvalを決裁できない。
- [ ] 外部eventのworkspace/bot指定を信用せず、検証済みinstallationとChannel bindingから内部contextを解決する。
- [ ] 機密URL・OAuth callback・ログのmessageに含まれるWorkspace IDを信頼する別経路が存在しない。
- [ ] momoのデータdirは0700、DBと鍵まわりのfileは0600で、Time Machineの除外が付いている。FileVaultが無効なら起動時に警告する（[ADR-0004](../adr/0004-all-workspaces-share-one-macos-user.md)）。
- [ ] Workspaceを削除した後、app.db・security.dbの空きページに行の中身が残らない。

DBを二つに分ける、型にbrandを付ける、RLS風filterを置く、という個々の方法だけを分離の証拠にはしない。実API・検索・stream・workerの経路で否定試験を行う。

## B2. domain別Drizzleとmigration — P2/P3から必須

- [ ] 各tableのschema・migration所有domainが一つに定まり、対応する `packages/<domain>` に配置されている。
- [ ] 空app.dbを全domainのmigrationから構築でき、既存DBからの更新でもデータとWorkspace制約が保たれる。
- [ ] 別domainの同名・異なる作成順のmigrationを取り違えず、繰り返し適用で重複DDLが実行されない。
- [ ] 依存するtable/column/constraintの適用順とcross-domain FKを確認し、domain単位の生成が他domainの意図しないDROP/CREATEを生まない。
- [ ] 同じDBへの適用が直列化され、途中失敗を成功扱いせず、不整合なschemaで通常処理を開始しない。
- [ ] domain限定schemaの `push` を本番共有DBへ実行する経路がない。
- [ ] 同じapp.dbの複数domain操作に原子性が必要な場合、同じtransaction内で成功/失敗し、認可失敗で部分書き込みが残らない。
- [ ] security.dbはpackages/securityの生成SQLを正本とし、Rust側での適用とSQL操作を試験する。Bun/web/agentは実security.dbを開かない。
- [ ] Rust側に独立した手書きDDL履歴がなく、buildに同梱したSQLと開発時schemaの整合を確認できる。

## C. Vaultと資格情報 — P3から必須

- [ ] keyはOS Keychain等に保護され、平文のDB・設定・配布バイナリ内に同居しない。
- [ ] 既存暗号実装を使い、nonce/RNG/AEAD関連データを検査する。独自暗号を作らない。
- [ ] ciphertextを別Workspace/Connectionのrecordへ移しても正しく認証されず復号できない。
- [ ] secret取得汎用APIがなく、Botに見せるのは接続metadataと操作結果だけである。
- [ ] OAuth token交換・refresh応答はsecuritydで終端され、Web/backend/agentへtoken本文を返さない。
- [ ] 設定時に人が入力する秘密は専用の管理経路だけを通る。チャット、analytics、URL queryへ入れない。
- [ ] sandbox env、argv、filesystem、SDK transcripts、tool outputsにvendor/LLM tokenが存在しない。
- [ ] ログ、HTTP trace、例外、クラッシュ診断にAuthorization/cookie/refresh tokenが出ない。
- [ ] upstreamがheader/tokenを反射する模擬応答を返してもagentに漏らさない。既知の反射経路は拒否/整形する。
- [ ] 同時refreshを一主体ごとに直列化し、rotation結果を原子的に保存する。
- [ ] refresh後・保存前の障害で再接続が必要になり得ることを扱い、古いtokenを無限再試行しない。
- [ ] ロック中・復号失敗・失効時はfail closedとなり、設定ファイルや別主体へfallbackしない。
- [ ] 鍵更新・再接続・暗号化backup/restoreを確認する。復旧不能な鍵紛失の条件も表示する。

## D. Agent sandbox / egress — P3から必須、P8で拡大

- [ ] 選定macOS環境で実際に試験する。Linuxのsocket mount例をそのまま成立すると仮定しない。
- [ ] 全権Docker socket、ホーム全体、ホストの秘密ディレクトリ、他Workspaceのデータをmountしない。
- [ ] 許可されたrepo mountにも.env、資格情報設定、private keyが混ざらない。symlink/path traversalも拒否する。
- [ ] agentのOS権限、capabilities、rootfs、書込先、CPU/memory/PID、同時Run数を制限する。
- [ ] agentはGatewayの実行面だけへ到達し、backend管理面・securityd管理面・他Botに接続できない。
- [ ] proxy環境変数を消してcurl/SDKで直結しても外へ出られない。
- [ ] IPv4/IPv6、DNS、UDP/QUIC、IP literal、host gateway、metadata/private IPへの迂回を試験する。
- [ ] 資格情報を付けないWeb通信もGatewayを通す。宛先hostを監査に残し、host自身（backendのportを含む）・private/loopback/link-local/metadata宛には中継しない。Slack・Google・Anthropicのhostへの要求はtunnelにしない（[ADR-0005](../adr/0005-bot-web-egress-through-gateway.md)）。
- [ ] Gateway障害時にfail openしない。再起動でegress制限が解除されない。
- [ ] 短命run capabilityはWorkspace/Bot/Runへ束縛され、期限切れ/取消後は使えない。
- [ ] sandbox内にある実行capabilityから管理capabilityを取得できない。
- [ ] `api.anthropic.com`等のモデル通信も接続先・operation・予算を限定し、任意のHTTP relayにしない。

許可されたモデルやSlackへ、許可された内容を送る経路自体は残る。鍵非露出やegress制限だけで、あらゆる意味的な情報持ち出しがなくなるとは主張しない。資格情報を付けないWebへの通信も開いているので、Botが読んだデータは任意のhostへ送れる。v1はこれを止めず、hostの監査で後から追うだけにする（ADR-0005）。

## E. Policy / Approval / Operation — P3から必須

### 推奨する決定規則

```text
invalid identity / wrong Workspace / inactive connection → deny
no matching Grant                                      → deny
explicit deny / budget exceeded / revoked               → deny
valid Grant + matching allow policy                     → allow
valid Grant + matching approval policy                  → require_approval
unknown operation / ambiguous request                   → deny
```

競合する複数ruleの優先順位を固定し、少なくともdeny優先を保つ。LLMによる文章評価を最終的な認可判定にしない。allow規則も対象resourceと操作を限定する。

### 承認で固定するもの

正規化した操作payloadのdigestに、internal Workspace、Bot、Run、Connection、credential kind、外部subject、Operation kind、catalogの版、resource、本文/宛先、失効時刻、カードに出した表示の行を含める。権限のversionはdigestに入れず、dispatch直前の再評価で扱う。許可に影響する引数を承認画面から省略しない。

- [ ] OAuth同意、Bot Grant、一回承認、SDK tool permissionを別の状態/イベントとして扱う。
- [ ] Bot自身が自分のApprovalを承認できない。「承認します」という外部メールも決裁にならない。
- [ ] UIは正本の要求からカードを描画し、LLMが作った偽の承認文面を決裁対象にしない。
- [ ] 承認後のbody、recipient、channel、calendar、subject、connection変更は拒否/再承認となる。
- [ ] 承認後にGrant取消・Connection失効・policy変更があったら実行直前に再評価する。
- [ ] 二つのタブ/workerで同じApprovalを同時消費しても一度しかclaimできない。
- [ ] 期限切れ、拒否、取消されたApprovalは再利用できない。
- [ ] UIを閉じたりbackendを再起動してもpending Approval/Operationを復元できる。
- [ ] UIのactive Workspaceが変わっても、pending OperationのWorkspaceを付け替えない。
- [ ] token注入の前に認可し、unknown hostへの注入をしない。
- [ ] UI/broker/raw HTTPのどの入口でも同じoperation policyを通る。

### 外部効果の状態機械

```text
requested → denied
          → awaiting_approval → rejected / expired / cancelled
                              → authorized
          → authorized → dispatching → succeeded
                                     → known_failed
                                     → unknown_needs_reconciliation
```

この図は提案であり実装済みではない。`authorized` は無条件に将来も許可という意味ではなく、dispatch直前に失効・変更を再確認する。

内部はcommand/eventの重複除去とtransactional outbox/inboxを使う案とする。外部APIはproviderが保証する範囲でidempotencyを利用する。メール送信などで送信完了後の応答を失った場合、こちらのDB transactionだけで外部のexactly-onceは保証できない。

- [ ] dispatch前のcrashは安全に再開できる。
- [ ] upstreamで効果が発生した直後に応答を失う試験を行う。
- [ ] 上記を「未送信」と断定して自動再送しない。照合/人の判断を必要とする状態を残す。
- [ ] operation IDによる再試行は既存結果を返し、同じ要求を再度送信しない。
- [ ] 人が編集した送信内容は新version/別要求になり、古いApprovalの再利用をしない。

## F. Slack / Google — P4–P6

- [ ] Slack Bot/UserのOAuth scope・token・subject・Grant・refreshを区別する。
- [ ] Botで失敗した操作をUserで自動再試行しない。
- [ ] SlackのOAuth requestのteam指定ではなく、検証済みresponseで実installationを特定する。
- [ ] desktop PKCEのbot scope制約を回避できると仮定しない。選定フローの実証を残す。
- [ ] Socket Modeのapp-level tokenをUser Tokenと混同せず、agentへ渡さない。
- [ ] 受信のevent dedup、ACK、reconnect、reaction loop、rate limit/retryを試験する。
- [ ] GmailとCalendarの機能Grantを分け、scope追加は人が認識できる。
- [ ] OAuth stateはinitiating actor、Workspace、provider、redirect、要求範囲に束縛し、期限付き一回限りにする。
- [ ] callback CSRF、codeの再利用、別Workspaceのstate差替え、open redirectを拒否する。
- [ ] providerに適したPKCE/client認証を使い、refresh失効/権限拒否を接続状態に反映する。
- [ ] GmailのCC/BCC/添付、Calendarのattendees/通知設定も承認・policyの対象にする。
- [ ] ローカルGrant取消とprovider token revokeの影響範囲を区別する。
- [ ] 実サービス検査に使ったApp/client設定、scope、SDK version、テスト日を記録する。秘密値は残さない。

## G. Web管理UI — P2から継続

- [ ] localhostだから無認証でよいとはしない。初回pairing/認証済みsessionを設計する。
- [ ] Origin/Host検証、CORS、CSRF、cookie属性、CSPを配置に応じて設定する。
- [ ] DNS rebindingや別originからのlocalhost管理API呼出しを拒否する。
- [ ] OAuth callback公開に必要な最小routeだけを切り出し、管理API全体を公開しない。
- [ ] メールHTML/Markdownをsanitizeし、trusted UI originで任意scriptを動かさない。
- [ ] LLM生成HTML/artifactは別originまたは権限を制限したiframeで表示し、管理APIへ届かせない。
- [ ] 個人/会社Workspace名、外部account、acting identityを承認カードに常時表示する。
- [ ] tokenをlocalStorage、analytics、URL、画面の通常の接続一覧へ保存・表示しない。
- [ ] 長時間streamの復帰時も認可を再評価し、購読者に権限のない過去イベントを返さない。

## H. 記憶・グループ・Jobs — P7

- [ ] Memory検索はWorkspace/Bot限定で行い、他Botの記憶を結合しない。記憶はaudienceを持たず、境界はBotにする（[ADR-0011](../adr/0011-memory-bounded-by-bot-without-audience.md)）。
- [ ] LLMが抽出した記憶と人が承認した記憶にprovenanceを残す。
- [ ] 外部コンテンツの命令をsystem-level設定や承認規則へ自動昇格させない。Botが書き換えたMemory indexは所有者が保存するまでSessionへ注入しない（[ADR-0015](../adr/0015-memory-index-injected-only-as-saved-by-owner.md)）。
- [ ] 他の人が読むchannel・group DMへの返信は、記憶を含むかに関わらず毎回承認を通る。記憶を出したくない場では別のBotを使う（ADR-0011）。
- [ ] 明示的な記憶編集/忘却が検索indexにすぐ反映される。開いているSessionへ注入済みのMemory indexはcompactionか次のSessionまで残り、その限界をUIに表示する（ADR-0011）。
- [ ] 削除後のバックアップ保持と、既に外部へ送った情報を回収できない限界を表示する。
- [ ] Bot template複製にtoken・記憶・会話を暗黙に含めない。
- [ ] Bot同士の無限応答をmention/turn budget/loop detection等で停止する。
- [ ] Jobのlease、同時実行、missed run、timezone、失効時の挙動を検査する。
- [ ] Job作成時の権限ではなく、実際の実行時の権限を確認する。
- [ ] UI接続の有無はJobの存続条件にしない。全体停止/個別停止が確実に機能する。

## I. HTTPS MITM — P8

- [ ] CA秘密鍵はagentに渡らず、CA trustは対象sandboxだけに設定する。
- [ ] 上流TLS certificateを検証し、無効証明書を許可しない。
- [ ] CONNECT authority、TLS SNI、HTTP Host、実際の接続先を矛盾なく検査する。
- [ ] URLの正規化、重複header、曖昧なContent-Length/Transfer-Encoding等のparser差を拒否する。
- [ ] private/loopback/link-local/metadata宛を拒否し、DNS解決後と接続時のずれを制御する。
- [ ] redirectを既定で止めるか毎hop再評価し、別originへ資格情報を持ち越さない。
- [ ] agent提供Authorization等を上流へそのまま渡さず、認可済みConnectionから注入する。
- [ ] 許可されていないConnectionをplaceholder/header/bodyで指定できない。
- [ ] JSON/form等、対応parserの差で権限制約を回避できない。未知batch/圧縮/巨大bodyはfail closed。
- [ ] providerのhostへの要求は、certificate pinningや未対応protocolで失敗しても、直結や無検査tunnelへfallbackしない。
- [ ] typed operationと対応HTTP requestのpolicy/approval結果が一致する。
- [ ] streamや長文responseのメモリ/時間制限があり、途中の秘密反射も扱う。
- [ ] raw clientの承認待ち/retryが重複外部効果を生まない。

汎用transportの対応範囲と、意味的に認可できるvendor/APIの対応範囲は別のmatrixにする。どちらかだけの成功を「全API対応」と書かない。

## J. 配布・復旧・監査 — P9

- [ ] backend、securityd、runnerを個別に強制終了して、状態の再構築を確認する。
- [ ] 開発機のPATH/node_modules/キャッシュがない環境で起動を確認する。
- [ ] macOS用binaryとLinux agent imageのarch/SDK assetsを取り違えない。
- [ ] Bun/SDK/native CLIの実際に試験したversionとartifact digestを固定する。
- [ ] migration中断・失敗時は破壊的な自動rollbackや鍵の消失を起こさない。
- [ ] domain migrationのSQL/manifestを配布物に含め、repoの相対パスや開発機のファイルに依存せず適用できる。
- [ ] DBとartifactの整合したbackupを作り、別環境へrestoreして実演する。
- [ ] Vault鍵を移せない場合の再接続手順と、回復できない状態を明確にする。
- [ ] 監査にはactor/Workspace/Bot/Connection/operation/decision/rule/version/resultを残す。
- [ ] 監査のために全メール本文や全tokenを平文で記録しない。payload保持は期限と暗号化を決める。
- [ ] ローカル監査はホスト所有者による改竄まで完全防止できるとはしない。
- [ ] live tokenを使う前のgateと、最終リリースgateで独立reviewを行う。

## K. 検証証拠のフォーマット

各spec/ticketに次の小さい表を添える。全検査ログを文書へ複製しない。

| 項目 | 状態 | 証拠/再現コマンド | 残る制約 |
|---|---|---|---|
| Workspace越境 | 未実施 / pass / fail | 実際のtest/CI参照 | 対象外経路 |
| 秘密非露出 | 未実施 / pass / fail | fixtureと検査結果 | live未検証等 |
| 再起動復旧 | 未実施 / pass / fail | 故障注入の記録 | 未対応障害 |
| 外部効果 | 未実施 / pass / fail | 模擬/liveを区別 | 結果不明の扱い |

**完了 = コードがあることではなく、約束した成功経路と拒否/障害経路の証拠があること。**
