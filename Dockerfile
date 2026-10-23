FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-workspace.yaml tsconfig.base.json pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/workbench/package.json apps/workbench/package.json
COPY packages/domain/package.json packages/domain/package.json
RUN pnpm install --frozen-lockfile
COPY apps apps
COPY packages packages
RUN pnpm --filter @airic-forge/domain build && pnpm --filter @airic-forge/api build && pnpm --filter @airic-forge/workbench build

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates poppler-utils \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/apps/api/node_modules /app/apps/api/node_modules
COPY --from=build /app/packages/domain/dist /app/packages/domain/dist
COPY --from=build /app/packages/domain/package.json /app/packages/domain/package.json
COPY --from=build /app/apps/api/dist /app/apps/api/dist
COPY --from=build /app/apps/api/skills /app/apps/api/skills
COPY --from=build /app/apps/api/agent /app/apps/api/agent
COPY --from=build /app/apps/api/package.json /app/apps/api/package.json
COPY --from=build /app/apps/workbench/public /app/apps/workbench/public
EXPOSE 4175
CMD ["node", "apps/api/dist/server.js"]
