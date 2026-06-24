# Build context is the repo root (see docker-compose.yml) so we can copy /proto.
FROM python:3.11-slim
WORKDIR /app

COPY services/search/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY services/search/ ./
COPY proto/ ./proto/

# Generate gRPC stubs into ./gen
RUN mkdir -p gen && python -m grpc_tools.protoc \
      -I proto --python_out=gen --grpc_python_out=gen \
      proto/search.proto proto/profile.proto

EXPOSE 50054
CMD ["python", "server.py"]
