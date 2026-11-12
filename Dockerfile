FROM node:22-alpine AS builder
WORKDIR /app

COPY package*.json ./
COPY server/package*.json ./server/
COPY client/package*.json ./client/

RUN npm install --include=dev \
  && npm --prefix server install --include=dev \
  && npm --prefix client install --include=dev

COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080

COPY package*.json ./
COPY server/package*.json ./server/
RUN npm --prefix server install --omit=dev

COPY --from=builder /app/server/dist ./server/dist
COPY --from=builder /app/client/dist ./client/dist

EXPOSE 8080
CMD ["node", "server/dist/index.js"]
