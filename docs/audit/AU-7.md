# АУ-7: этапы 7 и 8 плана — проверить подозрения, закрепить результат

Рабочий документ чата АУ-7 (порядок чатов — [README.md](README.md)). Ветка `game/au-7` от `game/au-6` `d1f6d5f`. Опора —
[WORKPLAN.md](WORKPLAN.md) (этапы 7–8) и [OWNER-DECISIONS.md](OWNER-DECISIONS.md) с «Дополнениями 25.10». Каждое подозрение —
сначала тест; одна задача — один коммит.

**Ядро:** правки в файлах ядра — `netlify/lib/war.ts` (пп. 7, 9; новое необязательное поле записи войн `WarFile.gens` — только
у сервера, договор не менялся), `src/game/sim/gems.ts` (п. 6), `src/game/gemrules.ts` (перенос prove-6-1). `src/game/stockrules.ts`
(АУ7-1) — общее правило склада игры и книги запасов. Сохранение: `SAVE_VERSION` и `WORLD_SAVE_VERSION` не растут.

## Этап 7. Подозрения

| П. | Подозрение | Итог | Коммит |
| --- | --- | --- | --- |
| 1 | `spyDeed`: двойное списание | **не баг** — закрыт в АУ-6 (MAP-4), тест-замок | `8063d3b` |
| 2 | петля ковки и продажи | **не баг** — закрыт в АУ-4 (ECO-6), тест-замок | `c420229` |
| 3 | `haulCap` из данных клиента | **исправлен** в АУ-4 (AC-4): сервер считает сам | `670374a` |
| 4 | `spyHomeAt`: давняя смерть шпиона | **исправлен** в АУ-5 (BTL-8 п. 5) | `ff57089` |
| 5 | `attackAt`: переправа через реку | **исправлен** в АУ-6 (MAP-10 п. 4) | `7b2cb93` |
| 6 | `readGemNote`: записи с одним `n` применяются дважды | **исправлен** — подтвердился в двери партии | `ab3b4d8` |
| 7 | `war.ts` `storm`: выбитые башней не снимаются с армии | **исправлен** — подтвердился иначе: обоз падения | `4f1bc29` |
| 8 | `claimedSheet`: `pips` перезаписываются последней войной | **не баг**, тест-замок | `e6a2e02`, `37e6b6b` |
| 9 | `generalCap`: удар и выручка не тратят энергию полководца | **исправлен** | `b148fee` |
| 10 | полный список из `bug-report.md` («Что не проверялось тестами») и `bug-report-2.md` («E3») | **ждёт владельца** — этих файлов в репозитории нет (в `docs/audit/` лежат только план, решения и `regression-tests/`); пп. 1–9 выше — всё, что из них перенесено в план | — |

- **П. 6.** `applyGemDeeds` отбирал свежие дела по `gemSeen` один раз до шага: два дела с одним номером в одной записке
  (`readGemNote` их не сводит) ложились оба. Наш сервер номеров не повторяет (`gems.ts`: номер — `seq + 1`), так что пути от
  настоящего сервера нет — правка поясом, номер сверяется в каждом шаге. Тест в `src/game/sim/gems.test.ts` падал
  «expected 2 to be 1».
- **П. 7.** Выбитые башней **снимаются** с войска похода, когда лагерь снят (`turnBack`), — как у лагеря под логовом. Но падение
  считается раньше снятия, и обоз (`fateOfWar`, им же цена дани `fairOf`) брал в счёт и выбитых: у мира обоз — после `liftSiege`,
  без них. Теперь уцелевшие в обозе — без выбитой доли. Тест `netlify/lib/warthin.test.ts` падал «expected 450000 to be ≤ 225000».
- **П. 8.** Полководец один (`generalBusy`, BTL-2), войны лежат в записи по порядку отправки — последняя в цикле и есть самая
  свежая. Тест `netlify/lib/warpips.test.ts` (два похода подряд после слепка) зелёный; мутация «обход войн с конца» валит его
  утверждением «второй в пути — отметок дома нет».
- **П. 9.** Удар у своих стен и выручка союзника проверяли энергию по слову приказа (не выше потолка последнего похода), но трат
  сервер не помнил — с выдуманным полным запасом удары шли один за другим. Решение (правило 19): принятый удар (выручка)
  оставляет `WarFile.gens[ключ]` — запас минуты приказа минус цена, дальше копится, как дома. Это потолок, а не правда (дорога
  не копит), и честного он не режет: у клиента та же цена списана при приказе (`LocalWorld.payEnergy`), дальше — дорога. Позже
  последнего похода — потолок по ней. Дружина в бою легла вся — отметка снимается, как у войска, не вернувшегося из похода (у
  клиента это `defeatGeneral`, на месте может стоять новый). Поле лежит `ENERGY_FILL` (потом запас полон и так) и читается
  `readWars`. Тест `netlify/lib/warstrikecap.test.ts` на старом коде падал «expected 6 to be 5» и «expected 100 to be close to
  80». Выручка тем же `markGeneral` — отдельным тестом не проверена (нужен пакт и третий игрок; путь — та же функция).

## Этап 8. Закрепить результат

**Перенос тестов архива.** Все тесты `regression-tests/` перенесены в АУ-1…АУ-6 вместе с починками, кроме одного — он перенесён
здесь. Сверка по каждому каталогу:

| Каталог архива | Задача | Где в репозитории |
| --- | --- | --- |
| round1/game-core/prove-1-1 | ECO-4 | `src/game/sim/population.test.ts` |
| round1/game-core/prove-2-1 | BTL-1 | `src/game/battle/losses.test.ts` |
| round1/game-core/prove-3-1, -7-1, -14-1, -15-1, -16-1, -17-1, -18-1 | ECO-1, вариант A | **не переносятся**: вариант «запас выше вместимости держится» отменён решением владельца п. 1; их место — `sim/stock.test.ts`, `sim/stockprop.test.ts` |
| round1/game-core/prove-4-1 | ECO-3 | `src/game/sim/eventfreeze.test.ts` |
| round1/game-core/prove-5-1 | ECO-2 | `src/game/sim/tidings.test.ts`, «ECO-2» |
| round1/game-core/prove-8-1 | BTL-6 | `src/game/sim/troopslost.test.ts` |
| round1/game-core/prove-11-1 | BTL-8 п. 3 | `src/game/deserters.test.ts` |
| round1/game-core/prove-12-1 | BTL-3 | `src/world/militiafaith.test.ts` |
| round1/game-core/prove-13-1 | ECO-5 | `src/game/sim/daily.test.ts` |
| round1/server-battle-net/prove-1-1 | BTL-8 п. 1 | `netlify/lib/warprune.test.ts` |
| round1/server-battle-net/prove-2-1 | AC-2 | `netlify/lib/book.test.ts` |
| round1/server-battle-net/prove-4-1 | AC-7 | `netlify/lib/town.test.ts`, «AC-7» |
| round1/server-battle-net/prove-5-1 | AC-4 | `netlify/lib/security.test.ts`, «AC-4» |
| round1/server-battle-net/prove-6-1 | BTL-5 | `src/battle/lonerider.test.ts` |
| round1/server-battle-net/prove-7-1 | BTL-8 п. 2 | `src/battle/replayhorse.test.ts` |
| round1/server-battle-net/prove-8-1 | AC-5 | `src/game/sim/rn1.test.ts`, «AC-5» |
| round1/world/prove-1-1 | MAP-5 | `src/world/lettercap.test.ts` |
| round1/world/prove-2-1 | MAP-7 | `src/world/legacybreach.test.ts` |
| round1/world/prove-4-1 | MAP-2 | `src/world/reaimwood.test.ts` |
| round1/world/prove-5-1 | MAP-6 | `src/world/interceptwait.test.ts` |
| round2/prove-3-1, -29-1 | FIN-3 | `netlify/lib/pay.test.ts` (FIN-3) |
| round2/prove-4-1, -11-1 | FIN-2 | `netlify/lib/ton.test.ts` (FIN-2), `pay.test.ts` |
| round2/prove-5-1, -12-1 | FIN-1 | `netlify/lib/ton.test.ts` (650 транзакций), `pay.test.ts` (тысяча) |
| round2/prove-6-1 | SETUP-3 | **перенесён здесь**: `netlify/lib/protokeys.test.ts` — и нашёл хвост SETUP-3 (ниже) |
| round2/prove-7-1, -13-1 | AC-1 | `netlify/lib/deeds.test.ts` |
| round2/prove-8-1 | AC-3 | `netlify/lib/admin.test.ts` |
| round2/prove-9-1 | OPS-1 | `netlify/vps/backuprotate.test.ts` |
| round2/prove-10-1 | OPS-2 | `src/net/leaseskew.test.ts` |
| round2/prove-15-1 | AC-6 | `src/game/sim/cancelrefund.test.ts` |
| round2/prove-17-1, -18-1 | BTL-2 | `netlify/lib/warbusy.test.ts` |
| round2/prove-19-1 | MAP-8 | `src/world/scoutcamp.test.ts` |
| round2/prove-20-1 | MAP-1 | `src/world/pactcatchup.test.ts` |
| round2/prove-23-1 | BTL-7 | `src/world/sendtroops.test.ts` |
| round2/prove-24-1 | MAP-3 | `src/world/vacantcamp.test.ts` |
| round2/prove-25-1, -26-1 | — | **не переносятся**: сам аудит их отклонил (NOTE.txt: племён-поселений в мире нет, `negotiate` недостижим; «no busy scenario») — доказывать нечего |
| round2/prove-27-1 | FIN-4 | `netlify/lib/gems.test.ts` (FIN-4), `src/net/gems.test.ts` |
| round2/prove-28-1 | FIN-5 | `netlify/lib/gems.test.ts`, `town.test.ts`, `src/game/sim/gems.test.ts` |

- **Хвост SETUP-3** (`3d28eed`). `gemrules.rushLevelOk` искал постройку приказа `BUILDING_BY_ID[type]`: «constructor» находил
  функцию, уровень 2 проходил, и отказ приходил случайно («последние пять минут даром» — работа функции ноль). Алмазы не
  списывались; пояс — своим полем `guard.own`.

**Тесты-свойства.**

| Свойство | Тест | Мутация, которая его валит | Коммит |
| --- | --- | --- | --- |
| склад в [0, вместимость] (`addStock`): десять тысяч прибавок и убавок, запас и выше вместимости, не-числа | `src/game/sim/stockprop.test.ts` | — (упал на коде: **АУ7-1**) | `ea1bfae` |
| возврат отмены стройки у клиента и сервера один: двести очередей, начатые (и дробью) и нет, отмены любых мест | `src/net/refundprop.test.ts` | «начатая — работа > 1»: «сид 5, wood: expected 510 to be 255» | `38cc7ef` |
| потери настоящего боя ложатся на бойцов по весам: двести боёв через ядро и `troopLosses` | `src/game/battle/lossesfield.test.ts` (решётка — `losses.test.ts`, АУ-5) | «остаток рода — по полувесу и для потерь» | `9dd60af` |

- **АУ7-1 — новая находка** (`ea1bfae`). Прибавка NaN делала запас NaN: `Math.max(0, NaN)` — тоже NaN, и порча оставалась в
  партии навсегда. `stockrules.fitStock` (одно правило игры и книги запасов сервера) читает не-число как ноль. Свойство WORKPLAN
  «прибавка никогда не уменьшает запас» верно только в пределах вместимости — выше неё главнее решение владельца п. 1 (излишек
  сгорает); тест проверяет его в этой области.

**Нагрузочный тест платежей** — сделан в АУ-2 (`f2b745c`, `netlify/lib/pay.test.ts`, «нагрузка»): тысяча транзакций,
просроченные заказы, смена эпохи — ни одного двойного начисления.

**«Честная партия без флагов» в CI** — сделана в АУ-3 (`0f00802`): `src/net/deedsfair.test.ts` (шесть часов записей раз в
минуту с делами всех видов, допуск AC-1) и `src/net/goodsbook.test.ts` (честные траты). GitHub Actions в репозитории нет: CI
проекта — `npm test` (пол правила 9) и приёмка на сервере (`tribe-ci`, docs/handbook/acceptance.md), оба тест гонят. Заводить
отдельный CI — не задача чата, это решение владельца.

**docs/trust-boundary.md** (`eba73bc`) — каждое поле, которое присылает клиент: верит ли сервер и чем проверено.

## Передача (25.10.2026): АУ-7 готов

Ветка `game/au-7` от `game/au-6` `d1f6d5f`. **Приёмки отчётами не было** (по заданию: без `fan` и полных отчётов); последний
принятый коммит — тот же, что у `master` до АУ-1 (`d1784a7`). `TEST_ARMY_FOOD = 0` и `TEST_TRAVEL_SPEED = 3` не трогал.
Брошенного `~/.heavy-job.lock` не было.

**Пол правила 9 на диапазоне АУ-7 (`d1f6d5f..HEAD`):**
- `npm run typecheck` — чисто.
- `npm test` частями (потолок 15 минут), по одной: `netlify scripts` — 842 зелёных, 1 красный (`scripts/lib/fan.test.ts`, железо
  контейнера, как у АУ-1…АУ-6); `src/game src/net src/profile src/battle` — 1 196; `src/world` — 867 и 42 пропущены нарочно;
  `src/ui src/minigames src/render` — 1 605; остаток `src` — 620. Итого 5 130 зелёных, 1 красный, 42 пропущены, 467 файлов
  (461 у АУ-6 и 6 новых).
- `npm run build` — зелёный, первая загрузка 596.4 КБ по сети (у АУ-6 — 596.3).

**Что выкладывать — игру и сервер вместе** (вся цепочка АУ-1…АУ-7 сразу; денежное АУ-2 — по слову владельца раньше). Из АУ-7:
сервер — `netlify/lib/war.ts` (пп. 7, 9); общие с сервером `src/game/stockrules.ts` (книга запасов), `src/game/gemrules.ts`
(ускорение за алмазы); игра — `src/game/sim/gems.ts`. Договор не менялся; `WarFile.gens` — новое необязательное поле записи
войн, старый сервер его не знает и не портит, новый читает запись без него.

**Какие отчёты сдвинутся.** Дельта АУ-7 по диффу — 19 из 23 (`npx vite-node scripts/reports.ts -- --plan --base d1f6d5f`;
не задеты `battle`, `world`, `settle`, `figure`), но поведения честной партии она не меняет: не-число на складе, повторный номер
дела алмазов и постройка-ключ прототипа автопилоту не встречаются; пп. 7 и 9 — только сервер войны, отчётов о нём нет. Ждать
сдвига от АУ-7 — нет. **Вся цепочка от `master` (`--base d1784a7`) — все 23**: сам подсчёт тронут (`vite.config.ts`).

**Что выводить и проверять на серверной приёмке (`tribe-ci`, docs/handbook/acceptance.md):**
1. Полная приёмка `npm run reports -- --base d1784a7` — все 23 (подсчёт тронут); сдвиги ждать от АУ-3 (ECO-1: склад не выше
   вместимости, AC-1), АУ-4 (ECO-2…ECO-5), АУ-5 (BTL-1, BTL-3, BTL-5 — версия правил боя 2), АУ-6 (MAP-9, MAP-5, MAP-10) — по
   их передачам ([AU-3.md](AU-3.md), [AU-4.md](AU-4.md), [AU-5.md](AU-5.md), [AU-6.md](AU-6.md)); от АУ-7 — нет.
2. Вывод неподвижных точек после АУ-5 (правило 16): W — `npm run derive -- w --write`, таблица у ворот —
   `npm run derive -- gate --write` (BTL-1/3/5 меняют исход боёв); разбор — [AU-5.md](AU-5.md), «Передача».
3. `npm test` целиком на 4 ядрах `tribe-ci`: там `fan.test.ts` должен быть зелёным (бюджет 4 → веер уходит в процессы); красный
   там — находка.
4. После выкладки на сервере — `/payments` (очередь возвратов FIN-7) и первый просмотр кошелька (FIN-1: перечитает заказы один
   раз), как в [AU-2.md](AU-2.md).

**Открытые вопросы владельцу** — сведены в итоговую таблицу [README.md](README.md) (столбец «ждёт решения владельца»): п. 11 (разрыв
пакта между игроками без отсрочки), п. 12 (книга невольников), п. 13 (кости дипломатии с секретным сидом), п. 17 (`battleWinner`
при выручке), FIN-6 (вечный замок начисления вокруг `/wipeworld`), OPS-3 (эпоха перед записью алмазов и оплаты), этап 7 п. 10
(файлы `bug-report*.md`); решённые ИИ и переигрываемые — пп. 14, 15, 16, 18.
