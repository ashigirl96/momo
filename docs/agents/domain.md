# Domain docs

engineering skill が codebase を調べるときに、この repo の domain の文書をどう読むか。

## 調べる前に読むもの

- repo root の **`GLOSSARY.md`**。または
- repo root に **`GLOSSARY-MAP.md`** があればそれ。context ごとの `GLOSSARY.md` を指しているので、話題に関わるものをそれぞれ読む。
- **`docs/adr/`**: これから触る範囲に関わる ADR を読む。

これらの file が無くても、**何も言わずに進める**。無いことを指摘したり、先に作るよう提案したりしない。用語や判断が実際に決まったときに、`/domain-modeling` skill（`/grill-with-docs` と `/improve-codebase-architecture` から呼ばれる）が作る。

## File の構成

この repo は single-context。`apps/<app>`、`packages/<domain>`、`crates/<crate>` はコード・table・migration を誰が持つかの境界で、別々の言語を持つわけではない。そのため用語はすべて root の 1 つの `GLOSSARY.md` に置く。

```
/
├── GLOSSARY.md
├── docs/
│   ├── adr/
│   ├── agents/
│   └── planning/
├── apps/<app>/
├── packages/<domain>/
└── crates/<crate>/
```

## glossary の語彙を使う

出力で domain の概念を名指すとき（issue の title、refactor の提案、仮説、テスト名）は、`GLOSSARY.md` で定義した用語を使う。glossary が避けると明記した同義語に流れない。

必要な概念がまだ glossary に無ければ、それは合図になる。project で使わない言葉を作っているか（考え直す）、本当に抜けているか（`/domain-modeling` 向けに書き留める）のどちらか。

## ADR との矛盾を示す

出力が既存の ADR と矛盾するなら、黙って上書きせず、はっきり示す。

> _ADR-0001（domain package が Drizzle を直接使う）と矛盾するが、…のため見直す価値がある_
