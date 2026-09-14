// Что уносит и кого уводит победитель. По одной чистой функции на обе стороны —
// и это главное в модуле: правило «забираем всё, кроме спрятанного, но не больше,
// чем унесём» не должно быть написано дважды, как и правило «невольников уводят,
// скольких устережёт отряд». Одностороннее правило игрок раскусит за день, а две
// копии одного правила расходятся молча при первой же правке. Поверх обоих — одна
// дверь участи взятого города (`fate`): кто бы и чей бы город ни взял, делит его она.
//
// Никакого состояния, часов и `Math.random`: тот же склад, тот же тайник и та
// же грузоподъёмность дают тот же дележ, и сервер потом получит его же.
import type { ResourceId } from '@/game/types';
import { seeded } from '@/game/sim/random';
import type { Fallen, Loot } from './types';
import { FALL_BUILDINGS, FALL_LEVELS } from './data/tuning';

export interface Spoils {
  /** Что унесли, положительными числами. Пусто — не досталось ничего. */
  taken: Loot;
  /** Сколько всего унесли. */
  takenTotal: number;
  /** Сколько осталось у хозяина в тайнике. */
  hiddenTotal: number;
  /**
   * Сколько осталось сверх тайника — то, что победитель физически не поднял.
   * Не то же, что спрятанное: это добро лежало на виду, просто рук не хватило.
   */
  spilledTotal: number;
}

/**
 * Дележ склада после проигранного боя.
 *
 * Правило одно и без исключений: **что помещается в тайник — остаётся у
 * хозяина, всё остальное забирает победитель, сколько унесёт.** Тайник считается
 * по каждому припасу отдельно (`stash` — сколько прячется каждого), потому что
 * прячут не «долю добра», а зерно в подполе и железо в яме.
 *
 * Отсюда следует то, ради чего всё и сделано: копить на складе рискованно, а
 * тратить — выгодно; у тайника появляется настоящая цена; и склад после набега
 * пуст **по факту**, а не по коэффициенту.
 *
 * Грузоподъёмность — верхний предел и ничего больше. Если унести можно меньше,
 * чем лежит на виду, остаток остаётся хозяину и никуда не девается: он и есть
 * `spilledTotal`, и путать его со спрятанным нельзя — второй раз этот двор
 * возьмут тем же отрядом, а тайник не возьмут никогда.
 *
 * Делится взятое пропорционально тому, чего сколько лежало, с раздачей остатка
 * по наибольшей дробной части: иначе на семи припасах и целочисленном делении
 * пропадали бы единицы, и «взято = склад − тайник» переставало сходиться.
 */
export function plunder(stock: Loot, stash: number, carry: number): Spoils {
  const floorStash = Math.max(0, stash);
  const open: [ResourceId, number][] = [];
  let openTotal = 0;
  let hiddenTotal = 0;
  for (const [key, value] of Object.entries(stock) as [ResourceId, number | undefined][]) {
    const have = Math.max(0, Math.floor(value ?? 0));
    if (have <= 0) continue;
    hiddenTotal += Math.min(have, floorStash);
    const free = have - Math.min(have, floorStash);
    if (free <= 0) continue;
    open.push([key, free]);
    openTotal += free;
  }
  const take = Math.min(openTotal, Math.max(0, Math.floor(carry)));
  const taken: Loot = {};
  if (take > 0) {
    // Целые доли, потом остаток — тем, у кого дробная часть больше. Порядок при
    // равенстве задаёт сам склад, а он перебирается всегда одинаково.
    const parts = open.map(([r, n]) => {
      const exact = (n / openTotal) * take;
      const whole = Math.floor(exact);
      return { r, n, whole, frac: exact - whole };
    });
    let rest = take - parts.reduce((sum, p) => sum + p.whole, 0);
    for (const p of [...parts].sort((a, b) => b.frac - a.frac)) {
      if (rest <= 0) break;
      if (p.whole >= p.n) continue;
      p.whole += 1;
      rest -= 1;
    }
    for (const p of parts) if (p.whole > 0) taken[p.r] = p.whole;
  }
  return {
    taken,
    takenTotal: Object.values(taken).reduce((n, v) => n + (v ?? 0), 0),
    hiddenTotal,
    spilledTotal: openTotal - take,
  };
}

export interface Led {
  /** Скольких невольников увёл победитель. */
  taken: number;
  /** Сколько осталось хозяину: столько отряд не устерёг. */
  left: number;
}

/**
 * Кого уводит победитель: невольников, скольких устережёт отряд (`stackEscort`).
 * Правило то же, что у склада, и написано оно рядом по той же причине: одно на
 * обе стороны.
 *
 * Уводят только на той ступени участи, которая уводит людей (`FATES`), — и
 * зовётся эта функция поэтому только из двери участи (`fate`). Горожан сейчас
 * не уводит никто: ступени с горожанами в игре ещё нет.
 */
export function lead(bonded: number, escort: number): Led {
  const have = Math.max(0, Math.floor(bonded));
  const taken = Math.min(have, Math.max(0, Math.floor(escort)));
  return { taken, left: have - taken };
}

// ------------------------------------------------------ участь города ---

/**
 * Участь взятого города — что выбрал победитель. Лестница из трёх ступеней
 * (docs/DEFEAT_LADDER.md): ограбить, ограбить и увести людей, сжечь. В игре
 * сейчас есть первая, и выбирать её некому — она же и единственная; остальные
 * встанут строками в `FATES`, а не пятой дверью.
 */
export type Fate = 'plunder';

interface FateRule {
  /** Уводит ли победитель невольников. */
  bonded: boolean;
  /** Сколько построек теряют уровень и по сколько. */
  buildings: number;
  levels: number;
}

/**
 * Что делает каждая ступень. Ограбить — склад и казна до тайника, сколько
 * унесёт обоз; невольники остаются (их уводит только ступень, уводящая людей);
 * пять построек теряют по уровню. Числа решены владельцем, а не подобраны, и
 * лежат в `data/tuning.ts`; их цена меряется `npm run sack:report`, раздел «лестница».
 */
export const FATES: Record<Fate, FateRule> = {
  plunder: { bonded: false, buildings: FALL_BUILDINGS, levels: FALL_LEVELS },
};

/** Какой участью кончается взятие города сейчас: выбора ступени у победителя пока нет. */
export const FATE_NOW: Fate = 'plunder';

export type { Fallen };

export interface FateInput {
  fate: Fate;
  /** Склад целиком, вместе со спрятанным. Казны здесь нет — она своим полем. */
  stock: Loot;
  /** Казна. Прячется тем же тайником и уносится тем же обозом, что и склад. */
  gold: number;
  /** Сколько каждого припаса — и столько же золота — прячет тайник. */
  stash: number;
  bonded: number;
  /** Сколько добра поднимет отряд победителя (`stackCarry`). */
  carry: number;
  /** Скольких людей он устережёт (`stackEscort`). */
  escort: number;
  /**
   * Уровни построек, которые может задеть падение: ключ — постройка, число —
   * её уровень. Мир не знает, что это за постройки, — список собирает племя
   * (`expedition.fallPool`), и тайника в нём нет. Нет списка — не падает ничего:
   * у дворов мира построек нет.
   */
  levels?: Record<string, number>;
  /**
   * Соль выбора построек. Выводится из данных события (`fallSeed`), а не
   * бросается в минуту применения: перечитали сохранение — тот же список.
   */
  seed: number;
}

export interface FateResult extends Spoils {
  /** Кого увели и кто остался. */
  led: Led;
  /**
   * На какие постройки пришёлся удар — все выбранные, в порядке выбора, и те,
   * что уже стоят на первом уровне (`from === to`): ниже первого не падает ничто.
   */
  fallen: Fallen[];
}

/**
 * Соль выбора построек из данных события: сид мира и минута падения. Одно
 * событие — одна соль, и никакого `Math.random`.
 */
export function fallSeed(worldSeed: number, at: number): number {
  let h = (worldSeed >>> 0) ^ Math.imul(Math.floor(at / 1000) >>> 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * **Одна дверь участи.** Всё, что теряет взятый город и получает победитель, —
 * здесь, а зовут её все места, где город взят: прорвавшийся набег, падение
 * нашего города голодом, наш набег на двор и падение чужого города под нашим
 * лагерем. Своего дележа ни у одного из них нет — это тест по исходнику.
 *
 * Мятеж сюда не ходит: победителя там нет и выбирать участь некому, склад он
 * делит тем же `plunder`, но казну не трогает (`game/sim/mutiny`).
 *
 * Арифметика — `plunder` и `lead` без единой правки: казна входит в дележ
 * восьмым припасом, с тем же тайником и тем же обозом.
 */
export function fate(input: FateInput): FateResult {
  const rule = FATES[input.fate];
  const spoils = plunder({ ...input.stock, gold: input.gold }, input.stash, input.carry);
  const have = Math.max(0, Math.floor(input.bonded));
  const led = rule.bonded ? lead(have, input.escort) : { taken: 0, left: have };
  return { ...spoils, led, fallen: pickFallen(input.levels ?? {}, input.seed, rule) };
}

/**
 * Какие постройки теряют уровень. Выбор — перестановка списка по соли, а
 * список упорядочен по ключу, а не по тому, как его собрали: одна соль и один
 * набор построек дают один и тот же выбор на любой стороне.
 */
function pickFallen(levels: Record<string, number>, seed: number, rule: FateRule): Fallen[] {
  if (rule.buildings <= 0 || rule.levels <= 0) return [];
  const ids = Object.keys(levels).sort();
  const rng = seeded(seed);
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return ids.slice(0, rule.buildings).map((id) => {
    const from = Math.max(1, Math.floor(levels[id]));
    return { id, from, to: Math.max(1, from - rule.levels) };
  });
}

/**
 * Что теряет наш взятый город — полями последствия для племени. Одно место на
 * оба пути поражения (прорвавшийся набег и голод), чтобы увод и падение уровней
 * не доезжали в племя одним путём и не доезжали другим.
 */
export function homeLoss(r: FateResult): { resources: Loot; bonded?: number; fallen?: Fallen[] } {
  return {
    resources: asLoss(r.taken),
    ...(r.led.taken > 0 ? { bonded: -r.led.taken } : {}),
    ...(r.fallen.length > 0 ? { fallen: r.fallen } : {}),
  };
}

/** То же взятое, но со знаком минус: так добыча приезжает в племя, у которого её отняли. */
export function asLoss(taken: Loot): Loot {
  const out: Loot = {};
  for (const [key, value] of Object.entries(taken) as [ResourceId, number | undefined][]) {
    if ((value ?? 0) > 0) out[key] = -(value as number);
  }
  return out;
}
