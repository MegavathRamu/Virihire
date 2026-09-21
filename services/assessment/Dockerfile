# Build context is the repo root (see docker-compose.yml) so we can copy /proto.
FROM node:20-alpine
WORKDIR /app

COPY services/assessment/package.json ./
RUN npm install

COPY services/assessment/ ./
COPY proto/ ./proto/

EXPOSE 50059
CMD ["npm", "start"]
