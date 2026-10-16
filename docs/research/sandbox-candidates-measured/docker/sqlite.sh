#!/bin/sh
# Host process and container process open the same SQLite file in a bind-mounted session dir.
# usage: sqlite.sh concurrent <wal|delete> | poll <wal|delete> | kill <wal|delete> <host|container> | jsonl
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
SD=$HERE/.work/sqlite
mkdir -p "$SD"
IMG=momo-cmp-d-probe:1
C=momo-cmp-d-sqlite
crun() { docker run --rm --name "$C" --network none --user 1000:1000 -v "$SD:/s" -v "$HERE/sqlbench.py:/sqlbench.py:ro" "$IMG" python3 /sqlbench.py "$@"; }
hrun() { python3 "$HERE/sqlbench.py" "$@"; }

case "$1" in
concurrent)
  M=$2; DB=db-$M-conc.sqlite; rm -f "$SD/$DB"*
  hrun write init "$M" "$SD/$DB" 1 >/dev/null
  crun write container "$M" "/s/$DB" 3000 & CP=$!
  hrun write host "$M" "$SD/$DB" 3000 & HP=$!
  wait $CP; wait $HP
  hrun check "$SD/$DB"
  crun check "/s/$DB"
  ;;
poll)
  M=$2; DB=db-$M-poll.sqlite; rm -f "$SD/$DB"*
  hrun write init "$M" "$SD/$DB" 1 >/dev/null
  # container writes, host polls; then the reverse
  hrun poll host "$M" "$SD/$DB" 12 & P=$!
  sleep 1; crun write container "$M" "/s/$DB" 1500; wait $P
  crun poll container "$M" "/s/$DB" 12 & P=$!
  sleep 3; hrun write host "$M" "$SD/$DB" 1500; wait $P
  hrun check "$SD/$DB"
  ;;
kill)
  M=$2; WHO=$3; DB=db-$M-kill-$WHO.sqlite; rm -f "$SD/$DB"*
  hrun write init "$M" "$SD/$DB" 1 >/dev/null
  for i in 1 2 3 4 5; do
    if [ "$WHO" = container ]; then
      docker run -d --name "$C" --network none --user 1000:1000 -v "$SD:/s" -v "$HERE/sqlbench.py:/sqlbench.py:ro" "$IMG" \
        python3 /sqlbench.py loop container "$M" "/s/$DB" >/dev/null
      sleep 2; docker kill -s KILL "$C" >/dev/null; docker rm -f "$C" >/dev/null 2>&1
    else
      python3 "$HERE/sqlbench.py" loop host "$M" "$SD/$DB" >/dev/null & P=$!
      sleep 2; kill -9 $P; wait $P 2>/dev/null
    fi
    printf 'round %s host-view: ' "$i"; hrun check "$SD/$DB"
    printf 'round %s container-view: ' "$i"; crun check "/s/$DB"
  done
  ;;
jsonl)
  F=$SD/mailbox.jsonl; rm -f "$F"; touch "$F"
  hrun jsonl-read host "$F" 10 & P=$!
  sleep 1; docker run --rm --network none --user 1000:1000 -v "$SD:/s" -v "$HERE/sqlbench.py:/sqlbench.py:ro" "$IMG" \
    python3 /sqlbench.py jsonl-write container /s/mailbox.jsonl 2000; wait $P
  docker run --rm --network none --user 1000:1000 -v "$SD:/s" -v "$HERE/sqlbench.py:/sqlbench.py:ro" "$IMG" \
    python3 /sqlbench.py jsonl-read container /s/mailbox.jsonl 10 & P=$!
  sleep 3; hrun jsonl-write host "$F" 2000; wait $P
  ;;
esac
case "$1" in
oneway)
  # NanoClaw's NC-11 rules: one writer per file, reader opens read-only. $2=journal mode, $3=host open-write-close (1/0)
  M=$2; OC=${3:-1}
  IN=in-$M-$OC.sqlite; OUT=out-$M-$OC.sqlite; rm -f "$SD/$IN"* "$SD/$OUT"*
  hrun write init "$M" "$SD/$IN" 1 >/dev/null; hrun write init "$M" "$SD/$OUT" 1 >/dev/null
  echo "# inbound: host writes (openclose=$OC), container reads read-only with a held connection"
  crun oneway-read container "/s/$IN" 14 0 & P=$!
  sleep 2; hrun oneway-write host "$M" "$SD/$IN" 1500 "$OC"; wait $P
  echo "# outbound: container writes with a held connection, host reads read-only (open-read-close)"
  hrun oneway-read host "$SD/$OUT" 14 1 & P=$!
  sleep 1; crun oneway-write container "$M" "/s/$OUT" 1500 0; wait $P
  hrun check "$SD/$IN"; hrun check "$SD/$OUT"
  ;;
oneway-kill)
  # kill -9 the single writer mid-stream, then check both views. $2=journal mode, $3=host|container
  M=$2; WHO=$3; DB=k-$M-$WHO.sqlite; rm -f "$SD/$DB"*
  hrun write init "$M" "$SD/$DB" 1 >/dev/null
  for i in 1 2 3 4 5; do
    if [ "$WHO" = container ]; then
      docker run -d --name "$C" --network none --user 1000:1000 -v "$SD:/s" -v "$HERE/sqlbench.py:/sqlbench.py:ro" "$IMG" \
        python3 /sqlbench.py oneway-write container "$M" "/s/$DB" 100000 0 >/dev/null
      sleep 2; docker kill -s KILL "$C" >/dev/null; docker rm -f "$C" >/dev/null 2>&1
    else
      python3 "$HERE/sqlbench.py" oneway-write host "$M" "$SD/$DB" 100000 1 >/dev/null & P=$!
      sleep 2; kill -9 $P; wait $P 2>/dev/null
    fi
    printf 'round %s journal-left=%s container-view: ' "$i" "$(ls "$SD/$DB"-journal >/dev/null 2>&1 && echo yes || echo no)"; crun check "/s/$DB"
    printf 'round %s host-view: ' "$i"; hrun check "$SD/$DB"
  done
  ;;
esac
