FROM node:18-alpine AS builder

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:18-alpine

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --production
COPY --from=builder /app/dist ./dist

EXPOSE 3010
CMD ["node", "dist/index.js"]
