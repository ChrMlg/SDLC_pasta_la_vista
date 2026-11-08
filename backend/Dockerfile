FROM node:22-bookworm-slim AS build
WORKDIR /app/backend

# Prisma's native engine needs OpenSSL in the build and runtime images.
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
COPY backend/package.json ./
RUN npm install --no-audit --no-fund
COPY backend/prisma prisma
COPY backend/tsconfig.json tsconfig.json
COPY backend/src src
# Generation needs a syntactically valid URL for schema validation, but does not
# connect to PostgreSQL. Compose supplies the real URL when the container starts.
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build npm run prisma:generate
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /app/backend
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production PORT=3000
COPY --from=build /app/backend/node_modules node_modules
COPY --from=build /app/backend/dist dist
COPY --from=build /app/backend/prisma prisma
EXPOSE 3000
CMD ["sh", "-c", "./node_modules/.bin/prisma migrate deploy --schema prisma/schema.prisma && node dist/main.js"]
