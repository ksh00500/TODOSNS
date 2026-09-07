FROM node:24-alpine AS deps
WORKDIR /app
COPY package*.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN npm ci

FROM deps AS build
COPY apps/web/next.config.ts apps/web/postcss.config.mjs apps/web/tsconfig.json ./apps/web/
COPY apps/web/app ./apps/web/app
COPY apps/web/components ./apps/web/components
COPY apps/web/lib ./apps/web/lib
COPY apps/web/public ./apps/web/public
COPY packages/contracts/tsconfig.json ./packages/contracts/tsconfig.json
COPY packages/contracts/src ./packages/contracts/src
ARG NEXT_PUBLIC_API_URL=/api/v1
ARG NEXT_PUBLIC_SOCKET_URL=/
ARG NEXT_PUBLIC_SITE_URL=http://localhost:3000
ARG NEXT_PUBLIC_ENABLE_DEMO=false
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_SOCKET_URL=$NEXT_PUBLIC_SOCKET_URL
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL
ENV NEXT_PUBLIC_ENABLE_DEMO=$NEXT_PUBLIC_ENABLE_DEMO
RUN npm run build -w @mungsil/contracts && npm run build -w @mungsil/web

# Keep dependency pruning after the memory-intensive Next build. On the small
# production instance BuildKit would otherwise run both stages in parallel and
# exhaust RAM + swap.
FROM build AS prod-deps
RUN npm prune --omit=dev

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/apps/web/.next ./apps/web/.next
COPY --from=prod-deps /app/apps/web/public ./apps/web/public
COPY --from=prod-deps /app/apps/web/package.json ./apps/web/package.json
COPY --from=prod-deps /app/package.json ./package.json
USER node
EXPOSE 3000
CMD ["npm", "run", "start", "-w", "@mungsil/web"]
