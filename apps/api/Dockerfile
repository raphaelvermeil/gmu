# Build from the repository root: docker build -f apps/api/Dockerfile .
FROM node:24.22.3-slim
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json apps/api/
COPY apps/app/package.json apps/app/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --prod --filter @gear/api...
COPY packages/shared/src packages/shared/src
COPY apps/api/src apps/api/src
WORKDIR /repo/apps/api
ENV NODE_ENV=production PORT=8080
USER node
EXPOSE 8080
# Node 24 runs the TypeScript sources directly; there is no build step.
CMD ["node", "src/server.ts"]
