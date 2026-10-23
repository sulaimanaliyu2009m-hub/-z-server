# Build Stage
FROM node:20-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Production Runner Stage
FROM node:20-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

# Install FFmpeg for video processing
RUN apk add --no-cache ffmpeg

COPY package*.json ./
RUN npm ci --only=production

COPY --from=builder /app/dist ./dist

EXPOSE 5000

CMD ["node", "dist/index.js"]
