FROM node:24-alpine

RUN apk add --no-cache bash postgresql17-client
WORKDIR /workspace

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN npm ci

COPY apps/api/nest-cli.json apps/api/tsconfig.json apps/api/prisma.config.ts apps/api/
COPY apps/api/prisma apps/api/prisma
COPY apps/api/src apps/api/src
COPY apps/api/tests apps/api/tests
COPY packages/contracts/tsconfig.json packages/contracts/tsconfig.json
COPY packages/contracts/src packages/contracts/src
COPY infra/database infra/database
COPY infra/verification/data-governance infra/verification/data-governance

RUN npm run db:generate && npm run build -w @mungsil/api

ENTRYPOINT ["/bin/bash"]
