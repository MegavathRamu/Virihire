# Build context is the repo root (see docker-compose.yml) so we can copy /proto.
FROM python:3.11-slim
WORKDIR /app

# EasyOCR needs a couple of system libs for opencv/Pillow.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libglib2.0-0 libgl1 && rm -rf /var/lib/apt/lists/*

COPY services/verify/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY services/verify/ ./
COPY proto/ ./proto/

RUN mkdir -p gen && python -m grpc_tools.protoc \
      -I proto --python_out=gen --grpc_python_out=gen proto/verify.proto

EXPOSE 50057
CMD ["python", "server.py"]
