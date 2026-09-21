FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY server.js ./
COPY src ./src
COPY public ./public

ENV PORT=3000
ENV DATA_DIR=/app/data
ENV TCGDEX_LANG=fr

EXPOSE 3000

CMD ["node", "server.js"]
