# Образ приёмки на сервере (УС-2, docs/handbook/acceptance.md, «Ночная приёмка на сервере»): Node из `.nvmrc` и Chromium
# для браузерных отчётов — без видеокарты, WebGL программный (SwiftShader, флаги — `chromium.sh`). Ключей и `.env` игры в
# образе нет и не будет: контейнер получает только папку `/opt/tribe-ci`.
#   docker build -t tribe-ci -f deploy/ci/Dockerfile deploy/ci
FROM node:22-bookworm
RUN apt-get update \
 && apt-get install -y --no-install-recommends chromium fonts-dejavu-core fonts-liberation \
 && rm -rf /var/lib/apt/lists/*
