FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-workspace.yaml tsconfig.base.json pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY prototype/package.json prototype/package.json
RUN pnpm install --frozen-lockfile
COPY apps apps
COPY packages packages
COPY seed seed
RUN pnpm --filter @airic-forge/domain build && pnpm --filter @airic-forge/api build

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/apps/api/dist /app/apps/api/dist
COPY --from=build /app/seed /app/seed
EXPOSE 4175
CMD ["node", "apps/api/dist/server.js"]
