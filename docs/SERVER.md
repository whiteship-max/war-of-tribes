# Свой сервер: пошагово

Как поднять игру на своём сервере (VPS в Германии, Ubuntu 24.04, Docker) и переключить на него
бота — для владельца, команда за командой. Почему устроено так и что проверено — в
[server-move.md](server-move.md).

**Что получится.** На сервере работают два контейнера: **app** — серверная часть игры (те же
адреса `/api/save`, `/api/castles`, `/api/notify`, `/api/time`, `/api/war`, та же логика, что на Netlify) с
базой SQLite на диске, и **web** — Caddy: отдаёт саму игру, сам получает и продлевает сертификат
HTTPS для вашего домена и передаёт запросы API приложению. Наружу открыты только 80 и 443.
Каждую ночь база копируется, четырнадцать последних копий хранятся.

**Netlify при этом работает как работал**, пока вы не переключите бота (шаг 14). Откат —
переключить обратно (шаг 15).

Команды ниже вводятся в окне терминала. Строка `ssh …` — на вашем компьютере (PowerShell в
Windows), всё остальное — на сервере, после входа. Где в команде стоит `game.example.ru`,
`203.0.113.10` или `tribe` — подставьте свои домен, адрес сервера и имя пользователя.

## Содержание

1. [Что понадобится](#1-что-понадобится)
2. [Первый вход по SSH](#2-первый-вход-по-ssh)
3. [Обновления системы](#3-обновления-системы)
4. [Свой пользователь и вход только по ключу](#4-свой-пользователь-и-вход-только-по-ключу)
5. [Файрвол: только 22, 80, 443](#5-файрвол-только-22-80-443)
6. [Подкачка, если памяти 2 ГБ](#6-подкачка-если-памяти-2-гб)
7. [Docker](#7-docker)
8. [Домен и DNS](#8-домен-и-dns)
9. [Код игры на сервер](#9-код-игры-на-сервер)
10. [Переменные: куда вписать токен](#10-переменные-куда-вписать-токен)
11. [Запуск](#11-запуск)
12. [Проверка](#12-проверка)
13. [Перенос данных с Netlify](#13-перенос-данных-с-netlify)
14. [Переключение бота в BotFather](#14-переключение-бота-в-botfather)
15. [Откат на Netlify](#15-откат-на-netlify)
16. [Резервные копии](#16-резервные-копии)
17. [Обновление игры](#17-обновление-игры)
18. [Журналы и место на диске](#18-журналы-и-место-на-диске)
19. [Вариант с Coolify](#19-вариант-с-coolify)
20. [Проверка на своём компьютере](#20-проверка-на-своём-компьютере)

## 1. Что понадобится

- **Сервер**: Ubuntu 24.04, от 2 ядер и 2 ГБ памяти (лучше 4 ГБ: на сервере собирается игра),
  от 20 ГБ диска, адрес IPv4. Пароль root или ключ — из письма или панели хостера.
- **Домен** или поддомен (например `game.example.ru`) и доступ к его DNS у регистратора.
- **Токен бота** — тот же, что вписан в Netlify (Site configuration → Environment variables →
  `TELEGRAM_BOT_TOKEN`) или в @BotFather: `/mybots` → бот → **API Token**.
- Около часа. Первая сборка на сервере идёт 5–15 минут.

## 2. Первый вход по SSH

**Ключ на своём компьютере** (один раз; если ключ уже есть — пропустить). В PowerShell:

```powershell
ssh-keygen -t ed25519
```

Всё по умолчанию (Enter), пароль к ключу — по желанию. Открытая часть ключа лежит в
`C:\Users\<вы>\.ssh\id_ed25519.pub`.

Многие хостеры позволяют вставить открытый ключ при заказе сервера — тогда вход сразу по ключу.
Если нет — войти паролем из письма:

```powershell
ssh root@203.0.113.10
```

На вопрос `Are you sure you want to continue connecting` — `yes`. Выйти — `exit`.

Положить ключ на сервер из PowerShell (если не положили при заказе):

```powershell
type $env:USERPROFILE\.ssh\id_ed25519.pub | ssh root@203.0.113.10 "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"
```

После этого `ssh root@203.0.113.10` пускает без пароля.

## 3. Обновления системы

```bash
apt update && apt upgrade -y
apt install -y unattended-upgrades
dpkg-reconfigure -plow unattended-upgrades
```

Последняя команда спросит про автоматические обновления безопасности — ответить **Yes**. Если
после обновления система просит перезагрузку (`*** System restart required ***`) — `reboot`,
подождать минуту и войти снова.

## 4. Свой пользователь и вход только по ключу

Работать под root каждый день не стоит. Завести пользователя (имя любое, ниже — `tribe`):

```bash
adduser tribe
usermod -aG sudo tribe
mkdir -p /home/tribe/.ssh
cp ~/.ssh/authorized_keys /home/tribe/.ssh/
chown -R tribe:tribe /home/tribe/.ssh
chmod 700 /home/tribe/.ssh && chmod 600 /home/tribe/.ssh/authorized_keys
```

**Не закрывая это окно**, открыть второе окно PowerShell и проверить вход:

```powershell
ssh tribe@203.0.113.10
```

Пустило без пароля — запретить вход паролем и под root (в окне под root):

```bash
printf 'PasswordAuthentication no\nPermitRootLogin no\n' > /etc/ssh/sshd_config.d/10-tribe.conf
systemctl restart ssh
```

И ещё раз проверить вход `ssh tribe@…` в новом окне — только после этого закрывать старое.
Дальше всё — под `tribe`, команды с правами администратора — через `sudo`.

## 5. Файрвол: только 22, 80, 443

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 443/udp
sudo ufw enable
sudo ufw status
```

В выводе — `22/tcp (OpenSSH)`, `80/tcp`, `443/tcp`, `443/udp` и `Status: active`. (443/udp —
это тот же 443, для HTTP/3; можно не открывать.)

**Важное про Docker и ufw:** порты, которые открывает Docker (`ports:` в `docker-compose.yml`),
идут мимо правил ufw. Поэтому наружу их открывает только Caddy — 80 и 443; у приложения порта
наружу нет, и добавлять его нельзя (это держит тест). Если у хостера есть свой «облачный
файрвол» в панели — открыть там те же 22, 80, 443.

## 6. Подкачка, если памяти 2 ГБ

Сборка игры на сервере берёт памяти больше, чем сама игра. При 2 ГБ — завести подкачку на 2 ГБ
(при 4 ГБ и больше — пропустить):

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
free -h
```

## 7. Docker

Официальный способ для Ubuntu (docs.docker.com, «Install using the apt repository»):

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl git
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker tribe
```

Выйти (`exit`) и войти снова — чтобы группа `docker` подхватилась. Проверка:

```bash
docker run --rm hello-world
docker compose version
```

## 8. Домен и DNS

У регистратора домена, в управлении DNS, добавить запись:

| Тип | Имя | Значение |
|---|---|---|
| `A` | `game` (или `@` для самого домена) | адрес сервера, `203.0.113.10` |

Если у сервера есть IPv6 — ещё запись `AAAA` с ним. Запись расходится от минут до пары часов.
Проверить — с компьютера:

```powershell
nslookup game.example.ru
```

В ответе должен быть адрес сервера. **Пока его нет — шаг 11 не начинать:** Caddy не получит
сертификат для домена, который смотрит не на него (и после нескольких неудач Let's Encrypt
ненадолго перестанет выдавать).

## 9. Код игры на сервер

Репозиторий приватный: серверу нужен свой ключ только на чтение (deploy key).

```bash
ssh-keygen -t ed25519 -f ~/.ssh/tribe_deploy -N ""
cat ~/.ssh/tribe_deploy.pub
```

Скопировать выведенную строку → GitHub → репозиторий `war-of-tribes` → **Settings → Deploy
keys → Add deploy key** → вставить, галочку «Allow write access» **не** ставить → Add key.

```bash
printf 'Host github.com\n  IdentityFile ~/.ssh/tribe_deploy\n  IdentitiesOnly yes\n' >> ~/.ssh/config
chmod 600 ~/.ssh/config
git clone git@github.com:whiteship-max/war-of-tribes.git ~/tribe
cd ~/tribe
```

Работа идёт из ветки `master` — другой на сервере не нужно.

## 10. Переменные: куда вписать токен

Все настройки — в одном файле `.env` в папке игры на сервере. В репозиторий он не попадает
(`.gitignore`), в образ не копируется (`.dockerignore`).

```bash
cd ~/tribe
cp .env.example .env
nano .env
```

Вписать:

| Переменная | Что | Пример |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | токен бота — **тот же, что в Netlify** | `123456789:AA…` |
| `TRIBE_DOMAIN` | домен игры | `game.example.ru` |
| `TRIBE_STORE` | где данные: `sqlite` — на сервере | `sqlite` |
| `BACKUP_KEEP` | сколько суточных копий хранить | `14` |
| `BACKUP_AT` | во сколько снимать копию, время UTC | `03:30` |
| `TELEGRAM_WEBHOOK_SECRET` | секрет вебхука бота — кнопки под сообщениями (docs/NOTIFY.md, 12.6) | `openssl rand -hex 32` |
| `TRIBE_DELIVER` | доставка уведомлений: `on` — бот пишет о нападении и о бое (docs/NOTIFY.md, 12.6) | `off` |
| `NETLIFY_SITE_ID`, `NETLIFY_AUTH_TOKEN` | только для переноса данных (шаг 13), потом стереть | пусто |

Сохранить: `Ctrl+O`, Enter, выйти: `Ctrl+X`. Закрыть файл от чужих глаз:

```bash
chmod 600 .env
```

Токен никому не показывать и никуда не вставлять, кроме этого файла и настроек Netlify.

## 11. Запуск

```bash
cd ~/tribe
docker compose up -d --build
```

Первый раз собирается всё: зависимости, игра той же командой, что у Netlify (`npm run build`),
сервер. Это 5–15 минут. Потом:

```bash
docker compose ps
```

У `app` — `Up … (healthy)`, у `web` — `Up`. Журналы:

```bash
docker compose logs app
docker compose logs web
```

В журнале `app` — строки `хранилище: SQLite …`, `слушаю порт 8080 …`, `копия снята: …`. В журнале
`web` через полминуты — `certificate obtained successfully` для вашего домена.

## 12. Проверка

С компьютера, в браузере:

1. `https://game.example.ru/api/time` — ответ вида `{"now":1791131970654}`. Это сервер игры.
   Открылась страница игры вместо этого — запросы API не доходят до приложения (`docker compose
   logs web`).
2. `https://game.example.ru/api/save` — `{"error":"unauthorized"}`. Так и надо: без подписи
   Telegram сервер не пускает никого.
3. `https://game.example.ru` — игра; замок в адресной строке, сертификат действителен.

Из PowerShell то же одной строкой:

```powershell
curl.exe -s https://game.example.ru/api/time
```

## 13. Перенос данных с Netlify

Нужен, если на Netlify есть партии, которые жалко потерять. Делать **прямо перед** шагом 14:
всё, что игроки запишут на Netlify после переноса, на новый сервер уже не попадёт.

1. Номер сайта: Netlify → сайт `celebrated-yeot-73e410` → **Site configuration → General → Site
   details → Site ID**.
2. Личный токен: Netlify → аватар → **User settings → Applications → Personal access tokens →
   New access token** (срок — день).
3. Вписать оба в `.env` (`NETLIFY_SITE_ID=…`, `NETLIFY_AUTH_TOKEN=…`).
4. На сервере:

```bash
cd ~/tribe
docker compose stop app
docker compose run --rm app import-blobs --dry-run
```

Пробный прогон печатает, сколько строк в каком хранилище, и ничего не пишет. Если похоже на
правду:

```bash
docker compose run --rm app import-blobs
docker compose start app
```

Если база на сервере уже не пустая (сервер работал, кто-то успел сыграть), перенос откажется —
тогда `import-blobs --replace`: прежняя база сперва уйдёт копией, потом заменится. Если перенос
отвечает «сервер работает» — приложение остановилось не чисто; подождать полторы минуты и
повторить.

5. Стереть оба значения из `.env` и **отозвать токен** в Netlify (там же, Personal access tokens →
   Delete).

Перенос сохраняет у каждой записи её отметку версии (ETag): телефон игрока, который в последний раз
писал на Netlify, следующую запись на новый сервер кладёт как продолжение своей же партии, а не
как «чужую». Это проверено тестом.

## 14. Переключение бота в BotFather

В Telegram, в @BotFather:

1. `/mybots` → ваш бот → **Bot Settings → Menu Button** → изменить адрес кнопки на
   `https://game.example.ru`.
2. Если у бота заведена мини-аппка (`/newapp`, короткое имя — ссылки вида `t.me/<бот>/<имя>`):
   `/myapps` → она → **Edit Web App URL** → тот же адрес. Если заведена «главная мини-аппка» —
   **Bot Settings → Configure Mini App** → тот же адрес.
3. Полностью закрыть игру в Telegram и открыть заново.

Названия пунктов в BotFather меняются от версии к версии; смысл один — везде, где стоит
`https://celebrated-yeot-73e410.netlify.app`, поставить новый адрес.

**Что увидит игрок.** Подпись Telegram та же (бот тот же, токен тот же) — сервер его узнает.
Сохранение на телефоне привязано к адресу сайта, поэтому на новом адресе телефон начинает «с
чистого листа» и **берёт партию с сервера** — для этого и нужен шаг 13 до переключения. Партия,
которая лежала только на телефоне и ни разу не уехала на сервер (играли вне Telegram), на новом
адресе не появится. Прогресс предыстории у костра тоже хранится только на телефоне и на новый адрес
не переезжает.

**Сразу после переключения** — поправить в коде адрес, которым игрок делится ссылкой на игру
(`SITE_URL` в `src/game/data/social.ts`), и выкатить обновление (шаг 17). Это этап 2.

## 15. Откат на Netlify

Если что-то пошло не так — вернуть в @BotFather прежний адрес
`https://celebrated-yeot-73e410.netlify.app` (те же пункты, что в шаге 14). Netlify всё это время
работает как работал — **не выключайте и не удаляйте сайт**, пока не убедитесь, что свой сервер
живёт неделю без сбоев.

Чего откат не вернёт: партии, сыгранные на своём сервере после переключения, на Netlify не
уедут — обратного переноса нет (живых игроков пока нет, и он не делался). Свой сервер при этом
можно не останавливать: данные на нём целы, к нему можно вернуться повторным шагом 14.

## 16. Резервные копии

**Сами по себе.** Каждый день в `BACKUP_AT` (по умолчанию 03:30 UTC) приложение снимает копию базы
в `/data/backups` и оставляет `BACKUP_KEEP` самых свежих. Если свежей копии нет больше суток —
например, сервер только поднялся, — копия снимается сразу при запуске.

```bash
cd ~/tribe
docker compose run --rm app backups        # список копий
docker compose run --rm app backup         # снять копию сейчас
```

**Копия на том же диске не спасает от потери сервера.** Забирать к себе хотя бы раз в неделю:

```bash
cd ~/tribe
rm -rf backups-copy && docker compose cp app:/data/backups ./backups-copy
```

и с компьютера, в PowerShell:

```powershell
scp -r tribe@203.0.113.10:~/tribe/backups-copy .
```

Ещё надёжнее — включить у хостера резервные копии всего сервера (у большинства — галочка в панели
за небольшую доплату).

**Восстановить базу из копии:**

```bash
cd ~/tribe
docker compose run --rm app backups
docker compose stop app
docker compose run --rm app restore tribe-2026-10-04-0330.sqlite
docker compose start app
```

Имя — из списка `backups`. Под работающим приложением восстановление откажется. Нынешняя база
перед заменой сама сохраняется копией `before-restore-…` — восстановление можно отменить, восстановив
её так же. Копию, скачанную на компьютер, вернуть на сервер: положить файл в `~/tribe/` и
`docker compose cp tribe-….sqlite app:/data/backups/` — дальше как выше.

## 17. Обновление игры

После того как в `master` появилась новая работа:

```bash
cd ~/tribe
sh deploy/update.sh
```

Скрипт берёт свежий код (`git pull --ff-only`), собирает образы, снимает копию базы, перезапускает
и ждёт, пока приложение ответит. Игроки замечают перезапуск секундами: запрос, не дошедший в эти
секунды, игра повторит сама. То же руками:

```bash
git pull --ff-only
docker compose up -d --build
```

**Автоматическая выкладка из GitHub** возможна (действие GitHub Actions заходит на сервер по SSH
и запускает `deploy/update.sh` после каждого пуша в `master`), но не заведена нарочно: у проекта
давнее решение — сайт обновляет владелец руками, после проверки (CLAUDE.md, «Выкладка»). Захотите
сменить это решение — это отдельная задача: ключ для GitHub на сервере, секреты в репозитории,
одно действие.

## 18. Журналы и место на диске

```bash
docker compose logs -f app        # журнал приложения, выход — Ctrl+C
docker compose logs --tail 100 web
df -h /                           # место на диске
docker system df                  # сколько занимает Docker
docker image prune -f             # убрать старые образы после обновлений
```

Журналы контейнеров сами режутся по размеру (`logging: local` в `docker-compose.yml`). Журнал
приложения пишет только о своих делах — запуск, копии, перенос; запросов игроков, ключей и
токена в нём нет.

## 19. Вариант с Coolify

**Coolify** — панель в браузере для своих серверов: проекты из GitHub, кнопка «Deploy»,
переменные, журналы, домены и HTTPS — без командной строки. Ставится на тот же сервер одной
командой и берёт себе порты 80 и 443 (там стоит его прокси).

**Что выбрать.** Для одной игры проще и надёжнее чистый Docker (шаги 7–18): меньше движущихся
частей, всё описано в репозитории, памяти уходит только на игру. Coolify окупается, если на
сервере будет **несколько проектов** и удобнее кнопки, чем команды. Цена: сама панель занимает
около гигабайта памяти (нужен сервер от 4 ГБ), и её тоже надо обновлять. **Рекомендация — чистый
Docker**; к Coolify можно перейти позже, данные переносятся копией базы.

Coolify на живой панели с этой игрой ещё не проверялся — шаги ниже по устройству Coolify.

1. Шаги 2–5 как выше (Docker Coolify ставит сам — шаг 7 пропустить).
2. Установка (официальная команда coolify.io):

   ```bash
   curl -fsSL https://cdn.coollabs.io/coolify/install.sh | sudo bash
   ```

3. Панель слушает порт 8000. Чтобы не открывать его наружу — зайти через туннель, с компьютера:

   ```powershell
   ssh -L 8000:localhost:8000 tribe@203.0.113.10
   ```

   и открыть в браузере `http://localhost:8000`, завести администратора. Потом в настройках
   панели дать ей свой домен (например `panel.example.ru`, запись `A` как в шаге 8) — дальше
   заходить по нему.
4. **Projects → New → Private Repository (GitHub App)** — подключить `war-of-tribes`, ветка
   `master`.
5. **Build Pack: Docker Compose**, файл — `deploy/coolify.yml` (не `docker-compose.yml`: там порты
   80/443, которые заняты прокси Coolify).
6. У сервиса **web** — домен `https://game.example.ru` (порт 80). HTTPS выдаст Coolify.
7. **Environment Variables**: `TELEGRAM_BOT_TOKEN`, при желании `BACKUP_KEEP`, `BACKUP_AT`.
   `TRIBE_DOMAIN` не нужен — в этом файле Caddy слушает простой HTTP за прокси Coolify.
8. **Deploy**. Проверка — шаг 12.
9. Перенос данных (шаг 13) — из командной строки сервера: приложение остановить и запустить
   разовую копию его образа на том же томе.

   ```bash
   docker ps --format '{{.Names}}' | grep app                 # имя контейнера приложения
   APP=<имя из вывода>
   IMAGE=$(docker inspect --format '{{.Config.Image}}' "$APP")
   docker stop "$APP"
   docker run --rm --volumes-from "$APP" -e TELEGRAM_BOT_TOKEN=x -e NETLIFY_SITE_ID=<номер сайта> -e NETLIFY_AUTH_TOKEN=<токен> "$IMAGE" import-blobs --dry-run
   ```

   Похоже на правду — та же команда без `--dry-run`, потом `docker start "$APP"`. Токен потом
   отозвать (шаг 13, п. 5).
10. Копии — как в шаге 16 (они в томе `tribe-data`; команды — через `docker exec "$APP" node
    --disable-warning=ExperimentalWarning server.mjs backups`); Coolify умеет и свои копии томов —
    по желанию.

## 20. Проверка на своём компьютере

Если на компьютере стоит Docker Desktop, всё можно поднять у себя до сервера:

```powershell
cd "C:\Users\white\Desktop\War of Tribes"
copy .env.example .env
notepad .env
```

В `.env`: `TELEGRAM_BOT_TOKEN` — любой непустой (настоящий не обязателен), `TRIBE_DOMAIN=http://localhost`.

```powershell
docker compose up -d --build
```

Открыть `http://localhost` — игра; `http://localhost/api/time` — `{"now":…}`. Вне Telegram игра
работает, но не синхронизируется — так же, как на Netlify в обычном браузере. Остановить —
`docker compose down` (база останется в томе; стереть и её — `docker compose down -v`).
