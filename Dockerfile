FROM node:24-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

RUN mkdir -p public/uploads

ENV NODE_ENV=production

EXPOSE 3500

CMD ["node", "index.js"]