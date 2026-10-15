# Triage labels

skill は 5 つの canonical な triage role で話す。この file は、その role と、この repo の tracker で実際に使う label 文字列を対応づける。

| mattpocock/skills の label | この tracker の label | 意味                                       |
| -------------------------- | --------------------- | ------------------------------------------ |
| `needs-triage`             | `needs-triage`        | maintainer がこの issue を評価する必要がある |
| `needs-info`               | `needs-info`          | 報告者からの追加情報を待っている           |
| `ready-for-agent`          | `ready-for-agent`     | 仕様が固まり、AFK の agent に任せられる    |
| `ready-for-human`          | `ready-for-human`     | 人が実装する必要がある                     |
| `wontfix`                  | `wontfix`             | 対応しない                                 |

skill が role に触れたら（例:「AFK-ready の triage label を付ける」）、この表で対応する label 文字列を使う。

実際に使う語彙に合わせるときは、「この tracker の label」の列を書き換える。
