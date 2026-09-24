#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
SERVER_DIR="$ROOT_DIR/server"
BIN="$RUNNER_TEMP/notepad-server-smoke"
DATA_DIR="$RUNNER_TEMP/notepad-smoke-data"
PORT="$NOTEPAD_SMOKE_PORT"
if [ -z "$PORT" ]; then PORT=27129; fi
BASE="http://127.0.0.1:$PORT"

mkdir -p "$DATA_DIR"

(
  cd "$SERVER_DIR"
  CGO_ENABLED=0 go build -o "$BIN" ./cmd/notepad-server
)

NOTEPAD_DATA="$DATA_DIR" PORT="$PORT" "$BIN" >"$RUNNER_TEMP/notepad-smoke.log" 2>&1 &
SERVER_PID=$!

cleanup() {
  if kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

for _ in $(seq 1 80); do
  if curl --connect-timeout 1 --max-time 3 -fsS "$BASE/api/health" >/dev/null 2>&1; then
    break
  fi
  sleep 0.1
done

curl --connect-timeout 1 --max-time 3 -fsS "$BASE/api/health" | python3 -c '
import json, sys
body=json.load(sys.stdin)
assert body["code"] == 0, body
'

CREATE_RESPONSE="$(
  curl --connect-timeout 1 --max-time 3 -fsS     -H 'Origin: null'     -H 'Content-Type: application/json'     -d '{"title":"Smoke Note.md","content":"smoke body","is_folder":false,"parent_id":""}'     "$BASE/api/files"
)"

FILE_ID="$(
  printf '%s' "$CREATE_RESPONSE" | python3 -c '
import json, sys
body=json.load(sys.stdin)
assert body["code"] == 0, body
print(body["data"]["id"])
'
)"

curl --connect-timeout 1 --max-time 3 -fsS   -H 'Origin: null'   "$BASE/api/files?page=1&size=200&compact=1" |
python3 -c '
import json, sys
body=json.load(sys.stdin)
assert body["code"] == 0, body
items=body["data"]
assert any(item["title"] == "Smoke Note.md" for item in items), items
assert all(item.get("content", "") == "" for item in items), items
'

curl --connect-timeout 1 --max-time 3 -fsS   -X PUT   -H 'Origin: null'   -H 'Content-Type: application/json'   -d '{"content":"updated smoke body"}'   "$BASE/api/files/$FILE_ID" |
python3 -c '
import json, sys
body=json.load(sys.stdin)
assert body["code"] == 0, body
assert body["data"]["content"] == "updated smoke body", body
'

curl --connect-timeout 1 --max-time 3 -fsS   -H 'Origin: null'   "$BASE/api/files/$FILE_ID" |
python3 -c '
import json, sys
body=json.load(sys.stdin)
assert body["code"] == 0, body
assert body["data"]["title"] == "Smoke Note.md", body
assert body["data"]["content"] == "updated smoke body", body
'

curl --connect-timeout 1 --max-time 3 -fsS -X DELETE -H 'Origin: null' "$BASE/api/files/$FILE_ID" |
python3 -c '
import json, sys
body=json.load(sys.stdin)
assert body["code"] == 0, body
'

TRASH_RESPONSE="$(
  curl --connect-timeout 1 --max-time 3 -fsS -H 'Origin: null' "$BASE/api/files/trash"
)"
FILE_ID_FOR_PY="$FILE_ID" printf '%s' "$TRASH_RESPONSE" | FILE_ID_FOR_PY="$FILE_ID" python3 -c '
import json, os, sys
body=json.load(sys.stdin)
assert body["code"] == 0, body
items=body["data"]
assert len(items) == 1, items
assert items[0]["id"] == os.environ["FILE_ID_FOR_PY"], items
assert items[0].get("content", "") == "", items
'

curl --connect-timeout 1 --max-time 3 -fsS -X POST -H 'Origin: null' "$BASE/api/files/$FILE_ID/restore" |
python3 -c '
import json, sys
body=json.load(sys.stdin)
assert body["code"] == 0, body
'

curl --connect-timeout 1 --max-time 3 -fsS -X DELETE -H 'Origin: null' "$BASE/api/files/$FILE_ID" >/dev/null

curl --connect-timeout 1 --max-time 3 -fsS -X DELETE -H 'Origin: null' "$BASE/api/files/$FILE_ID/permanent" |
python3 -c '
import json, sys
body=json.load(sys.stdin)
assert body["code"] == 0, body
'

curl --connect-timeout 1 --max-time 3 -fsS -H 'Origin: null' "$BASE/api/files/trash" |
python3 -c '
import json, sys
body=json.load(sys.stdin)
assert body["code"] == 0, body
assert body["data"] == [], body
'

curl --connect-timeout 1 --max-time 3 -fsS -H 'Origin: null' "$BASE/api/diagnostics" |
python3 -c '
import json, sys
body=json.load(sys.stdin)
assert body["code"] == 0, body
data=body["data"]
assert data["integrity"] == "ok", data
assert data["status"] == "ok", data
assert data["foreign_keys"] is True, data
assert data["busy_timeout"] == 5000, data
assert data["database_path"], data
assert data["data_dir"], data
assert data["backup_dir"], data
assert data["upload_dir"], data
'

CORS_HEADERS="$(
  curl --connect-timeout 1 --max-time 3 -sS -D - -o /dev/null     -H 'Origin: null'     "$BASE/api/health"
)"
printf '%s' "$CORS_HEADERS" | grep -qi '^Access-Control-Allow-Origin: null'

python3 "$ROOT_DIR/.github/scripts/global-search-smoke.py" "$BASE"

echo "Backend HTTP smoke passed for $FILE_ID"
