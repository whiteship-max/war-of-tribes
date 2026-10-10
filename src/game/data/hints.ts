// Подсказки новичку по ходу игры (docs/rating.md): не обучение, а пять коротких плашек, каждая — когда к ней пора по
// состоянию города, один раз. Только данные: что сказать, у какого элемента и когда. Показывает `ui/next/Hints.tsx`,
// отметки «показана» и «выключены» — `sim/hints`.
//
// Порядок — порядок важности для первого дня: улучшить постройку → нанять дружину → соседи на карте → поход →
// промыслы и энергия. Из готовых к показу встаёт первая непоказанная.
import type { GameState } from '../types';
import { armySize, currentSite, recruitsQueued, upgradeInfo } from '../derived';

export type HintId = 'upgrade' | 'army' | 'neighbors' | 'march' | 'games';

/** Куда ведёт ссылка подсказки — имя двери интерфейса, а не сама дверь: данные интерфейса не знают. */
export type HintGo = 'townhall' | 'barracks' | 'map' | 'trades';

/** Что интерфейс знает сверх партии. */
export interface HintCtx {
  /** Городов других игроков в реестре рядом. */
  others: number;
  /** Энергия промыслов полна. */
  energyFull: boolean;
}

export interface HintDef {
  id: HintId;
  title: string;
  body: string;
  /** Элемент, у которого встаёт плашка, — селектором; нет его на экране — подсказка ждёт. */
  anchor: string;
  link: { label: string; go: HintGo };
  /** Пора ли. Проверяется, пока подсказка не показана. */
  due: (s: GameState, ctx: HintCtx) => boolean;
}

/** Бойцов меньше этого — пора сказать про дружину. Десяток — столько держит казарма с первого уровня без забот. */
export const HINT_ARMY = 10;

/** Бойцов не меньше этого — пора сказать про поход: с двумя десятками уже есть с чем идти на логово. */
export const HINT_MARCH = 20;

export const HINTS: readonly HintDef[] = [
  {
    id: 'upgrade',
    title: 'Улучши постройку',
    body: 'Город растёт уровнями построек. Что готово к стройке, видно в ратуше.',
    anchor: '[data-tut="nav-townhall"]',
    link: { label: 'Ратуша', go: 'townhall' },
    due: (s) => currentSite(s) === null && s.buildings.some((b) => upgradeInfo(s, b).blocked === null),
  },
  {
    id: 'army',
    title: 'Найми дружину',
    body: 'Бойцов нанимают в казармах, оружие куёт кузница. Без дружины не отбить набег и не выйти в поход.',
    anchor: '[data-tut="nav-army"]',
    link: { label: 'Казармы', go: 'barracks' },
    due: (s) => armySize(s) + recruitsQueued(s) < HINT_ARMY,
  },
  {
    id: 'neighbors',
    title: 'Соседи',
    body: 'На карте — города соседей. Нажми на город и увидишь, кто там правит и сколько у него сил.',
    anchor: '[data-tut="nav-map"]',
    link: { label: 'Карта', go: 'map' },
    due: (_s, ctx) => ctx.others > 0,
  },
  {
    id: 'march',
    title: 'Поход',
    body: 'Поход ведёт полководец. Нажми на карте логово или город, потом «Дойти и ударить» или «Осадить».',
    anchor: '[data-tut="nav-map"]',
    link: { label: 'Карта', go: 'map' },
    due: (s) => armySize(s) >= HINT_MARCH,
  },
  {
    id: 'games',
    title: 'Промыслы и энергия',
    body: 'Промысел — короткая игра за стеной, добыча идёт на склад. Каждый тратит энергию, а она копится сама.',
    anchor: '.nx-hen',
    link: { label: 'Промыслы', go: 'trades' },
    due: (s, ctx) => ctx.energyFull && (s.stats.games ?? 0) === 0,
  },
];
