// Специализация вольного города (ПН-Э1, docs/gdd/path_of_sword.md, 3.7.1): житница, лес, руда, кожи, ремесло — постоянной солью клетки,
// как руины и сами города (`world/roampoints`): у всех игроков у одного города одна специализация. Город дешевле продаёт и дешевле берёт
// то, что делает сам, и дороже — то, что ему нужно: множитель основы его рынка по товару (`specMult`), одна дверь на рынок с ключом
// (`sim/market` через `marketrules.specGood`) и на прибор (`roam:report`, «Торговля между городами»). «Перепродажа не в плюс» внутри
// города держится сама: покупка и продажа одного товара в одном городе — на одной основе (`market:report`); между городами плюс есть —
// его ест дорога, обоз и нажим.
//
// Размах — заглушка игры `townSpec` (ориентир ГДД ±25 %, за выключателем пути): рынок вольного города есть только у бродяги.
// Без `@/`: модуль читает прибор и может читать сервер.
import { hash2 } from './geography';
import { TOWN_SALT } from './roampoints';
import { roamStub } from '../game/roamstubs';
import type { GoodId } from '../game/types';

export type TownSpec = 'granary' | 'timber' | 'ore' | 'hides' | 'craft';

export const TOWN_SPECS: readonly TownSpec[] = ['granary', 'timber', 'ore', 'hides', 'craft'];

/**
 * Что город делает (дешевле) и что ему нужно (дороже). Пары подобраны так, чтобы у каждого товара был и делающий город, и нуждающийся:
 * хлеб — у житницы и нужен лесу и руде; дерево и уголь — у леса и нужны житнице и ремеслу; камень, медь, железо — у руды и нужны житнице,
 * кожам и ремеслу; шкуры — у кож и нужны лесу и ремеслу; ремесло само ничего не продаёт дешевле — оно берёт дорого.
 */
export const TOWN_SPEC_META: Record<TownSpec, { name: string; makes: readonly GoodId[]; wants: readonly GoodId[] }> = {
  granary: { name: 'Житница', makes: ['food'], wants: ['wood', 'iron'] },
  timber: { name: 'Лес', makes: ['wood', 'charcoal'], wants: ['food', 'hides'] },
  ore: { name: 'Руда', makes: ['stone', 'copper', 'iron'], wants: ['food', 'charcoal'] },
  hides: { name: 'Кожи', makes: ['hides'], wants: ['copper', 'iron'] },
  craft: { name: 'Ремесло', makes: [], wants: ['charcoal', 'hides', 'copper', 'iron', 'stone'] },
};

/** Соль специализации — своя у города, рядом с солями его места, ступени и имени (`roampoints.TOWN_SALT`). */
export const SPEC_SALT = TOWN_SALT + 5;

/** Специализация вольного города в клетке — постоянной солью клетки (общая для всех). */
export const townSpecOf = (x: number, y: number): TownSpec => TOWN_SPECS[Math.floor(hash2(SPEC_SALT, Math.round(x), Math.round(y)) * TOWN_SPECS.length) % TOWN_SPECS.length];

/** Множитель основы рынка города специализации `spec` по товару: делает — 1 − размах, нужен — 1 + размах, прочее — 1. */
export function specMult(spec: TownSpec, good: string, swing: number = roamStub('townSpec')): number {
  const m = TOWN_SPEC_META[spec];
  if ((m.makes as readonly string[]).includes(good)) return 1 - swing;
  if ((m.wants as readonly string[]).includes(good)) return 1 + swing;
  return 1;
}
