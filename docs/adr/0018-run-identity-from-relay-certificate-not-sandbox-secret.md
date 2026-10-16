# Run の identity を sandbox の秘密にせず、中継の証明書と Run の登録で決める

sandbox の中には、Gateway に対して使える秘密を 1 つも置かない。Session の中継の container が、Session ごとの client 証明書で Gateway に mTLS でつなぐ。securityd はその証明書で Session を知る。中継は、Gateway の server 証明書を momo の CA に pin して確かめる。どの Run が動いているかは、backend が管理 IPC で Run の開始と終了を securityd に登録する。登録には lease を付け、backend が更新をやめたら終わったものとみなす。生きた Run の無い Session からの要求は、Gateway が 403 `permission_error` で拒否する。sandbox の `CLAUDE_CODE_OAUTH_TOKEN` は固定のダミー値で、agent が読んでも外へ持ち出しても使えない。

Session の container・network・中継を起こすのは backend とする。証明書は Session の作成時に securityd が発行し、backend は中継の container にだけ mount する。Run が終わったら、runner が init と自分以外の sandbox の process をすべて止める。これで、前の Run で起動した常駐 process が次の Run の identity で Gateway に出ることを防ぐ。

## Considered Options

- Run ごとの capability を securityd が発行し、mailbox で runner に渡して、placeholder・`HTTPS_PROXY` の userinfo・MCP の header に載せる形（OneCLI の per-agent token を短命にした形）。agent は Run の間ずっと capability を読めて、Web の tunnel から外へ持ち出せる。他の Session の sandbox も、それぞれの中継を通って使える。そのため Session の束縛が別に要る。また、同じ uid の常駐 process は新しい CLI の `/proc/<pid>/environ` を読めるので、token の寿命では Run の境界を守れない。
- securityd が container を起こす形。Docker API と image の build が、鍵を持つ process に入る。
- Run ごとに container を作り直す形。約 0.5 秒で作れるが、runner を常駐させて 30 分 idle で止める形（ADR-0009）を覆す。

## Consequences

- ROADMAP 3.3 の「agent に実行 capability を渡す」書き方からは外れる。SECURITY-ACCEPTANCE D の「Workspace/Bot/Run に束縛され、取消後は使えない」と「実行 capability から管理 capability を取得できない」は、Run の登録と中継の証明書で満たす。
- Mac 上のほかの Docker container や process は、client 証明書が無いので Gateway の port に届いても通らない。Gateway の停止中に port を取られても、中継の pin で切れる。
- 中継は socat の素の TCP ではなく、TLS の client として動く。
- Run の帰属は、1 つの Session で同時に動く Run が 1 つまでであることに依存する。
- Gateway の port は 1 つで、model proxy・型付き操作・CONNECT を method と path で振り分ける。
