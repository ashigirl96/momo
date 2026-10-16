#!/bin/sh
# Host and guest open the same SQLite file in a shared Session dir at the same time.
# usage: sqlite.sh <container> <host_dir> <guest_dir>
# The guest copy of sqlite_test.py is pushed with `container cp` so the image need not be rebuilt.
set -u
C=$1
H=$2
G=$3
HP=/usr/bin/python3
T=$(cd "$(dirname "$0")" && pwd)/sqlite_test.py
container cp "$T" "$C:/sqlite_test.py" >/dev/null
gx() { container exec "$C" python3 /sqlite_test.py "$@"; }
gd() { container exec -d "$C" python3 /sqlite_test.py "$@" >/dev/null; }

for mode in delete wal; do
  echo "## mode=$mode"
  rm -f "$H"/t-$mode.db* "$H"/g-*.json
  $HP "$T" init "$H/t-$mode.db" "$mode"
  gx check "$G/t-$mode.db"

  echo "# concurrent read-modify-write for 6 s on both sides; counter must equal the sum"
  gd incrfor "$G/t-$mode.db" "$mode" 6 guest "$G/g-incr.json"
  sleep 0.5
  $HP "$T" incrfor "$H/t-$mode.db" "$mode" 5 host
  sleep 2
  echo "guest: $(cat "$H/g-incr.json")"
  $HP "$T" check "$H/t-$mode.db"
  gx check "$G/t-$mode.db"

  echo "# host appends, guest polls"
  container exec -d "$C" sh -c "python3 /sqlite_test.py poll $G/t-$mode.db $mode 8 guest > $G/g-poll.json"
  sleep 1
  $HP "$T" append "$H/t-$mode.db" "$mode" 50 host 0.1
  sleep 3
  echo "guest: $(cat "$H/g-poll.json")"

  echo "# guest appends, host polls"
  $HP "$T" poll "$H/t-$mode.db" "$mode" 8 host &
  hp=$!
  sleep 1
  gx append "$G/t-$mode.db" "$mode" 50 guest 0.1
  wait $hp
  $HP "$T" check "$H/t-$mode.db"

  echo "# kill -9 the guest writer mid-run, then both sides reopen and write"
  container exec -d "$C" sh -c "exec python3 /sqlite_test.py incrfor $G/t-$mode.db $mode 60 guestkill"
  sleep 3
  container exec "$C" sh -c 'pkill -9 -f guestkill; echo killed rc=$?'
  $HP "$T" check "$H/t-$mode.db"
  gx check "$G/t-$mode.db"
  $HP "$T" incrfor "$H/t-$mode.db" "$mode" 1 host-after
  gx incrfor "$G/t-$mode.db" "$mode" 1 guest-after

  echo "# kill -9 the host writer mid-run"
  $HP "$T" incrfor "$H/t-$mode.db" "$mode" 60 hostkill >/dev/null &
  hp=$!
  sleep 3
  kill -9 $hp
  wait $hp 2>/dev/null
  gx check "$G/t-$mode.db"
  $HP "$T" check "$H/t-$mode.db"
  gx incrfor "$G/t-$mode.db" "$mode" 1 guest-after
  ls -la "$H" | grep "t-$mode"
done

echo "## jsonl"
rm -f "$H/t.jsonl"
container exec -d "$C" sh -c "python3 /sqlite_test.py jsonl-poll $G/t.jsonl 8 guest > $G/g-jpoll.json"
sleep 1
$HP "$T" jsonl-append "$H/t.jsonl" 50 host 0.1
sleep 3
echo "guest: $(cat "$H/g-jpoll.json")"
$HP "$T" jsonl-poll "$H/t.jsonl" 8 host &
hp=$!
sleep 1
gx jsonl-append "$G/t.jsonl" 50 guest 0.1
wait $hp
echo "# both sides append at once, then kill -9 the guest"
container exec -d "$C" sh -c "exec python3 /sqlite_test.py jsonl-append $G/t.jsonl 100000 guestkill 0.001"
$HP "$T" jsonl-append "$H/t.jsonl" 2000 hostcc 0.001
container exec "$C" sh -c 'pkill -9 -f guestkill; echo killed rc=$?'
$HP "$T" jsonl-check "$H/t.jsonl"
gx jsonl-check "$G/t.jsonl"
