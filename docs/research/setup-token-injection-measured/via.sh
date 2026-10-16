# Runs one query through the swap proxy with the OAuth placeholder. Extra args go to docker run.
D="$(cd "$(dirname "$0")" && pwd)"; cd "$D"
PH=sk-ant-oat01-momoPLACEHOLDER0000000000000000000000000000000000000000000000000000000000000000000000-AAAAAA
BASE=http://172.30.31.3:8080 S="${S:-via}" sh run.sh "${MODE:-basic:MARKER_VIA}" -e "${ENV:-CLAUDE_CODE_OAUTH_TOKEN}=$PH" -e CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 "$@"
