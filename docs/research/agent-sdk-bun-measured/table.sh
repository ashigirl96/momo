# Prints one line per test per image with the decisive fields.
D="$(cd "$(dirname "$0")" && pwd)"
for img in bun-slim bun-alpine node22 node24; do
  R="$D/results/$img"
  echo "=== $img $(head -1 $R/basic-apikey/out.jsonl | jq -c '{runtime,glibcVersionRuntime}')"
  echo "  exe: $(grep -o '"exe":"[^"]*claude"' $R/basic-apikey/out.jsonl | head -1)"
  for t in $(ls $R); do
    res=$(grep -o '"end":"[a-z]*"' $R/$t/out.jsonl | tail -1)
    r=$(jq -r 'select(.msg.type=="result")|"\(.msg.subtype)|\(.msg.result // "" | .[0:40])"' $R/$t/out.jsonl 2>/dev/null | tail -1 | tr '\n' ' ')
    extra=$(jq -r 'select(.generatorEndedAfterAbortMs or .generatorEndedAfterCloseMs or .sameSession!=null or .interruptReturned)|tostring' $R/$t/out.jsonl 2>/dev/null | sed 's/"dt":[0-9]*,"t":[0-9]*,//' | tr '\n' ' ')
    z=$(grep -o '"afterAbortMs":[0-9]*,"procs":\[[^]]*\]\|"afterCloseMs":[0-9]*,"procs":\[[^]]*\]' $R/$t/out.jsonl | tail -1 | grep -o '"state":"[A-Z]"' | sort | uniq -c | tr -s ' \n' ' ')
    dns=$(jq -r .name $R/$t/dns.jsonl 2>/dev/null | sort -u | tr '\n' ',')
    nreq=$(wc -l < $R/$t/requests.jsonl | tr -d ' ')
    printf '  %-16s %-10s %-50s req=%s dns=%s %s %s\n' "$t" "$res" "$r" "$nreq" "$dns" "$extra" "${z:+lastprocs:$z}"
  done
done
