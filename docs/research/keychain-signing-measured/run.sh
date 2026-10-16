#!/bin/sh
# usage: run.sh <keychain> <label>
S="$(cd "$(dirname "$0")" && pwd)"; KC="$1"; L="$2"
dump() {
  security dump-keychain -a "$KC" 2>/dev/null | awk -v acct="\"acct\"<blob>=\"$1\"" '/^keychain:/{if(hit)print buf; buf=""; hit=0} {buf=buf"\n"$0} index($0,acct){hit=1} END{if(hit)print buf}' | grep -E "authorizations|applications|requirement|partition|description: [a-z]+:|^\s+0: " | sed "s#$S#<S>#"
}
for mode in adhoc selfsigned; do
  echo "=== $L / $mode"
  export PROBE_ACCOUNT="$mode-$L"
  sh "$S/build.sh" v1 "$S/$L-$mode/bin/securityd"
  [ $mode = selfsigned ] && sh "$S/sign.sh" "$S/$L-$mode/bin/securityd" >/dev/null 2>&1
  "$S/$L-$mode/bin/securityd" add "$KC" --no-ui | tail -1
  dump "$PROBE_ACCOUNT"
  "$S/$L-$mode/bin/securityd" read "$KC" --no-ui | tail -1 | sed 's/^/v1 same binary: /'
  sh "$S/build.sh" v2 "$S/$L-$mode/bin/securityd"
  [ $mode = selfsigned ] && sh "$S/sign.sh" "$S/$L-$mode/bin/securityd" >/dev/null 2>&1
  "$S/$L-$mode/bin/securityd" read "$KC" --no-ui | tail -1 | sed 's/^/v2 rebuilt same path: /'
  sh "$S/build.sh" imposter "$S/$L-$mode/other/imposter"
  [ $mode = selfsigned ] && sh "$S/sign.sh" "$S/$L-$mode/other/imposter" >/dev/null 2>&1
  "$S/$L-$mode/other/imposter" read "$KC" --no-ui | tail -1 | sed 's/^/imposter other path: /'
done
