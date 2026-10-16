#!/bin/sh
# NanoClaw-style mailboxes: inbound.db written only by the host, outbound.db only by the guest.
# Each reader opens a fresh read-only connection per poll.
# usage: mailbox.sh <container> <host_dir> <guest_dir>
set -u
C=$1; H=$2; G=$3
HP=/usr/bin/python3
T=$(cd "$(dirname "$0")" && pwd)/sqlite_test.py
container cp "$T" "$C:/sqlite_test.py" >/dev/null
for mode in delete wal; do
  echo "## mode=$mode"
  rm -f "$H"/in-$mode.db* "$H"/out-$mode.db* "$H"/g-*.json
  $HP "$T" init "$H/in-$mode.db" "$mode" >/dev/null
  container exec "$C" python3 /sqlite_test.py init "$G/out-$mode.db" "$mode" >/dev/null
  echo "# host writes inbound, guest polls with reopen"
  container exec -d "$C" sh -c "python3 /sqlite_test.py pollre $G/in-$mode.db 8 guest > $G/g-pollre.json"
  sleep 1
  $HP "$T" append "$H/in-$mode.db" "$mode" 50 host 0.1
  sleep 3
  echo "guest: $(cat "$H/g-pollre.json")"
  echo "# guest writes outbound, host polls with reopen"
  $HP "$T" pollre "$H/out-$mode.db" 8 host &
  hp=$!
  sleep 1
  container exec "$C" python3 /sqlite_test.py append "$G/out-$mode.db" "$mode" 50 guest 0.1
  wait $hp
  echo "# kill -9 the guest writer mid-append, then reopen"
  container exec -d "$C" sh -c "exec python3 /sqlite_test.py append $G/out-$mode.db $mode 100000 guestkill 0"
  sleep 3
  container exec "$C" sh -c 'pkill -9 -f guestkill; echo killed rc=$?'
  $HP "$T" check "$H/out-$mode.db"
  container exec "$C" python3 /sqlite_test.py append "$G/out-$mode.db" "$mode" 5 guest-after 0
  $HP "$T" check "$H/out-$mode.db"
  echo "# kill -9 the host writer mid-append, then reopen"
  $HP "$T" append "$H/in-$mode.db" "$mode" 100000 hostkill 0 >/dev/null &
  hp=$!
  sleep 3; kill -9 $hp; wait $hp 2>/dev/null
  container exec "$C" python3 /sqlite_test.py check "$G/in-$mode.db"
  $HP "$T" append "$H/in-$mode.db" "$mode" 5 host-after 0
  $HP "$T" check "$H/in-$mode.db"
done
