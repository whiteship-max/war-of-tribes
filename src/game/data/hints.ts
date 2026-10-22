// Подсказки новичку по ходу игры (docs/rating.md): не обучение, а пять коротких плашек, каждая — когда к ней пора по
// состоянию города, один раз. Только данные: что сказать, у какого элемента и когда. Показывает `ui/next/Hints.tsx`,
// отметки «показана» и «выключены» — `sim/hints`.
//
// Порядок — порядок важности для первого дня: улучшить постройку → нанять дружину → соседи на карте → поход →
// промыслы и энергия; мятеж — первым, когда случится. Из готовых к показу встаёт первая непоказанная.
import type { GameState } from '../types';
import { armySize, currentSite, recruitsQueued, upgradeInfo } from '../derived';
import { MUTINY_EVENT } from './order';
import { STAB_EVENTS } from './stability';

export type HintId = 'revolt' | 'upgrade' | 'army' | 'neighbors' | 'march' | 'games';

/**
 * Куда ведёт ссылка подсказки — имя двери интерфейса, а не сама дверь: данные интерфейса не знают. Ссылка ведёт туда же,
 * куда кнопка, у которой подсказка встаёт (UI-8, Д1, docs/ui_v2.md, 5.7): одна кнопка — одно место.
 */
export type HintGo = 'townhall' | 'army' | 'map' | 'trades' | 'mail';

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
  // Первый мятеж (СБ-1, docs/stability.md, 2.10; docs/onboarding.md): срочнее всего прочего — встаёт первой, у «Вестей», где он
  // ждёт ответа, и ведёт в раздел, где сказано, отчего он.
  {
    id: 'revolt',
    title: 'Мятеж',
    body: 'Город поднялся: ответ ждёт в «Вестях». Отчего недовольны и как не допустить нового — в державе, «Стабильность».',
    anchor: '[data-tut="nav-mail"]',
    // Туда же, куда кнопка «Вести», у которой подсказка стоит: одна кнопка — одно место (Д1).
    link: { label: 'Вести', go: 'mail' },
    due: (s) => s.inbox.some((e) => e.defId === MUTINY_EVENT || STAB_EVENTS.includes(e.defId)),
  },
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
    body: 'Бойцов нанимают в казармах — кнопка «Нанять» в окне дружины. Без дружины не отбить набег и не выйти в поход.',
    anchor: '[data-tut="nav-army"]',
    // Прежде ссылка вела в казармы, а кнопка «Дружина», у которой подсказка стоит, — в «Дружину» (Д1).
    link: { label: 'Дружина', go: 'army' },
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
