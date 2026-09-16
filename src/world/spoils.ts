// Что уносит и кого уводит победитель. По одной чистой функции на обе стороны —
// и это главное в модуле: правило «забираем всё, кроме спрятанного, но не больше,
// чем унесём» не должно быть написано дважды, как и правило «людей уводят,
// скольких устережёт отряд». Одностороннее правило игрок раскусит за день, а две
// копии одного правила расходятся молча при первой же правке. Поверх обоих — одна
// дверь участи взятого города (`fate`): кто бы и чей бы город ни взял, делит его она.
//
// Никакого состояния, часов и `Math.random`: тот же склад, тот же тайник и та
// же грузоподъёмность дают тот же дележ, и сервер потом получит его же.
import type { ResourceId } from '@/game/types';
import { seeded } from '@/game/sim/random';
import type { Fallen, Fate, Loot } from './types';
import { UNIT_BY_ID } from './data/units';
import {
  BURN_IMMUNE,
  BURN_LEVELS,
  BURN_POP_SHARE,
  FALL_BUILDINGS,
  FALL_LEVELS,
  LED_POP_SHARE,
} from './data/tuning';

export type { Fate };

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

/** Открытая часть склада: что лежит сверх тайника, по припасам и всего. */
function openOf(stock: Loot, stash: number): { parts: [ResourceId, number][]; total: number; hidden: number } {
  const floorStash = Math.max(0, stash);
  const parts: [ResourceId, number][] = [];
  let total = 0;
  let hidden = 0;
  for (const [key, value] of Object.entries(stock) as [ResourceId, number | undefined][]) {
    const have = Math.max(0, Math.floor(value ?? 0));
    if (have <= 0) continue;
    hidden += Math.min(have, floorStash);
    const free = have - Math.min(have, floorStash);
    if (free <= 0) continue;
    parts.push([key, free]);
    total += free;
  }
  return { parts, total, hidden };
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
  const { parts: open, total: openTotal, hidden: hiddenTotal } = openOf(stock, stash);
  const take = Math.min(openTotal, Math.max(0, Math.floor(carry)));
  const taken: Loot = {};
  if (take > 0) {
    // Целые доли, потом остаток — тем, у кого дробная часть больше. Порядок при
    // равенстве задаёт сам склад, а он перебирается всегда одинаково.
    const shares = open.map(([r, n]) => {
      const exact = (n / openTotal) * take;
      const whole = Math.floor(exact);
      return { r, n, whole, frac: exact - whole };
    });
    let rest = take - shares.reduce((sum, p) => sum + p.whole, 0);
    for (const p of [...shares].sort((a, b) => b.frac - a.frac)) {
      if (rest <= 0) break;
      if (p.whole >= p.n) continue;
      p.whole += 1;
      rest -= 1;
    }
    for (const p of shares) if (p.whole > 0) taken[p.r] = p.whole;
  }
  return {
    taken,
    takenTotal: Object.values(taken).reduce((n, v) => n + (v ?? 0), 0),
    hiddenTotal,
    spilledTotal: openTotal - take,
  };
}

export interface Led {
  /** Скольких увёл победитель. */
  taken: number;
  /** Сколько осталось хозяину: столько отряд не устерёг. */
  left: number;
}

/**
 * Кого уводит победитель: скольких устережёт отряд (`stackEscort`). Правило то же,
 * что у склада, и написано оно рядом по той же причине: одно на обе стороны.
 *
 * Уводят только на той ступени участи, которая уводит людей (`FATES`), — и зовётся
 * эта функция поэтому только из двери участи (`fate`): сперва на невольников города,
 * потом на горожан, тем конвоем, что остался.
 */
export function lead(people: number, escort: number): Led {
  const have = Math.max(0, Math.floor(people));
  const taken = Math.min(have, Math.max(0, Math.floor(escort)));
  return { taken, left: have - taken };
}

// ------------------------------------------------------ участь города ---

/**
 * Сколько добра стоит в обозе один уведённый человек. Не новое число, а курс, который
 * в игре уже есть: воин везёт `carry` добра или ведёт `escort` людей.
 */
export const HEAD_CARRY = UNIT_BY_ID.warrior.carry / UNIT_BY_ID.warrior.escort;

interface FateRule {
  /** Достаётся ли победителю добро и казна. Сожжение не берёт ничего. */
  spoils: boolean;
  /** Уводит ли он невольников города — всех, первыми, скольких устережёт. */
  bonded: boolean;
  /** Какую долю горожан он уводит — тем конвоем, что остался после невольников. */
  ledPop: number;
  /** Какая доля горожан расходится сама, без победителя. */
  scatterPop: number;
  /** Разбегаются ли невольники — все, никому. */
  scatterBonded: boolean;
  /** Сколько построек теряет уровень — `Infinity` значит все, — и по сколько. */
  buildings: number;
  levels: number;
  /** Сгорают ли улучшения в работе. */
  burnsWorks: boolean;
  /**
   * Можно ли объявить её логову и двору мира. Сжечь можно только город игрока: у
   * логова и двора нет ни построек, ни партии, которую можно отбросить.
   */
  vsWorld: boolean;
  /** Закрывает ли она город от себя же на `BURN_IMMUNE` — защита от цепочки. */
  chain: boolean;
}

/**
 * Что делает каждая ступень (docs/DEFEAT_LADDER.md). Числа решены владельцем, а не
 * подобраны, и лежат в `data/tuning.ts`; их цена меряется `npm run sack:report`,
 * раздел «лестница».
 *
 * - **Ограбить** — склад и казна до тайника, сколько унесёт обоз; невольники
 *   остаются; `FALL_BUILDINGS` построек теряют по `FALL_LEVELS` уровня.
 * - **Ограбить и увести людей** — то же плюс невольники города и доля горожан
 *   `LED_POP_SHARE`, в пределах конвоя; каждый уведённый занимает в обозе место
 *   `HEAD_CARRY` добра.
 * - **Сжечь** — победителю ничего; всё сверх тайника сгорает, доля горожан
 *   `BURN_POP_SHARE` расходится, невольники разбегаются, все постройки теряют по
 *   `BURN_LEVELS` уровня, улучшения в работе сгорают. `FALL_BUILDINGS` здесь не
 *   действует — вместо него, а не вдобавок.
 */
export const FATES: Record<Fate, FateRule> = {
  plunder: {
    spoils: true,
    bonded: false,
    ledPop: 0,
    scatterPop: 0,
    scatterBonded: false,
    buildings: FALL_BUILDINGS,
    levels: FALL_LEVELS,
    burnsWorks: false,
    vsWorld: true,
    chain: false,
  },
  captives: {
    spoils: true,
    bonded: true,
    ledPop: LED_POP_SHARE,
    scatterPop: 0,
    scatterBonded: false,
    buildings: FALL_BUILDINGS,
    levels: FALL_LEVELS,
    burnsWorks: false,
    vsWorld: true,
    chain: false,
  },
  burn: {
    spoils: false,
    bonded: false,
    ledPop: 0,
    scatterPop: BURN_POP_SHARE,
    scatterBonded: true,
    buildings: Infinity,
    levels: BURN_LEVELS,
    burnsWorks: true,
    vsWorld: false,
    chain: true,
  },
};

/** Ступени по порядку тяжести — так их и показывают. */
export const FATE_IDS: readonly Fate[] = ['plunder', 'captives', 'burn'];

/**
 * Участь, которую никто не объявлял: так берут город логово и двор мира, и так
 * читаются приказ и окно осады из сохранения, сделанного до лестницы.
 */
export const FATE_DEFAULT: Fate = 'plunder';

export type { Fallen };

export interface FateInput {
  fate: Fate;
  /** Склад целиком, вместе со спрятанным. Казны здесь нет — она своим полем. */
  stock: Loot;
  /** Казна. Прячется тем же тайником и уносится тем же обозом, что и склад. */
  gold: number;
  /** Сколько каждого припаса — и столько же золота — прячет тайник. */
  stash: number;
  /** Горожане: их уводят и они расходятся. Последний не уходит никогда. */
  pop: number;
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
  /**
   * Что потерял город, положительными числами. У грабежа — ровно взятое победителем
   * (`taken`); у сожжения победитель не берёт ничего, а город теряет всё сверх
   * тайника — сгорело.
   */
  lost: Loot;
  lostTotal: number;
  /** Скольких невольников города увели и сколько осталось. */
  ledBonded: Led;
  /** Скольких горожан увели в невольники; `left` — сколько из объявленной доли конвой не устерёг. */
  ledPop: Led;
  /**
   * Сколько добра не взяли из-за уведённых: `HEAD_CARRY` за каждого. Вычитается из
   * открытого склада ровно один раз, а не из обоза: иначе сильное войско уводило бы
   * людей бесплатно.
   */
  lessGoods: number;
  /** Кто ушёл сам, без победителя: горожане и невольники. */
  scattered: { pop: number; bonded: number };
  /**
   * На какие постройки пришёлся удар — все выбранные, в порядке выбора, и те,
   * что уже стоят на первом уровне (`from === to`): ниже первого не падает ничто.
   */
  fallen: Fallen[];
  /** Сгорают ли улучшения в работе. */
  burnsWorks: boolean;
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
 * здесь, на всех трёх ступенях, а зовут её все места, где город взят: прорвавшийся
 * набег, падение нашего города голодом, наш набег на двор и падение чужого города
 * под нашим лагерем. Своего дележа ни у одного из них нет — это тест по исходнику.
 *
 * Мятеж сюда не ходит: победителя там нет и выбирать участь некому, склад он
 * делит тем же `plunder`, но казну не трогает (`game/sim/mutiny`).
 *
 * Арифметика — `plunder` и `lead` без единой правки: казна входит в дележ восьмым
 * припасом, с тем же тайником и тем же обозом; люди уводятся тем же `lead`, сперва
 * невольники, потом горожане.
 */
export function fate(input: FateInput): FateResult {
  const rule = FATES[input.fate];
  const all: Loot = { ...input.stock, gold: input.gold };
  const pop = Math.max(0, Math.floor(input.pop));
  const bonded = Math.max(0, Math.floor(input.bonded));
  // Последний горожанин не уходит никогда — ни с победителем, ни сам.
  const movable = Math.max(0, pop - 1);
  const ledBonded = rule.bonded ? lead(bonded, input.escort) : { taken: 0, left: bonded };
  const ledPop =
    rule.ledPop > 0
      ? lead(Math.min(movable, Math.floor(pop * rule.ledPop)), Math.max(0, input.escort - ledBonded.taken))
      : { taken: 0, left: 0 };
  const lessGoods = HEAD_CARRY * (ledBonded.taken + ledPop.taken);
  // Добро делится один раз. У грабежа — не больше обоза и не больше того, что
  // осталось на виду после мест, отданных людям; у сожжения огню обоз не нужен.
  const carry = rule.spoils ? Math.min(input.carry, Math.max(0, openOf(all, input.stash).total - lessGoods)) : Infinity;
  const spoils = plunder(all, input.stash, carry);
  return {
    taken: rule.spoils ? spoils.taken : {},
    takenTotal: rule.spoils ? spoils.takenTotal : 0,
    hiddenTotal: spoils.hiddenTotal,
    spilledTotal: spoils.spilledTotal,
    lost: spoils.taken,
    lostTotal: spoils.takenTotal,
    ledBonded,
    ledPop,
    lessGoods,
    scattered: {
      pop: rule.scatterPop > 0 ? Math.min(movable, Math.floor(pop * rule.scatterPop)) : 0,
      bonded: rule.scatterBonded ? bonded : 0,
    },
    fallen: pickFallen(input.levels ?? {}, input.seed, rule),
    burnsWorks: rule.burnsWorks,
  };
}

/**
 * Какие постройки теряют уровень. Выбор — перестановка списка по соли, а
 * список упорядочен по ключу, а не по тому, как его собрали: одна соль и один
 * набор построек дают один и тот же выбор на любой стороне. Под удар «всех» идут
 * все — по ключу, без перестановки: выбирать там нечего.
 */
function pickFallen(levels: Record<string, number>, seed: number, rule: FateRule): Fallen[] {
  if (rule.buildings <= 0 || rule.levels <= 0) return [];
  const ids = Object.keys(levels).sort();
  if (rule.buildings < ids.length) {
    const rng = seeded(seed);
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
  }
  return ids.slice(0, rule.buildings).map((id) => {
    const from = Math.max(1, Math.floor(levels[id]));
    return { id, from, to: Math.max(1, from - rule.levels) };
  });
}

/**
 * Что теряет наш взятый город — полями последствия для племени. Одно место на
 * оба пути поражения (прорвавшийся набег и голод), чтобы увод, пожар и падение
 * уровней не доезжали в племя одним путём и не доезжали другим.
 */
export function homeLoss(r: FateResult): {
  resources: Loot;
  bonded?: number;
  popLost?: number;
  fallen?: Fallen[];
  burned?: boolean;
} {
  const bonded = r.ledBonded.taken + r.scattered.bonded;
  const pop = r.ledPop.taken + r.scattered.pop;
  return {
    resources: asLoss(r.lost),
    ...(bonded > 0 ? { bonded: -bonded } : {}),
    ...(pop > 0 ? { popLost: pop } : {}),
    ...(r.fallen.length > 0 ? { fallen: r.fallen } : {}),
    ...(r.burnsWorks ? { burned: true } : {}),
  };
}

/**
 * Что достаётся победителю — полями последствия для его племени: добро и казна, и
 * все уведённые — невольниками. У сожжения здесь пусто.
 */
export function winnerGain(r: FateResult): { resources: Loot; bonded?: number } {
  const led = r.ledBonded.taken + r.ledPop.taken;
  return { resources: r.taken, ...(led > 0 ? { bonded: led } : {}) };
}

/** То же взятое, но со знаком минус: так добыча приезжает в племя, у которого её отняли. */
export function asLoss(taken: Loot): Loot {
  const out: Loot = {};
  for (const [key, value] of Object.entries(taken) as [ResourceId, number | undefined][]) {
    if ((value ?? 0) > 0) out[key] = -(value as number);
  }
  return out;
}

// ------------------------------------------------ защита от цепочки ---

/** До какой минуты сожжённый город нельзя сжечь снова. Тот же приём, что `siege.immuneUntil`. */
export const burnImmuneUntil = (burnedAt: number): number => burnedAt + BURN_IMMUNE;

/**
 * Держится ли ещё неприкосновенность от огня (`BURN_IMMUNE`). Закрывает ступень с `chain`, а
 * не грабёж: ограбить и увести людей в это время можно.
 */
export const burnImmune = (until: number | undefined, now: number): boolean => now < (until ?? 0);

/** Кого берут: город игрока или логово и двор мира. */
export type FateTarget = 'player' | 'world';

/**
 * Можно ли объявить эту участь этой цели в эту минуту. null — можно, иначе причина
 * словами. Одна проверка на приказ и на падение: приказ отказывает до нажатия, а
 * падение, до которого не дойти приказом, подменяет недоступное умолчанием (`fateAt`).
 */
export function fateBlock(f: Fate, target: FateTarget, burnUntil: number | undefined, now: number): string | null {
  const rule = FATES[f];
  if (!rule.vsWorld && target === 'world') {
    return 'Сжечь можно только город игрока: у логова и двора нет ни построек, ни партии, которую можно отбросить.';
  }
  if (rule.chain && burnImmune(burnUntil, now)) {
    const hours = Math.max(1, Math.ceil(((burnUntil ?? 0) - now) / 3_600_000));
    return `Город сожгли меньше суток назад: сжечь снова можно через ${hours} ч. Ограбить и увести людей — можно.`;
  }
  return null;
}

/** Какой участью кончится взятие: объявленной, если она ещё доступна, иначе умолчанием. */
export const fateAt = (declared: Fate | undefined, target: FateTarget, burnUntil: number | undefined, now: number): Fate => {
  const f = declared ?? FATE_DEFAULT;
  return fateBlock(f, target, burnUntil, now) ? FATE_DEFAULT : f;
};
