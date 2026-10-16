# momo

Workspace 分離型のパーソナル Bot platform。一人の所有者が、個人用・会社用のように分けた Workspace ごとに Bot と外部接続を持つ。

## Language

### 所有と会話

**Workspace**:
所有者が個人用・会社 A 用のように分ける、Bot・会話・記憶・外部接続の所有と権限の境界。中のものは作られた Workspace に属し続ける。
_Avoid_: tenant, org, project, Slack workspace

**Slack team**:
Slack 側の workspace。momo の Workspace とは別のもの。
_Avoid_: Slack workspace

**Bot**:
1 つの Workspace に属する永続的な人格。指示・tool 設定・記憶を持ち、別の Workspace へは移らない。
_Avoid_: agent, agent group, persona

**Conversation**:
人と、同じ Workspace の 1 体以上の Bot が発言を交わす場。公開の発言は、参加している Bot すべてが読める。
_Avoid_: chat, room, group, thread

**主担当 Bot**:
Conversation に 1 体だけいて、mention の無い人の発言に応える Bot。Slack の channel と group DM に結んだ Conversation では、mention と、自分が返信している thread への返信にだけ応える。外部の channel から動かせるのは主担当 Bot だけ。
_Avoid_: default bot, owner bot

**Session**:
1 つの Conversation で 1 体の Bot が途切れずに続ける、1 本のモデルの文脈。reset や Bot の指示の変更で閉じ、新しい Session に替わる。会話履歴と tool の結果はこの中に閉じる。
_Avoid_: thread, chat session

**Login**:
所有者のブラウザが momo の UI を操作できる、認証済みの状態。Bot の Session とは別のもの。
_Avoid_: session, web session

**Run**:
ある Session の中で 1 体の Bot が行う 1 回の実行。それを起こした主体（所有者、Channel binding 経由の外部の人、Job）を持つ。
_Avoid_: turn, invocation, job

**Sandbox**:
1 つの Session の Bot が tool やコードを実行する、隔離された環境。Session ごとに 1 つあり、外へは Gateway にしか届かない。Run の外から来た要求は Gateway が受け付けない。
_Avoid_: container, VM, runner

**Job**:
所有者が保存した、決めた時刻や周期に 1 つの Conversation で 1 体の Bot の Run を起こす予定。Bot は案を出せるが、Job を作るのは所有者だけ。
_Avoid_: schedule, task, cron

**Attachment**:
Conversation の公開の発言に付いたファイル。その Conversation に参加している Bot すべてが読める。Bot が作業中に作ったファイルは、返答に付けるまで Attachment ではない。
_Avoid_: file, upload

**Channel binding**:
外部の channel（Slack team と channel の組）を 1 つの Conversation に結びつける設定。外部の channel と Conversation は 1 対 1 で、全 Workspace を通して重ならない。channel の中の thread も、その channel の Conversation に入る。
_Avoid_: channel link, subscription

**Memory item**:
Bot が Conversation をまたいで持ち越す長期の記憶の 1 件。1 体の Bot に属し、別の Conversation へ知識が渡る唯一の経路になる。その Bot が参加するどの Conversation でも同じものを引ける。
_Avoid_: note, knowledge

**Memory index**:
自分の Memory item への地図になる 1 件の Memory item。Bot は書き換えの案を出せるが、Session の始めに Bot へ渡るのは所有者が保存した版だけ。ほかの Memory item は Bot が探して引く。
_Avoid_: core memory, MEMORY.md

### 外部接続

**Provider app**:
外部 provider に登録した OAuth 用の App や client（Slack App、Google の OAuth client）。client secret などの秘密を持ち、1 つの Workspace に属する。
_Avoid_: OAuth client, integration

**Installation**:
外部 provider 側で一緒に失効する同意の単位。Slack では App と Slack team（または Enterprise org）の組、Google では Cloud project とアカウントの組。1 つの Workspace にだけ属する。
_Avoid_: authorization, consent, app install

**Connection**:
Installation のもとで、外部 service を 1 つの主体として操作するための接続。Credential kind を 1 つだけ持つ。
_Avoid_: account, integration, credential

**Credential kind**:
Connection が外部 service を誰として操作するか。Slack Bot、Slack User、Google のユーザーなど。
_Avoid_: token type

**Grant**:
Bot が、ある Connection のどの Operation kind をどの対象に使えるかの許可。その Bot が参加するすべての Conversation で効く。Connection があっても Grant が無ければ使えない。
_Avoid_: permission, scope

**ConnectionRequest**:
Run の中で Bot が人に出す「この provider のこの操作を使いたい」という要求。人は同じ Workspace の Connection を選ぶか新しく接続して応え、Grant はそれとは別に与える。
_Avoid_: auth request, connection prompt

**Model credential**:
Bot がモデルとの通信に使う、所有者の Claude plan に結びついた資格情報。Workspace に属し、その Workspace の Bot すべてが使う。
_Avoid_: API key

### 操作と承認

**Operation**:
Run の中で Bot が 1 つの Connection を使って外部 service に出す、1 回の要求。読み取りも書き込みも含み、モデルとの通信と資格情報を付けない Web への通信は含まない。作った後は内容が変わらず、内容を変えれば別の Operation になる。
_Avoid_: request, action, tool call

**Operation kind**:
momo が定める外部操作の種類。Slack への投稿やメールの送信がこれに当たる。Grant と承認の要否は、宛先の host や URL ではなくこれに対して決まる。
_Avoid_: endpoint, API, host

**Approval**:
所有者が 1 つの Operation に下す、一回限りの許可。その Operation の内容に固定され、期限があり、1 回しか使えない。承認待ちは Approval ではなく、Operation の状態のこと。
_Avoid_: consent, authorization, permission
