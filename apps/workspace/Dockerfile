FROM oven/bun:1.4.2 AS build
WORKDIR /workspace
COPY package.json bun.lock ./
COPY apps/console/package.json apps/console/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY apps/workspace/package.json apps/workspace/package.json
RUN bun install --frozen-lockfile
COPY apps/workspace apps/workspace
RUN bun run build:chat
FROM nginx:1.28-alpine
COPY apps/workspace/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /workspace/apps/workspace/dist /usr/share/nginx/html/apps/workspace
EXPOSE 8080
