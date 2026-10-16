# Agent SDK と CLI を両方 sandbox の中で動かす

Claude Agent SDK と、SDK が子 process として起動する Claude Code CLI は、どちらも sandbox の中の agent-runner で動かす。backend に置くのは、runner と受け渡す momo 自身の message の解釈だけにする。

こう決めたのは、SDK を backend に置いて CLI だけを `spawnClaudeCodeProcess` で sandbox に入れても、境界が強くならないからである。組み込み tool の有効・無効、hook を発火させるかどうか、`canUseTool` を呼ぶかどうか、MCP の timeout は、どれも CLI が判定する。乗っ取られた CLI は callback を呼ばずに済ませられる。一方で backend は、SDK と CLI の間の control protocol を parse することになる。この protocol は双方を信頼する前提で作られ、schema の検証が無い。`sessionStore.append` の key には、CLI が送った path が使われる。SDK と CLI を両方 sandbox に入れれば、sandbox から信頼側へ届くものを、momo が定めて検証する狭い message だけにできる。NanoClaw も同じ配置をとる。

## Considered Options

- SDK を backend に置き、CLI だけを sandbox で動かす。権限の callback と in-process の MCP handler は sandbox の外で動く。ただし、呼ぶかどうかを CLI が決めるので、境界にはならない。spawner に渡す env の既定値は host の `process.env` 全体で、`sessionStore` からの resume は host の認証情報を temp dir に複製する。公式の deployment の例は、どれも SDK を境界の内側に置いている。

## Consequences

- SDK の権限設定と組み込み tool の禁止は、使い勝手のための補助で、境界ではない。境界は sandbox と Gateway が持つ。
- 型付き操作は、runner の中の tool が Gateway に出す。backend が Bot の代わりに外部へ出すことはない。
- runner は sandbox の image に入る。runtime と配布単位は、Linux container の中で SDK と CLI を動かす前提で選ぶ。
