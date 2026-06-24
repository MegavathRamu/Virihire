# Build context is the repo root (see docker-compose.yml) so we can copy /proto.
FROM node:20-alpine
WORKDIR /app

COPY services/job/package.json ./
RUN npm install

COPY services/job/ ./
COPY proto/ ./proto/

EXPOSE 50053
CMD ["npm", "start"]
