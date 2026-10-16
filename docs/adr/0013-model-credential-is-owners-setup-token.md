# Model credential を所有者の setup-token に限る

Model credential は、所有者が自分の Mac で `claude setup-token` を実行して作った OAuth token だけにする。所有者はそれを momo の画面に貼り、securityd が Vault に置いて、sandbox から来るモデル通信に注入する。sandbox には placeholder しか置かない。Console の API key と cloud provider（Bedrock・Vertex・Foundry）は受け付けない。

こう決めたのは、所有者が Bot を自分の Claude plan の利用上限の中で動かしたいからである。plan で使う Agent SDK は従量課金ではなく subscription の上限を消費する。規約上の可否ははっきりしないまま残る。Claude Code の legal ページは、developer が Claude.ai の資格情報や session token を "collect, store, or intermediate" することを禁じている。2026-11-12 に発効する AUP は、"services that route requests through consumer subscriptions" を proxy の例に挙げている。momo は所有者が自分のためだけに動かす app で、login は Anthropic の流れ（`claude setup-token`）で済ませ、momo は login を扱わない。それでも、文面が当てはまると読まれれば、所有者のアカウントが止められる。所有者はこのリスクを承知で選んだ。

## Considered Options

- Console の API key。docs が secrets manager と proxy からの注入を例に挙げており、規約上は明確に許される。commercial terms なので送った内容は学習に使われず、Console の workspace ごとに spend limit を付けられる。ただし、plan の上限ではなく従量課金になる。
- setup-token を既定にし、API key を 2 つ目の種類として受け付ける。規約の解釈が厳しくなったときに、momo を直さずに切り替えられる。v1 では作らない。

## Consequences

- 送った内容を学習に使うかどうかは、所有者の Claude アカウントの設定に従う。会社用 Workspace の内容も同じである。momo は NanoClaw と同じく、この設定を表示も確認もしない。
- momo は token の予算を持たない。モデル通信の予算は plan の 5 時間と週の上限で限る。上限は、所有者が手で使う Claude と Claude Code と共有になる。
- setup-token は 1 年で切れ、refresh できない。同じアカウントを複数の Workspace に登録するときは、token を Workspace ごとに別に発行する。
- 規約が明確に禁じた場合は、API key を受け付ける種類を足すことで戻す。
