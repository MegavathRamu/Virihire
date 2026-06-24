# Build context is the repo root (see docker-compose.yml) so we can copy /proto.
FROM node:20-alpine
WORKDIR /app

COPY services/gateway/package.json ./
RUN npm install

COPY services/gateway/ ./
COPY proto/ ./proto/

EXPOSE 8080
CMD ["npm", "start"]
