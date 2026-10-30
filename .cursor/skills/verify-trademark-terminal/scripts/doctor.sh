#!/usr/bin/env bash
# Read-only: is this Trademark Terminal instance worth driving?
set -euo pipefail

api_origin="${TMTERMINAL_API_ORIGIN:-http://127.0.0.1:3000}"
web_origin="${TMTERMINAL_WEB_ORIGIN:-http://127.0.0.1:5173}"
scratch="$(mktemp -d /tmp/tmterminal-doctor.XXXXXX)"
failed=0

ok() { printf 'ok    %s\n' "$1"; }
bad() { printf 'fail  %s\n' "$1" >&2; failed=1; }

session_code="$(curl -sS -o "${scratch}/session.json" -w '%{http_code}' --max-time 5 "${api_origin}/api/session" || true)"
venue=cloudflare
if [[ "${session_code}" == "200" ]]; then
  venue=local-development
fi

printf 'venue=%s\n' "${venue}"
printf 'api=%s\n' "${api_origin}"
printf 'web=%s\n' "${web_origin}"

health="$(curl -sS --max-time 5 "${api_origin}/health/live" || true)"
if [[ "${health}" == '{"status":"ok","revision":"dev"}' ]]; then
  ok "api liveness ok"
else
  bad "api liveness: ${health:-unreachable}"
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

if [[ "${venue}" == "local-development" ]]; then
  if grep -q '"authenticated":true' "${scratch}/session.json"; then
    ok "development session bootstrap"
  else
    bad "development session bootstrap malformed"
  fi
fi

trash "${scratch}"
exit "${failed}"
