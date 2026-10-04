# Игра на своём сервере — два образа из одного исходника: приложение (адреса API и хранилище) и
# Caddy со статикой игры. Собирает их docker compose (docker-compose.yml); пошагово — docs/SERVER.md.

# --- Сборка. Клиент — той же командой, что у Netlify (`npm run build`, CLAUDE.md, «Выкладка»),
# сервер — одним файлом (netlify/vps/build.mjs). Node 22 — тот же, что у сборки Netlify (netlify.toml).
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build && node netlify/vps/build.mjs /app/out/server.mjs

# --- Статика и HTTPS: Caddy отдаёт собранную игру и проводит четыре адреса API к приложению.
FROM caddy:2 AS web
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv

# --- Приложение: один файл и Node, без node_modules. SQLite встроен в Node (node:sqlite, с 22.13).
FROM node:22-bookworm-slim AS app
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/out/server.mjs ./server.mjs
# Папка данных принадлежит пользователю node: именованный том при первом подключении берёт её
# хозяина, и сервер пишет базу и копии не от root.
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8080/api/time').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
ENTRYPOINT ["node", "--disable-warning=ExperimentalWarning", "server.mjs"]
CMD ["serve"]
