#!/bin/sh
# Ночная приёмка на сервере (УС-2, docs/handbook/acceptance.md, «Ночная приёмка на сервере»).
#
#   night.sh                 по расписанию: свежий master из origin — пол и все отчёты против базы этой машины, весть в бот;
#                            только если master изменился и не чаще раза в сутки
#   night.sh --force         то же сейчас, даже если master не менялся
#   night.sh --seed <rev>    заложить базу машины: пол и все отчёты на <rev>, сравнивать не с чем
#   night.sh --accept <rev>  принять прогнанный коммит базой руками (после разбора сдвигов)
#   night.sh --install [rev] поставить ночные скрипты из <rev> (по умолчанию origin/master) в bin, образ и расписание
#
# Хозяин — пользователь tribe на хосте, не root. Тяжёлое идёт в контейнере tribe-ci (квота ядер, nice, без ключей: в него
# монтируется только /opt/tribe-ci). Токен бота и ADMIN_IDS читает только этот скрипт на хосте — из ~/tribe/.env, в момент
# отправки. Кнопок у вести нет, и игру этот скрипт не выкладывает.
set -u
CI=/opt/tribe-ci
N=$CI/night
BIN=$N/bin
R=$CI/repo
WT=$N/wt
URL=https://game.kingsvassals.com/api/time
CPUS=6        # ядер контейнеру, пока отклик боевого в норме (решение владельца 26.10.2026)
CPUS_LOW=4    # если отклик уже до старта выше SLOW
CPUS_MIN=2
SLOW=0.25     # с: три замера подряд выше — минус два ядра на ходу (норма 0.04–0.09 с)
FILES='deploy/ci/night.sh deploy/ci/night-inner.sh deploy/ci/chromium.sh deploy/ci/normal-rules.patch deploy/ci/Dockerfile scripts/ci/night-message.mjs'
mkdir -p "$N" "$BIN" "$CI/logs/night"

log() { echo "$(date -u '+%F %T') $*" >> "$N/night.log"; }

if [ "${1:-}" = "--install" ]; then
  ref=${2:-origin/master}
  git -C "$R" fetch -q origin || exit 1
  for f in $FILES; do git -C "$R" show "$ref:$f" > "$BIN/$(basename "$f")" || exit 1; done
  chmod +x "$BIN"/*.sh
  docker build -q -t tribe-ci - < "$BIN/Dockerfile" > /dev/null || exit 1
  line="30 1 * * * sh $BIN/night.sh >> $N/cron.out 2>&1"
  { crontab -l 2>/dev/null | grep -v "$BIN/night.sh"; echo "$line"; } | crontab -
  log "поставлено из $ref ($(git -C "$R" rev-parse --short "$ref"))"
  echo "поставлено из $ref; расписание: $line"
  exit 0
fi

if [ "${1:-}" = "--accept" ]; then
  sha=$(git -C "$R" rev-parse "${2:?какой коммит}^{commit}") || exit 1
  head=$(git -C "$R" rev-parse -q --verify "refs/ci/rules/$sha") || { echo "коммит $sha ночью не гнался — принимать нечего"; exit 1; }
  git -C "$R" update-ref refs/ci/accepted "$head"
  printf '%s\t%s\tруками\n' "$sha" "$(date -u +%F)" >> "$N/accepted.tsv"
  log "принят руками: $sha"
  echo "база машины — $sha"
  exit 0
fi

mode=night
rev=origin/master
case "${1:-}" in
  --force) mode=force ;;
  --seed) mode=seed; rev=${2:?какой коммит} ;;
  '') ;;
  *) echo "не знаю ключа $1"; exit 2 ;;
esac

exec 9> "$N/lock"
flock -n 9 || { log "ночь уже идёт"; exit 0; }

# Весть владельцу: первый из ADMIN_IDS, токен бота игры. Без разметки и без кнопок.
send() {
  envf=$HOME/tribe/.env
  token=$(sed -n 's/^TELEGRAM_BOT_TOKEN=//p' "$envf" | tr -d "\"'\r")
  chat=$(sed -n 's/^ADMIN_IDS=//p' "$envf" | tr -d "\"'\r" | tr ',; ' '\n\n\n' | grep -m1 .)
  if [ -z "$token" ] || [ -z "$chat" ]; then log "нет токена или ADMIN_IDS — весть не ушла"; return; fi
  printf 'url = "https://api.telegram.org/bot%s/sendMessage"\n' "$token" |
    curl -s --max-time 30 -K - --data-urlencode "chat_id=$chat" --data-urlencode "text@$1" -o "$dir/send.json"
  if jq -e .ok "$dir/send.json" > /dev/null 2>&1; then log "весть ушла"; else log "весть не ушла: $(jq -r .description "$dir/send.json" 2>/dev/null)"; fi
}

git -C "$R" fetch -q origin || { log "fetch не прошёл"; exit 1; }
master=$(git -C "$R" rev-parse "$rev^{commit}") || exit 1
if [ "$mode" = night ]; then
  [ "$master" = "$(cat "$N/last-checked" 2>/dev/null)" ] && { log "master $master не менялся"; exit 0; }
  last=$(stat -c %Y "$N/last-run" 2>/dev/null || echo 0)
  [ $(($(date +%s) - last)) -lt 72000 ] && { log "сутки с прошлой ночи не прошли"; exit 0; }
fi
if docker ps -a --format '{{.Names}}' | grep -qx tribe-ci; then log "контейнер tribe-ci занят — ночь пропущена"; exit 0; fi
if [ "$mode" != seed ] && ! git -C "$R" rev-parse -q --verify refs/ci/accepted > /dev/null; then log "базы машины нет — сначала --seed"; exit 1; fi
# Контейнера нет — значит, замок машины в его HOME брошен прерванным прогоном.
rm -f "$CI/home/.heavy-job.lock"
touch "$N/last-run"

stamp=$(date -u +%Y-%m-%d-%H%M)
dir=$CI/logs/night/$stamp
mkdir -p "$dir"
git -C "$R" worktree remove --force "$WT" 2> /dev/null
rm -rf "$WT"
git -C "$R" worktree prune
git -C "$R" worktree add -q --detach "$WT" "$master" || { log "worktree не встал"; exit 1; }

# Обычные правила: пока в master временные множители теста (×3 пути, войско не ест), приёмка с ними недействительна —
# патч ставит 1 локальным коммитом, который никуда не пушится. Множители уже 1 — патч не нужен.
if git -C "$WT" apply --check "$BIN/normal-rules.patch" 2> /dev/null; then
  git -C "$WT" apply "$BIN/normal-rules.patch"
  git -C "$WT" -c user.name=tribe-ci -c user.email=ci@localhost commit -q -am "Обычные правила — только приёмка на сервере (не пушится)"
  rules=патч
elif grep -q '^export const TEST_TRAVEL_SPEED = 1;' "$WT/src/world/data/tuning.ts" && grep -q 'TEST_ARMY_FOOD: number = 1;' "$WT/src/game/constants.ts"; then
  rules=master
else
  printf 'Ночная приёмка TRIBE: master %s — не шла: патч обычных правил не лёг, а множители теста не 1.\nЛог: %s\n' "$(echo "$master" | cut -c1-7)" "$dir" > "$dir/message.txt"
  send "$dir/message.txt"
  echo "$master" > "$N/last-checked"
  exit 1
fi
head=$(git -C "$WT" rev-parse HEAD)
git -C "$R" update-ref "refs/ci/rules/$master" "$head"

if [ "$mode" = seed ]; then
  base=$head
  base_master=$master
  before=
else
  base=$(git -C "$R" rev-parse refs/ci/accepted)
  base_master=$(tail -1 "$N/accepted.tsv" | cut -f1)
  before=--before
fi

pulse() {
  p=$(curl -s -o /dev/null -w '%{time_total}' --max-time 10 "$URL") || p=10
  echo "$p"
}
over() { awk -v t="$1" -v s="$SLOW" 'BEGIN { exit !(t > s) }'; }
cpus=$CPUS
over "$(pulse)" && cpus=$CPUS_LOW
{
  echo "master=$master"
  echo "base=$base_master"
  echo "mode=$mode"
  echo "rules=$rules"
  echo "started=$(date +%s)"
} > "$dir/meta"
log "ночь $stamp: $mode, master $master, база $base_master, ядер $cpus"

docker run -d --name tribe-ci --init --cpus="$cpus" --memory=10g --memory-swap=10g --cpu-shares=256 --shm-size=1g \
  --user "$(id -u):$(id -g)" -e HOME="$CI/home" -e CHROME="$BIN/chromium.sh" -v "$CI:$CI" -w "$WT" \
  tribe-ci nice -n 19 bash "$BIN/night-inner.sh" "$base" "$dir" $before > /dev/null || { log "контейнер не встал"; exit 1; }

# Отклик боевого раз в минуту, пока идёт работа; растёт — меньше ядер на ходу.
slow=0
while [ "$(docker inspect -f '{{.State.Running}}' tribe-ci 2> /dev/null)" = true ]; do
  t=$(pulse)
  printf '%s\t%s\t%s\n' "$(date -u +%T)" "$t" "$cpus" >> "$dir/pulse.tsv"
  if over "$t"; then slow=$((slow + 1)); else slow=0; fi
  if [ "$slow" -ge 3 ] && [ "$cpus" -gt "$CPUS_MIN" ]; then
    cpus=$((cpus - 2))
    docker update --cpus="$cpus" tribe-ci > /dev/null
    log "отклик $t с — ядер $cpus"
    slow=0
  fi
  sleep 60
done
docker wait tribe-ci > /dev/null 2>&1
docker rm tribe-ci > /dev/null 2>&1
echo "ended=$(date +%s)" >> "$dir/meta"

docker run --rm --user "$(id -u):$(id -g)" -v "$CI:$CI" tribe-ci node "$BIN/night-message.mjs" "$dir" > /dev/null 2> "$dir/message.err"
[ -s "$dir/message.txt" ] || printf 'Ночная приёмка TRIBE: master %s — весть не собралась, см. лог.\nЛог: %s\n' "$(echo "$master" | cut -c1-7)" "$dir" > "$dir/message.txt"
if [ "$(cat "$dir/verdict" 2> /dev/null)" = "принят" ]; then
  git -C "$R" update-ref refs/ci/accepted "$head"
  printf '%s\t%s\t%s\n' "$master" "$(date -u +%F)" "$mode" >> "$N/accepted.tsv"
  log "принят: $master"
fi
send "$dir/message.txt"
echo "$master" > "$N/last-checked"
