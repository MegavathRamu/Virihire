# Build context is the repo root (see docker-compose.yml) so we can copy /proto.
FROM node:20-alpine
WORKDIR /app

COPY services/profile/package.json ./
RUN npm install

COPY services/profile/ ./
COPY proto/ ./proto/

EXPOSE 50052
CMD ["npm", "start"]
