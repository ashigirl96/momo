# Starts a sandbox like via.sh, dumps env, argv of all procs and mounts from inside, and greps them for the real token.
D="$(cd "$(dirname "$0")" && pwd)"; cd "$D"
PH=sk-ant-oat01-momoPLACEHOLDER0000000000000000000000000000000000000000000000000000000000000000000000-AAAAAA
docker run --rm --network sdk31net --user 1000:1000 --read-only -v "$D/st/liveA/cfg":/cfg:ro \
  -e CLAUDE_CODE_OAUTH_TOKEN=$PH -e ANTHROPIC_BASE_URL=http://172.30.31.3:8080 --entrypoint sh sdk31:bun-slim \
  -c 'env; cat /proc/*/cmdline 2>/dev/null | tr "\0" " "; cat /proc/mounts; grep -rl . /cfg 2>/dev/null' > "$D/sandbox-dump.txt"
printf 'dump lines: '; wc -l < "$D/sandbox-dump.txt"
printf 'token hits in dump: '; grep -cF -f "$D/real-token" "$D/sandbox-dump.txt"
printf 'placeholder hits in dump: '; grep -c momoPLACEHOLDER "$D/sandbox-dump.txt"
