# 外部接続の Installation と Provider app を 1 つの Workspace に限る

provider 側で一緒に失効する同意の単位を Installation と呼ぶ。Slack では App と Slack team の組、Google では Cloud project とアカウントの組がこれに当たる。Installation と、OAuth 用の App や client（Provider app）は、どちらも 1 つの Workspace にだけ属する。別の Workspace から同じ Installation を接続しようとしたら拒否し、重複は provider 側の id で判定する。Connection は Installation のもとで Credential kind を 1 つだけ持つので、Slack の 1 回の install で Bot と User の token が返ったら Connection は 2 つになる。

こう決めたのは、内部で Connection を分けても provider 側では分かれないためである。Slack では、同じ App を同じ team にもう一度 OAuth しても installation は 1 つのままで、scope が足されるだけで減らせない。Google では、revoke がアカウントと Cloud project の組の全 token に及ぶ。どちらでも、片方の Workspace での操作がもう片方の権限を広げるか、接続を壊す。

## Considered Options

- 重複を許して警告だけ出す。OneCLI 1.42.0 は、project が違えば同じアカウントを別の record にする。この形では provider 側の共有が残るので採らない。
- Provider app を所有者全体に置き、各 Workspace から参照する。登録は 1 回で済むが、会社の Slack App を個人の Workspace から install する取り違えを、model の上で防げない。
- Connection を Slack の installation 単位にし、Bot と User の資格情報を並べる。この形では Grant の値を 1 つ変えるだけで Bot から User へ切り替わるので採らない。

## Consequences

- 同じアカウントを 2 つの Workspace で使うには、Workspace ごとに Cloud project か Slack App を分ける必要がある。
- provider 側で同じ App や client を 2 つの Workspace で使うときは、Workspace ごとに Provider app として登録し、秘密を 2 か所に持つ。
- rotation の無い Slack App で Bot token を revoke すると installation ごと消えることがあるので、Bot と User の Connection は provider 側では完全には独立しない。この影響は UI で示す。
