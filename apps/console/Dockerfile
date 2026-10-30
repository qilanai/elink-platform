FROM oven/bun:1.4.2 AS build
WORKDIR /workspace
COPY package.json bun.lock ./
COPY packages/contracts ./packages/contracts
COPY apps/console ./apps/console
RUN bun install --frozen-lockfile && bun run build

FROM nginx:1.27-alpine
COPY apps/console/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /workspace/apps/console/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --retries=5 CMD wget -qO- http://127.0.0.1:8080/ >/dev/null || exit 1
