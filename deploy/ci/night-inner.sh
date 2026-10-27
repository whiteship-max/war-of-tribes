#!/bin/bash
# Ночная приёмка, часть в контейнере (УС-2, docs/handbook/acceptance.md, «Ночная приёмка на сервере»). Запускает её
# `night.sh` в рабочем дереве проверяемого коммита: пакеты, пол (типы, тесты, сборка) и все отчёты против базы этой машины.
# Шаги идут по одному; упавший шаг пола не останавливает следующие — весть должна назвать всё красное за одну ночь,
# — кроме сборки: без неё отчётам мерить нечего.
#   night-inner.sh <база — коммит с обычными правилами> <папка ночи> [--before]
# Без `--before` — закладка базы (`night.sh --seed`): база — сам коммит, и вывода «до» нет.
set -u
base=$1
dir=$2
before=${3:-}
step() {
  local name=$1
  shift
  local t0
  t0=$(date +%s)
  echo "$name" > "$dir/status"
  "$@" > "$dir/$name.log" 2>&1
  local code=$?
  printf '%s\t%s\t%s\t%s\n' "$name" "$code" "$(($(date +%s) - t0))" "$(date -u +%H:%M:%S)" >> "$dir/summary.tsv"
  return $code
}
step ci npm ci --no-audit --no-fund || { echo stop > "$dir/status"; exit 1; }
step typecheck npm run typecheck
step test npm test
step build npm run build || { echo stop > "$dir/status"; exit 0; }
step reports npm run reports -- --all --base "$base" $before
echo done > "$dir/status"
