FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
RUN npm ci --workspace backend --ignore-scripts --no-audit --no-fund
COPY backend/prisma backend/prisma
COPY backend/tsconfig.json backend/tsconfig.json
COPY backend/src backend/src
WORKDIR /app/backend
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build DIRECT_URL=postgresql://build:build@localhost:5432/build npm run prisma:generate
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /app/backend
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production PORT=3000
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/backend/dist dist
COPY --from=build /app/backend/prisma prisma
EXPOSE 3000
CMD ["sh", "-c", "../node_modules/.bin/prisma migrate deploy --schema prisma/schema.prisma && node dist/main.js"]
