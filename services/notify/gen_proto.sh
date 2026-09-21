#!/usr/bin/env bash
# Generate Python gRPC stubs for the notify service into ./gen
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$DIR/../.." && pwd)"
mkdir -p "$DIR/gen"
python3 -m grpc_tools.protoc \
  -I "$ROOT/proto" \
  --python_out="$DIR/gen" \
  --grpc_python_out="$DIR/gen" \
  "$ROOT/proto/notify.proto" "$ROOT/proto/profile.proto" "$ROOT/proto/auth.proto" "$ROOT/proto/job.proto"
echo "generated stubs in $DIR/gen"
