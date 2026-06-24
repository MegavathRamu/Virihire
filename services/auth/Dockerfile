# Build context is the repo root (see docker-compose.yml) so we can copy /proto.
FROM node:20-alpine
WORKDIR /app

COPY services/auth/package.json ./
RUN npm install

COPY services/auth/ ./
COPY proto/ ./proto/

EXPOSE 50051
CMD ["npm", "start"]
