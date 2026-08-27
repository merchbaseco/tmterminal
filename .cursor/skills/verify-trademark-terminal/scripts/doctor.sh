#!/usr/bin/env bash
# Read-only: is this Trademark Terminal instance worth driving?
set -euo pipefail

api_origin="${TMTERMINAL_API_ORIGIN:-http://127.0.0.1:3000}"
web_origin="${TMTERMINAL_WEB_ORIGIN:-http://127.0.0.1:5173}"
scratch="$(mktemp -d /tmp/tmterminal-doctor.XXXXXX)"
failed=0

ok() { printf 'ok    %s\n' "$1"; }
bad() { printf 'fail  %s\n' "$1" >&2; failed=1; }

local_pg=no
if command -v ss >/dev/null && ss -ltn | grep -q ':5437 '; then
  local_pg=yes
fi

ticket_file="${scratch}/ticket.json"
ticket_code="$(curl -sS -o "${ticket_file}" -w '%{http_code}' --max-time 5 -X POST "${api_origin}/api/dev/clerk-sign-in-token" || true)"

venue=workstation
if [[ "${ticket_code}" == "200" && "${local_pg}" == "yes" ]]; then
  venue=cloud
elif [[ "${ticket_code}" == "200" ]]; then
  venue=workstation-dev
fi

printf 'venue=%s\n' "${venue}"
printf 'api=%s\n' "${api_origin}"
printf 'web=%s\n' "${web_origin}"

health="$(curl -sS --max-time 5 "${api_origin}/api/health" || true)"
if [[ "${health}" == '{"status":"ready"}' ]]; then
  ok "api health ready"
else
  bad "api health: ${health:-unreachable}"
fi

web_code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 "${web_origin}/" || true)"
if [[ "${web_code}" == "200" ]]; then
  ok "website ${web_origin}/"
else
  bad "website HTTP ${web_code:-unreachable}"
fi

status_code="$(curl -sS -o "${scratch}/status.json" -w '%{http_code}' --max-time 5 "${api_origin}/api/status" || true)"
if [[ "${status_code}" == "200" ]]; then
  ok "anonymous /api/status"
else
  bad "anonymous /api/status HTTP ${status_code:-unreachable}"
fi

if [[ "${venue}" == "cloud" ]]; then
  if [[ "${ticket_code}" == "200" ]] && grep -q '"ticket"' "${ticket_file}"; then
    ok "dev clerk ticket (auto-sign-in path)"
  else
    bad "dev clerk ticket HTTP ${ticket_code:-unreachable} (cloud session should mint one)"
  fi
fi

rm -rf "${scratch}"
exit "${failed}"
