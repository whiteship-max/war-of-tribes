# АУ-1: подготовка к починке аудита (SETUP-1, SETUP-3, SETUP-4, п. 10 решений)

Рабочий документ чата АУ-1 (порядок чатов — [README.md](README.md)). Ветка `game/au-1` от `master` `e2ddefa`. SETUP-2
(запрет прямого срезания склада) перенесён в АУ-3 вместе с `addStock` (слово владельца в задании АУ-1).

## SETUP-1. Базовая линия на `e2ddefa`

Облачный контейнер: 4 ядра, Node 22.22.0, `npm ci`. Бюджет железа даёт треть ядер — `budgetCores()` = 1, тесты шли одним
работником.

- `npm run typecheck` — чисто (около 40 с).
- `npm test` (`vitest run`, около 13 мин) — **418 файлов: 417 зелёных, 1 красный; 4 917 тестов зелёных, 1 красный, 42
  пропущены** (пропуски нарочные: `it.skip` ждущих игроков и городов в `src/world/*.test.ts`).
- Красный — `scripts/lib/fan.test.ts` › «по процессам — тот же итог…»: тест ждёт, что `TRIBE_FAN=2` уводит задачи в
  дочерние процессы, а ширина веера не выше бюджета (`fanWidth` = `min(2, budgetCores())` = 1 при 4 ядрах) — веер остался
  в процессе. Причина — железо контейнера, не код: на машине владельца бюджет 4 из 12, и тест зелёный. Не тронут: веер —
  периферия приёмки, и в этом чате его не гоняют.
- Файлы, которым нужны `vi.resetModules`, `vi.stubGlobal` и `expect.soft` (аудит под bun их не проверил), под vitest
  зелёные все 17: `src/net/{sync,era,session,roster}`, `src/ui/{lazydoors,map/tw/mini,next/labels,next/market,next/clean}`,
  `src/boot/warm`, `src/game/{foldlazy,armyfood}`, `src/telegram/cloud`, `src/perf/telemetry`, `netlify/vps/functions`,
  `scripts/lib/{budgetlock,timeclasses}`.
- Брошенного замка `~/.heavy-job.lock` нет.

## Передача

- Сделано: SETUP-1 (этот раздел).
- Дальше: SETUP-3, SETUP-4, п. 10 (а, б).
