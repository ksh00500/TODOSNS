ARG NODE_IMAGE=node:24-alpine@sha256:e67514e5d0f6c46656005e1b693b2ec9d52e80b641307de684d4a015ba7a4eaf
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package*.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN npm ci --no-audit --no-fund && npm cache clean --force

FROM deps AS build
COPY apps/api/nest-cli.json apps/api/tsconfig.json apps/api/prisma.config.ts ./apps/api/
COPY apps/api/prisma ./apps/api/prisma
COPY apps/api/src ./apps/api/src
COPY packages/contracts/tsconfig.json ./packages/contracts/tsconfig.json
COPY packages/contracts/src ./packages/contracts/src
RUN npm run db:generate && npm run build -w @mungsil/api

# Keep dependency pruning after the memory-intensive Nest build. On the small
# production instance BuildKit would otherwise run both stages in parallel and
# exhaust RAM + swap.
FROM build AS prod-deps
RUN npm prune --omit=dev && node -e "require.resolve('nodemailer', { paths: ['/app/apps/api'] })"

FROM ${NODE_IMAGE} AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/prisma ./apps/api/prisma
COPY apps/api/scripts ./apps/api/scripts
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/apps/web/package.json ./apps/web/package.json
COPY --from=build /app/packages/contracts/package.json ./packages/contracts/package.json
COPY --from=build /app/package.json ./package.json
COPY package-lock.json ./package-lock.json
USER node
EXPOSE 4000
CMD ["node", "apps/api/scripts/start-runtime.cjs"]
