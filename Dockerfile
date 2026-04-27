FROM node:24-alpine AS builder

WORKDIR /app

COPY package.json ./
RUN npm install

COPY . .
RUN npm run build

FROM node:24-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY --from=builder /app/dist ./dist

RUN mkdir -p public/uploads

ENV NODE_ENV=production

EXPOSE 3500

CMD ["node", "dist/src/server.js"]
