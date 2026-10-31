#!/bin/sh
# Обновить игру на своём сервере (docs/SERVER.md, «Обновление игры»):
# свежий master → сборка образов → копия базы → перезапуск → проверка здоровья.
# Запуск из папки репозитория на сервере:  sh deploy/update.sh
set -eu
cd "$(dirname "$0")/.."

echo "== свежий код"
git pull --ff-only

echo "== сборка образов"
docker compose build

echo "== копия базы перед обновлением"
docker compose run --rm app backup

echo "== перезапуск"
docker compose up -d

echo "== проверка"
app="$(docker compose ps -q app)"
for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
  state="$(docker inspect --format '{{.State.Health.Status}}' "$app" 2>/dev/null || echo unknown)"
  if [ "$state" = "healthy" ]; then
    echo "приложение отвечает — обновление готово"
    # Секрет сидов войны (БЕЗ-1, docs/trust-boundary.md, 6в): проверяется внутри контейнера, значение не печатается. Нет — выкладка
    # не падает, но говорит громко: без него исход войны можно просчитать на клиенте заранее.
    if ! docker compose exec -T app sh -c 'test -n "$TRIBE_WAR_SECRET"'; then
      echo "ВНИМАНИЕ: TRIBE_WAR_SECRET не задан — сиды войны предсказуемы. Задать: docs/SERVER.md, «Переменные»"
    fi
    exit 0
  fi
  sleep 5
done
echo "приложение не ответило за минуту: docker compose logs app"
exit 1
