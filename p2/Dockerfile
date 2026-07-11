FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
# npm install (not ci): the builder's npm resolves the fdir/picomatch
# override differently than local npm and rejects the lockfile under ci.
RUN npm install --no-audit --no-fund
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
EXPOSE 3000
CMD ["node", "server.js"]
