#!/bin/sh
# Memory, CPU, PID limits and zombie reaping inside a running container.
# usage: limits.sh <container>
set -u
C=$1
x() { container exec "$C" "$@"; }
xu() { container exec -u 1000 "$C" "$@"; }
echo "# cgroup values"
x sh -c 'echo cpu.max=$(cat /sys/fs/cgroup/cpu.max) memory.max=$(cat /sys/fs/cgroup/memory.max) pids.max=$(cat /sys/fs/cgroup/pids.max) nproc=$(nproc)'
echo "# memory: allocate 900 MiB as uid 1000"
xu python3 -c '
b=[]
try:
    for i in range(90):
        b.append(bytearray(10*1024*1024))
    print("allocated", len(b)*10, "MiB")
except MemoryError:
    print("MemoryError at", len(b)*10, "MiB")
'; echo "rc=$?"
x sh -c 'grep -E "^(oom|oom_kill) " /sys/fs/cgroup/memory.events'
echo "# cpu: 4 busy loops for 5 s"
x sh -c 'a=$(awk "/usage_usec/{print \$2}" /sys/fs/cgroup/cpu.stat); for i in 1 2 3 4; do timeout 5 sh -c "while :; do :; done" & done; wait; b=$(awk "/usage_usec/{print \$2}" /sys/fs/cgroup/cpu.stat); echo "cpu seconds used in 5 s wall: $(( (b-a)/1000000 ))"'
echo "# pids: root writes pids.max=64, then uid 1000 forks 200 sleepers"
x sh -c 'echo 64 > /sys/fs/cgroup/pids.max && echo pids.max=$(cat /sys/fs/cgroup/pids.max)'
xu sh -c 'n=0; for i in $(seq 1 200); do sleep 30 & [ $? -eq 0 ] && n=$((n+1)); done 2>/dev/null; echo started=$n running=$(ls /proc | grep -cE "^[0-9]+$")'
x sh -c 'echo pids.current=$(cat /sys/fs/cgroup/pids.current); grep max /sys/fs/cgroup/pids.events'
echo "# uid 1000 tries to lift pids.max"
xu sh -c 'echo max > /sys/fs/cgroup/pids.max' 2>&1; echo "rc=$?"
x sh -c 'pkill -f "^sleep 30" 2>/dev/null; sleep 1; echo max > /sys/fs/cgroup/pids.max; echo pids.max=$(cat /sys/fs/cgroup/pids.max)'
echo "# ulimit nproc=32 for uid 1000"
container exec --ulimit nproc=32:32 -u 1000 "$C" sh -c 'n=0; for i in $(seq 1 100); do sleep 30 & [ $? -eq 0 ] && n=$((n+1)); done 2>/dev/null; echo started=$n; ulimit -u' 2>&1 | tail -2
x sh -c 'pkill -f "^sleep 30" 2>/dev/null; true'
echo "# zombie: an orphan exits after being reparented"
x sh -c 'sh -c "sleep 1 & exit 0"; sleep 3; echo PID1=$(cat /proc/1/comm); for p in /proc/[0-9]*; do s=$(awk "{print \$3}" $p/stat 2>/dev/null); [ "$s" = Z ] && echo zombie $(basename $p) ppid=$(awk "{print \$4}" $p/stat) $(cat $p/comm); done; echo done'
