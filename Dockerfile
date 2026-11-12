FROM node:22-bookworm-slim

WORKDIR /app

COPY server/package.json server/package-lock.json ./server/
COPY web/package.json web/package-lock.json ./web/
RUN npm ci --prefix server && npm ci --prefix web

COPY server ./server
COPY web ./web
RUN npm run build --prefix web

ENV NODE_ENV=production
ENV BILLING_DATA_DIR=/data
RUN mkdir -p /data

EXPOSE 8080
CMD ["npm", "start", "--prefix", "server"]
