// Мораль армии между боями (docs/battle_eu4.md, 14.30–14.31; слово владельца, как в EU4). После боя мораль армии
// просела, со временем восстанавливается, и армия, брошенная в новый бой сразу, слабее.
//
// Хранится пара «сколько было и когда» — доля полной морали, с которой уцелевшие вышли из боя (`SideResult.rest`, её
// считает ядро), минута боя на часах мира и сколько их было, в бойцах строя. Нынешнее значение — чистая функция от
// времени, тика и накопителя нет, и догон офлайна ничего не делает. Форма — как у EU4: прямая по времени, одна скорость
// на любую недостачу; числа EU4 не переносятся.
//
// **Срок от нуля до полной — срок лазарета** (`WOUND_DAYS`, слово владельца): смысл тот же, отдых после боя, — армия
// отдыхает, пока лежат её раненые. Читается из одного места, где он определён; правка лазарета сдвинет и мораль.
//
// **Пришли люди — свежие:** армия, в которой сейчас бойцов больше, чем вышло из боя, разбавлена теми, кто в нём не
// дрался. **Ушли — доля та же:** уходят поровну уставшие и отдохнувшие. Переход людей между гарнизоном и дружиной —
// дело мира (`LocalWorld.setGarrison`), и усталость переходит с ними (`carryRest`).
import { WOUND_DAYS } from '@/game/constants';
import { worldDays } from '@/game/pace';
import type { RestView } from './types';

/** Пара морали армии: доля полной морали уцелевших (0..1), минута боя на часах мира, их число в бойцах строя. */
export interface RestPair {
  share: number;
  at: number;
  men: number;
}

/** Срок от нуля морали до полной — срок лазарета (слово владельца), на часах мира. */
export const REST_FULL = worldDays(WOUND_DAYS);

/** Доля полной морали тех, кто вышел из боя, в минуту `now`: прямая до полной за `REST_FULL`, в пути и стоя одинаково. */
const tiredAt = (pair: RestPair, now: number): number =>
  Math.min(1, Math.max(0, pair.share) + Math.max(0, now - pair.at) / REST_FULL);

/**
 * Доля полной морали армии в минуту `now` — одна дверь на все чтения: бой, карточка, меню, окна осады, автопилот.
 * `men` — сколько в армии бойцов строя сейчас: сверх вышедших из боя — свежие. Нет пары — полная.
 */
export function restAt(pair: RestPair | undefined, now: number, men?: number): number {
  if (!pair) return 1;
  const r = tiredAt(pair, now);
  if (men === undefined || men <= pair.men || men <= 0) return r;
  return (pair.men * r + (men - pair.men)) / men;
}

/** Когда мораль станет полной, мс на часах мира. Полная уже — `now`. */
export function restFullAt(pair: RestPair | undefined, now: number): number {
  if (!pair) return now;
  return Math.max(now, pair.at + Math.max(0, 1 - Math.max(0, pair.share)) * REST_FULL);
}

/** Мораль армии глазами игрока: доля сейчас (до сотых) и когда станет полной. Свежая — вида нет. */
export function restView(pair: RestPair | undefined, now: number, men?: number): RestView | undefined {
  const share = restAt(pair, now, men);
  if (share >= 1) return undefined;
  return { share: Math.floor(share * 100) / 100, fullAt: restFullAt(pair, now) };
}

/** Пара после боя: доля, с которой уцелевшие вышли, минута боя и сколько их. Вышли свежими или не вышел никто — пары нет. */
export function restAfter(share: number, at: number, men: number): RestPair | undefined {
  return share >= 1 || men <= 0 ? undefined : { share: Math.max(0, share), at, men };
}

/** Доля стороны из нескольких частей (гарнизон, дружина у ворот, ополчение): взвешена бойцами строя. Пусто — полная. */
export function mixRest(parts: readonly { rest: number; men: number }[]): number {
  const men = parts.reduce((n, p) => n + Math.max(0, p.men), 0);
  if (men <= 0) return 1;
  return parts.reduce((n, p) => n + Math.max(0, p.men) * p.rest, 0) / men;
}

/**
 * Часть армии дралась и вернулась: `army` — сколько в армии было до боя, `went` — сколько из них дралось, `back` —
 * сколько из дравшихся уцелело, `share` — с какой долей полной морали они вышли из боя (`SideResult.rest`). Не дравшиеся
 * остаются со своей моралью, вернувшиеся — с долей боя; новая пара — на минуту боя. Дралась вся армия — пара боя.
 */
export function rejoin(pair: RestPair | undefined, now: number, army: number, went: number, back: number, share: number): RestPair | undefined {
  const stayed = Math.max(0, army - Math.max(0, went));
  const home = Math.max(0, back);
  const mixed = mixRest([
    { rest: restAt(pair, now, army), men: stayed },
    { rest: share, men: home },
  ]);
  return restAfter(mixed, now, stayed + home);
}

/**
 * Люди перешли из одной армии в другую (сбор дружины и роспуск её в гарнизон): новая пара принимающей армии в минуту
 * `now` — её оставшиеся со своей долей и пришедшие с долей той армии, откуда пришли, вместе. Прошлое не переписывается:
 * до `now` пара читалась бы так же, а дальше обе части отдыхают одной прямой.
 */
export function carryRest(
  kept: { pair: RestPair | undefined; men: number; of: number },
  came: { pair: RestPair | undefined; men: number; of: number },
  now: number,
): RestPair | undefined {
  // `of` — сколько было в армии, из которой берут: уходят и остаются поровну уставшие и свежие, и доля у части та же,
  // что у всей армии в эту минуту.
  const men = Math.max(0, kept.men) + Math.max(0, came.men);
  const share = mixRest([
    { rest: restAt(kept.pair, now, kept.of), men: kept.men },
    { rest: restAt(came.pair, now, came.of), men: came.men },
  ]);
  return restAfter(share, now, men);
}
