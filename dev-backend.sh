#!/usr/bin/env bash
# Starts the 4 backend services locally (no Docker) against a single local
# MongoDB on :27017. Each service uses its own database name.
# Usage:  ./dev-backend.sh         (start)
#         ./dev-backend.sh stop    (stop them)
set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"
LOGS="$ROOT/.devlogs"
mkdir -p "$LOGS"

if [ "$1" = "stop" ]; then
  pkill -f "tsx src/index.ts" 2>/dev/null
  pkill -f ".venv/bin/python server.py" 2>/dev/null
  echo "stopped backend services"
  exit 0
fi

# Fail early if Mongo isn't up.
if ! nc -z localhost 27017 2>/dev/null; then
  echo "ERROR: MongoDB is not running on localhost:27017."
  echo "Start it with:  brew services start mongodb-community"
  exit 1
fi

start() { # name port extra-env...
  local name=$1 port=$2; shift 2
  echo "starting $name on :$port  (logs: .devlogs/$name.log)"
  ( cd "$ROOT/services/$name" && env PORT=$port "$@" npm start >"$LOGS/$name.log" 2>&1 & )
}

start auth    50051 MONGO_URL=mongodb://localhost:27017/authdb    JWT_SECRET=dev-secret
start job      50053 MONGO_URL=mongodb://localhost:27017/jobdb
start referral 50058 MONGO_URL=mongodb://localhost:27017/referraldb AUTH_SERVICE_URL=localhost:50051 EMAIL_PROVIDER="${EMAIL_PROVIDER:-sandbox}" EMAIL_FROM="${EMAIL_FROM:-onboarding@resend.dev}" RESEND_API_KEY="${RESEND_API_KEY:-}"
start assessment 50059 MONGO_URL=mongodb://localhost:27017/assessmentdb EMAIL_PROVIDER="${EMAIL_PROVIDER:-sandbox}" EMAIL_FROM="${EMAIL_FROM:-onboarding@resend.dev}" RESEND_API_KEY="${RESEND_API_KEY:-}" APP_URL="${APP_URL:-http://localhost:3000}"
start profile 50052 MONGO_URL=mongodb://localhost:27017/profiledb JOB_SERVICE_URL=localhost:50053
start gateway 8080  AUTH_SERVICE_URL=localhost:50051 PROFILE_SERVICE_URL=localhost:50052 JOB_SERVICE_URL=localhost:50053 SEARCH_SERVICE_URL=localhost:50054 CAMPAIGN_SERVICE_URL=localhost:50055 NOTIFY_SERVICE_URL=localhost:50056 VERIFY_SERVICE_URL=localhost:50057 REFERRAL_SERVICE_URL=localhost:50058 ASSESSMENT_SERVICE_URL=localhost:50059

# Python search service (uses its own venv). Optional — skipped if not set up.
if [ -x "$ROOT/services/search/.venv/bin/python" ]; then
  echo "starting search on :50054  (logs: .devlogs/search.log)"
  ( cd "$ROOT/services/search" && env PORT=50054 PROFILE_SERVICE_URL=localhost:50052 \
      .venv/bin/python server.py >"$LOGS/search.log" 2>&1 & )
else
  echo "skipping search service (no venv). To enable:"
  echo "  cd services/search && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt && ./gen_proto.sh"
fi

# Python campaign service (uses its own venv). Optional — skipped if not set up.
if [ -x "$ROOT/services/campaign/.venv/bin/python" ]; then
  echo "starting campaign on :50055  (logs: .devlogs/campaign.log)"
  ( cd "$ROOT/services/campaign" && env PORT=50055 AUTH_SERVICE_URL=localhost:50051 \
      MONGO_URL=mongodb://localhost:27017/campaigndb \
      EMAIL_PROVIDER="${EMAIL_PROVIDER:-sandbox}" EMAIL_FROM="${EMAIL_FROM:-onboarding@resend.dev}" \
      RESEND_API_KEY="${RESEND_API_KEY:-}" SENDGRID_API_KEY="${SENDGRID_API_KEY:-}" ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-}" \
      .venv/bin/python server.py >"$LOGS/campaign.log" 2>&1 & )
else
  echo "skipping campaign service (no venv). To enable:"
  echo "  cd services/campaign && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt && ./gen_proto.sh"
fi

# Python verify engine (uses its own venv). Optional — skipped if not set up.
if [ -x "$ROOT/services/verify/.venv/bin/python" ]; then
  echo "starting verify on :50057  (logs: .devlogs/verify.log)"
  ( cd "$ROOT/services/verify" && env PORT=50057 \
      MONGO_URL=mongodb://localhost:27017/verifydb \
      .venv/bin/python server.py >"$LOGS/verify.log" 2>&1 & )
else
  echo "skipping verify engine (no venv). To enable:"
  echo "  cd services/verify && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt && ./gen_proto.sh"
fi

# Python notification service (uses its own venv). Optional — skipped if not set up.
if [ -x "$ROOT/services/notify/.venv/bin/python" ]; then
  echo "starting notify on :50056  (logs: .devlogs/notify.log)"
  ( cd "$ROOT/services/notify" && env PORT=50056 \
      PROFILE_SERVICE_URL=localhost:50052 AUTH_SERVICE_URL=localhost:50051 JOB_SERVICE_URL=localhost:50053 \
      MONGO_URL=mongodb://localhost:27017/notifydb SMS_PROVIDER="${SMS_PROVIDER:-sandbox}" \
      EMAIL_PROVIDER="${EMAIL_PROVIDER:-sandbox}" EMAIL_FROM="${EMAIL_FROM:-onboarding@resend.dev}" RESEND_API_KEY="${RESEND_API_KEY:-}" \
      RECOMMEND_INTERVAL_SECONDS="${RECOMMEND_INTERVAL_SECONDS:-600}" \
      .venv/bin/python server.py >"$LOGS/notify.log" 2>&1 & )
else
  echo "skipping notify service (no venv). To enable:"
  echo "  cd services/notify && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt && ./gen_proto.sh"
fi

sleep 4
echo ""
echo "Gateway health:"
curl -s localhost:8080/health && echo "" || echo "(gateway not ready yet — check .devlogs/gateway.log)"
echo ""
echo "Backend up. Frontend: cd frontend && npm run dev  ->  http://localhost:3000"
echo "Stop everything with: ./dev-backend.sh stop"
