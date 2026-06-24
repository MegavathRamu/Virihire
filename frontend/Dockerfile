FROM node:20-alpine
WORKDIR /app

# NEXT_PUBLIC_* is baked at build time; the browser calls the gateway on the host.
ARG NEXT_PUBLIC_API_URL=http://localhost:8080
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

COPY package.json ./
RUN npm install

COPY . ./
RUN npm run build

EXPOSE 3000
CMD ["npm", "start"]
