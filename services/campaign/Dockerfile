# Build context is the repo root (see docker-compose.yml) so we can copy /proto.
FROM python:3.11-slim
WORKDIR /app

COPY services/campaign/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY services/campaign/ ./
COPY proto/ ./proto/

RUN mkdir -p gen && python -m grpc_tools.protoc \
      -I proto --python_out=gen --grpc_python_out=gen \
      proto/campaign.proto proto/auth.proto

EXPOSE 50055
CMD ["python", "server.py"]
