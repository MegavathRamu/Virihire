# Build context is the repo root (see docker-compose.yml) so we can copy /proto.
FROM node:20-alpine
WORKDIR /app

COPY services/referral/package.json ./
RUN npm install

COPY services/referral/ ./
COPY proto/ ./proto/

EXPOSE 50058
CMD ["npm", "start"]
