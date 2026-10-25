// Вывод таблицы наград разового дела для античита (AC-1 аудита; решение владельца — docs/audit/OWNER-DECISIONS.md, п. 2):
// сколько одно дело может положить на склад и в казну и сколько снять, — из данных игры, с запасом ×1.2.
//
// Пишет таблицу `npx vite-node scripts/deeds/build.ts` в `src/game/data/deedgain.ts`; руками её не правят. Тест
// `scripts/deeds/derive.test.ts` выводит заново и сверяет буква в букву: поправил весть, награду задания или привоз и не
// пересобрал — красный тест.
//
// Как выводится:
//  · вести (`data/events`: прежние, сезонные `data/tidings` и вести державы `sim/crown.crownEvents`) — каждый ответ каждой
//    вести исполняется дверью ответа (`sim/mail.resolveEvent`) на пробных посёлках размеров ×1…×8 стартового и нескольких
//    сидах; прибавка, убавка (с ценой ответа), бойцы и трофеи у ворот, которые весть положила вызовом (`s.gate`), делятся на
//    размер посёлка (`eventKit.scale` — так их считают сами вести);
//  · задания — наибольшая награда по видам (постоянная часть); ежедневка — база награды на размер посёлка;
//  · бой — груз бойца и уводимые на бойца (`world/data/units`), промысел — доля дневной выработки за игру, лавка — лот,
//    караван — привоз.
import { createInitialState } from '@/game/state';
import { RESOURCE_IDS, START_POP } from '@/game/constants';
import { buildingOfType, maxLevelFor, storageCap } from '@/game/derived';
import type { GameState } from '@/game/types';
import { EVENTS } from '@/game/data/events';
import { QUESTS } from '@/game/data/quests';
import { DAILY_GAMES } from '@/game/data/daily';
import { POINTS_CAP } from '@/game/data/realm';
import { ENERGY_MAX, ENERGY_REFILL, MINIGAME_COST, MINIGAME_SHARE, MINIGAMES } from '@/game/data/minigames';
import { GOODS } from '@/game/data/market';
import { SHOP_LOT } from '@/game/gemrules';
import { supplyOf } from '@/game/marketrules';
import { STAB_MAX, STAB_MIN } from '@/game/stabrules';
import { gameDaysOfMs } from '@/game/pace';
import { eventId, raiseEvent, resolveEvent } from '@/game/sim/mail';
import { minigameShares } from '@/game/sim/minigames';
import { addBonded } from '@/game/sim/population';
import { UNITS } from '@/world/data/units';
import { DEED_MARGIN, type DeedTable, type Row } from '@/game/data/deedgain';

/** Виды склада и казна — ключи таблицы. */
export const KEYS: readonly string[] = [...RESOURCE_IDS, 'gold'];

/** Размеры пробных посёлков, во сколько раз больше стартового, и сиды. */
const SCALES = [1, 2, 4, 8];
const SEEDS = [1, 2, 3, 4, 5];

const zero = (): Record<string, number> => Object.fromEntries(KEYS.map((k) => [k, 0]));

/**
 * Пробный посёлок: в `scale` раз больше стартового (жители, войско и новобранцы — `derived.population`), склад, который ничего
 * не срезает, полкасы и полсклада всего, очки правителя до потолка — чтобы ни одна цена ответа не погасила его.
 */
function probe(scale: number, seed: number): GameState {
  const s = createInitialState(seed);
  buildingOfType(s, 'storage')!.level = 400;
  const cap = storageCap(s);
  for (const r of RESOURCE_IDS) s.resources[r] = cap / 2;
  s.gold = 1e6;
  s.army.spearman = 5 * scale;
  s.pop = START_POP * scale - 5 * scale;
  addBonded(s, 10 * scale);
  for (const b of Object.keys(s.realm.points) as (keyof typeof s.realm.points)[]) s.realm.points[b] = POINTS_CAP;
  s.realm.pointsAt = s.time;
  return s;
}

/** Сдвиг склада и казны между двумя состояниями: прибавка и убавка по ключам, бойцы. */
function diff(a: GameState, b: GameState): { gain: Record<string, number>; loss: Record<string, number>; troops: number } {
  const gain = zero();
  const loss = zero();
  for (const r of RESOURCE_IDS) {
    const d = b.resources[r] - a.resources[r];
    if (d > 0) gain[r] = d;
    else loss[r] = -d;
  }
  const g = b.gold - a.gold;
  if (g > 0) gain.gold = g;
  else loss.gold = -g;
  const men = (s: GameState): number => Object.values(s.army).reduce((t, n) => t + (n ?? 0), 0);
  return { gain, loss, troops: Math.max(0, men(b) - men(a)) };
}

/** Наибольшее по ключам: `into[k] = max(into[k], from[k] / scale)`. */
function lift(into: Record<string, number>, from: Record<string, number>, scale: number): void {
  for (const k of KEYS) into[k] = Math.max(into[k], (from[k] ?? 0) / scale);
}

/** Что сделали вести: наибольшее на единицу размера посёлка — прибавка, убавка, бойцы и трофеи у ворот. */
export function eventsPerScale(): { gain: Record<string, number>; loss: Record<string, number>; troops: number; spoils: Record<string, number>; answers: number } {
  const gain = zero();
  const loss = zero();
  const spoils = zero();
  let troops = 0;
  let answers = 0;
  for (const def of EVENTS) {
    for (let i = 0; i < def.options.length; i++) {
      for (const scale of SCALES) {
        for (const seed of SEEDS) {
          const s = probe(scale, seed);
          raiseEvent(s, def.id);
          const ev = s.inbox.find((e) => e.defId === def.id);
          if (!ev) throw new Error(`весть ${def.id} не легла на стол пробного посёлка`);
          const before = structuredClone(s);
          const gates = s.gate.length;
          // Вывод меряет, что ответ даёт, когда его можно дать: условие варианта (`EventOption.block`, ECO-3) — о минуте
          // ответа (стройка идёт, святыни нет), а не о размере награды. Пробный посёлок условия не держит — снимаем его.
          const opt = def.options[i];
          const block = opt.block;
          opt.block = undefined;
          let r: ReturnType<typeof resolveEvent>;
          try {
            r = resolveEvent(s, i, eventId(ev));
          } finally {
            opt.block = block;
          }
          if (r.error) throw new Error(`ответ ${def.id}#${i} на пробном посёлке ×${scale}: ${r.error}`);
          answers++;
          const d = diff(before, s);
          lift(gain, d.gain, scale);
          lift(loss, d.loss, scale);
          troops = Math.max(troops, d.troops / scale);
          for (const call of s.gate.slice(gates)) lift(spoils, call.spoils as Record<string, number>, scale);
        }
      }
    }
  }
  return { gain, loss, troops, spoils, answers };
}

/** Наибольшая награда задания по видам. */
export function questFlat(): Record<string, number> {
  const out = zero();
  for (const q of QUESTS) for (const r of RESOURCE_IDS) out[r] = Math.max(out[r], q.reward[r] ?? 0);
  return out;
}

/** База награды ежедневки по видам — на единицу размера посёлка (`sim/daily.dailyReward`). */
export function dailyPerScale(): Record<string, number> {
  const out = zero();
  for (const g of DAILY_GAMES) for (const r of RESOURCE_IDS) out[r] = Math.max(out[r], g.reward[r] ?? 0);
  return out;
}

/** Промысел: какую долю дневной выработки вида приносит одна игра при полном счёте (`sim/minigames.minigameCap`). */
export function gameShare(): Record<string, number> {
  const k = ((MINIGAME_SHARE * MINIGAME_COST) / ENERGY_MAX) * gameDaysOfMs(ENERGY_REFILL);
  const out = zero();
  for (const m of MINIGAMES) {
    const shares = minigameShares(m.id);
    for (const r of RESOURCE_IDS) out[r] = Math.max(out[r], k * (shares[r] ?? 0));
  }
  return out;
}

/** Караван: наибольший привоз вида — рынок высшего уровня, лучший привоз и стабильность (`marketrules.supplyOf`). */
export function caravanMax(): Record<string, number> {
  const out = zero();
  const top = maxLevelFor('market');
  for (const def of GOODS) {
    if (!def.resource) continue;
    for (let w = 0; w < 4096; w++) {
      for (const stab of [STAB_MIN, 0, STAB_MAX]) out[def.resource] = Math.max(out[def.resource], supplyOf(def, top, w, stab));
    }
  }
  return out;
}

/** С запасом: ×`DEED_MARGIN`, вверх до целого (доли — до сотых). */
const up = (n: number, frac = false): number => (frac ? Math.ceil(n * DEED_MARGIN * 100) / 100 : Math.ceil(n * DEED_MARGIN));

const rowUp = (flat: Record<string, number>, scale: Record<string, number>): Row => ({
  flat: Object.fromEntries(KEYS.map((k) => [k, up(flat[k] ?? 0)])),
  scale: Object.fromEntries(KEYS.map((k) => [k, up(scale[k] ?? 0, true)])),
});

/** Таблица целиком. */
export function deriveDeedTable(): DeedTable {
  const ev = eventsPerScale();
  const quests = questFlat();
  const daily = dailyPerScale();
  const otherScale = zero();
  for (const k of KEYS) otherScale[k] = Math.max(ev.gain[k], daily[k]);
  // Постоянная часть прочего дела — награда задания и единица округления (`eventKit.amount`: не меньше единицы).
  const otherFlat = zero();
  for (const k of KEYS) otherFlat[k] = quests[k] + 1;
  const one = Object.fromEntries(KEYS.map((k) => [k, 1]));
  return {
    gain: rowUp(otherFlat, otherScale),
    loss: rowUp(one, ev.loss),
    troops: { flat: up(1), scale: up(ev.troops, true) },
    fight: { carry: up(Math.max(...UNITS.map((u) => u.carry))), led: up(Math.max(...UNITS.map((u) => u.escort))), scale: rowUp(one, ev.spoils).scale },
    game: Object.fromEntries(KEYS.map((k) => [k, up(gameShare()[k] ?? 0, true)])),
    shop: up(SHOP_LOT),
    caravan: Object.fromEntries(KEYS.map((k) => [k, up(caravanMax()[k] ?? 0)])),
  };
}

/** Текст файла таблицы. */
export function renderDeedTable(t: DeedTable): string {
  const counts = (c: Record<string, number>): string => `{ ${KEYS.map((k) => `${k}: ${c[k] ?? 0}`).join(', ')} }`;
  const row = (r: Row): string => `{ flat: ${counts(r.flat)}, scale: ${counts(r.scale)} }`;
  return `// Сгенерирована \`npx vite-node scripts/deeds/build.ts\` (вывод — scripts/deeds/derive.ts) из данных игры с запасом
// ×${DEED_MARGIN}. Руками не править — скрипт перезапишет, а тест \`scripts/deeds/derive.test.ts\` сверит с выводом.
//
// Сколько одно разовое дело может положить на склад и в казну и сколько снять (AC-1 аудита, docs/audit/OWNER-DECISIONS.md,
// п. 2): допуск сервера к росту и убыли склада между описями — \`netlify/lib/deeds.ts\`. Ряд — постоянная часть и часть на
// единицу размера посёлка (\`eventKit.scale\`: жители, войско и новобранцы на стартовые ${START_POP}).

/** Запас таблицы над выведенным. */
export const DEED_MARGIN = ${DEED_MARGIN};

/** Ряд допуска по видам склада и казне: \`flat + scale × размер посёлка\`. */
export interface Row {
  flat: Record<string, number>;
  scale: Record<string, number>;
}

export interface DeedTable {
  /** Прочее дело (весть и весть державы, задание, ежедневка, охота, покупка, разведка, взятый замок): прибавка за одно. */
  gain: Row;
  /** Оно же: убавка за одно (цена ответа, весть отнимает добро). */
  loss: Row;
  /** Оно же: бойцы за одно. */
  troops: { flat: number; scale: number };
  /**
   * Бой (победа, логово, набег): груз на бойца, уводимые на бойца (невольники, книга невольников сервера — АУ-8, п. 2) и
   * трофеи у ворот на единицу размера посёлка.
   */
  fight: { carry: number; led: number; scale: Record<string, number> };
  /** Промысел: доля дневной выработки вида за одну игру. */
  game: Record<string, number>;
  /** Дело лавки алмазов: лот. */
  shop: number;
  /** Караван: наибольший привоз вида. */
  caravan: Record<string, number>;
}

export const DEED_TABLE: DeedTable = {
  gain: ${row(t.gain)},
  loss: ${row(t.loss)},
  troops: { flat: ${t.troops.flat}, scale: ${t.troops.scale} },
  fight: { carry: ${t.fight.carry}, led: ${t.fight.led}, scale: ${counts(t.fight.scale)} },
  game: ${counts(t.game)},
  shop: ${t.shop},
  caravan: ${counts(t.caravan)},
};
`;
}
