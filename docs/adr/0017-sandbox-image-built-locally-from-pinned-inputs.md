# sandbox の image は所有者の Mac で固定した入力から build する

sandbox の image は、所有者の Mac で repo の Dockerfile から `docker build` で作り、registry から pull しない。image の中身は momo の版が決める。base は digest、npm の依存は `bun.lock`、apt は snapshot.debian.org の日付で固定し、上げるのは repo の PR だけにする。momo の更新は、新しい image の build が成功したときだけ切り替える。

署名した image を配る形にすると、試験した artifact の digest がそのまま所有者に届く。その代わり、CI・registry・署名鍵という新しく信頼するものと保守が増える。local build では digest が機械ごとに変わるので、SECURITY-ACCEPTANCE J の「試験した version と artifact digest を固定」は、入力を固定することで代える。build の差として残るのは、apt の snapshot から取る同じ版の中身だけになる。

## Considered Options

- **momo の CI が multi-arch の image を build・署名し、所有者が digest で pull する。** install は速く、試験した digest が届く。backend と securityd を署名した .app で配ると決めたら、この形を一緒に見直す。
- **local build を既定にして、配布した image も選べるようにする（NanoClaw の hardened image）。** 経路が 2 本になり、どちらも試験が要る。
- **apt を固定せず、momo と別に image を作り直して Chromium の修正を早く取り込む。** 試験していない組み合わせが動く。Chromium が乗っ取られても、届くのは sandbox の中と Gateway だけ（ADR-0014）。

## Consequences

- image の SBOM と署名は v1 に入れない。検証は、上流の入力の digest、`bun.lock` の integrity、Debian の Release 署名に限る。
- Dockerfile の最後の LABEL に protocol version と `bun.lock` の hash を入れ、container を作る前に照合する。LABEL が無いか合わない image は使わない。
- Session の container の image が今の image と違えば、Run の開始前に作り直す。protocol version が同じでも作り直す。
- Chromium の修正は momo の更新として届く。
