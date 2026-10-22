// «К источнику» (docs/ui_v2.md, раздел 2): у каждого запаса и показателя есть дверь туда, где число делается и где его
// меняют, — постройка или окно. Здесь только данные и слова, без хранилищ: куда вести, решает этот модуль, а ведёт
// `kit/nav.goTo`. Тест сверяет и то и другое с данными игры и с подсказками верха (`kit.test.ts`).
import type { BuildingTypeId, ResourceId } from '@/game/types';
import type { Tab } from '@/game/store';
import type { RealmView } from '@/ui/realm/open';
import { RESOURCE_IDS } from '@/game/constants';
import { JOBS } from '@/game/data/jobs';
import { BUILDINGS, BUILDING_BY_ID, type BuildingStats } from '@/game/data/buildings';
import { TROOP_IDS } from '@/game/data/troops';
import { maxLevelFor } from '@/game/derived';
import { hiredAt } from '@/game/sim/army';
import { statAt } from '@/game/train';

/** Куда ведёт дверь: постройка (по типу — их одна на город), раздел шторки, раздел державы или окно промыслов. */
export type Source =
  | { kind: 'building'; type: BuildingTypeId }
  | { kind: 'tab'; tab: Tab }
  | { kind: 'realm'; view: RealmView }
  | { kind: 'trades' }
  // «Сокровищница» на вкладке «Купить»: алмазы город не добывает — их покупают.
  | { kind: 'treasury' }
  // «Здания» низа (РТ-1): сетка всех построек — дверь «Построить» и «Улучшить» туда, где их заказывают.
  | { kind: 'build' };

/** Показатели верхней строки и сводки «Жителей» (оборона, docs/ui_v2.md, 5.4) — у каждого свой источник (`WINDOW`). */
// Плашка алмазов — `treasury`: ключа `gems:` в объектах клиента нет нигде (замок `sim/gems.test.ts`).
export type Indicator = 'gold' | 'pop' | 'morale' | 'order' | 'army' | 'energy' | 'season' | 'treasury' | 'defense';
export type SourceKey = ResourceId | Indicator;

/**
 * Окно числа — где оно видно целиком и где его меняют. У запаса это склад: там весь список, вместимость и прирост; кто
 * запас делает — `producersOf`. У показателя — его справочный раздел или окно рычагов. Слово двери — `sourceWord`.
 */
export const WINDOW: Readonly<Record<SourceKey, Source>> = {
  ...(Object.fromEntries(RESOURCE_IDS.map((r) => [r, { kind: 'building', type: 'storage' }])) as Record<ResourceId, Source>),
  gold: { kind: 'realm', view: 'government' },
  pop: { kind: 'tab', tab: 'pop' },
  morale: { kind: 'tab', tab: 'morale' },
  order: { kind: 'tab', tab: 'order' },
  army: { kind: 'tab', tab: 'army' },
  energy: { kind: 'trades' },
  season: { kind: 'tab', tab: 'season' },
  treasury: { kind: 'treasury' },
  // Оборону видно целиком и меняют гарнизоном в «Дружине»; стены и башню — кнопками постройки (`makersOf`).
  defense: { kind: 'tab', tab: 'army' },
};

/** Слова дверей, которые ведут не в постройку: подписи разделов — те же, что у ссылок подсказок верха. */
const TAB_WORD: Readonly<Record<Tab, string>> = {
  people: 'Жители',
  quests: 'Задания',
  season: 'Сезон',
  pop: 'Прирост',
  morale: 'Мораль',
  order: 'Порядок',
  army: 'Дружина',
  buildings: 'Здания',
};
const REALM_WORD: Readonly<Partial<Record<RealmView, string>>> = {
  lineage: 'Правитель',
  government: 'Указы',
  tech: 'Технологии',
  faith: 'Вера',
  quests: 'Задания',
  decisions: 'Вести',
  settings: 'Настройки',
};

/** Подпись двери: имя постройки из данных игры, раздела — словом раздела. */
export function sourceWord(src: Source): string {
  switch (src.kind) {
    case 'building':
      return BUILDING_BY_ID[src.type].name;
    case 'tab':
      return TAB_WORD[src.tab];
    case 'realm':
      return REALM_WORD[src.view] ?? 'Держава';
    case 'trades':
      return 'Промыслы';
    case 'treasury':
      return 'Сокровищница';
    case 'build':
      return 'Здания';
  }
}

/**
 * Какие постройки делают запас — из таблицы профессий (`JOBS`: выработка и профильное здание), а не списком рукой.
 * Вольный сбор (`freeRange`) идёт и без двора — с площади, поэтому его профессии приводят и туда. Порядок — как в
 * таблице профессий; повторов нет.
 */
export function producersOf(r: ResourceId): BuildingTypeId[] {
  const out: BuildingTypeId[] = [];
  for (const job of JOBS) {
    if (!(job.yield[r] ?? 0)) continue;
    if (job.building && !out.includes(job.building)) out.push(job.building);
    if (job.freeRange && !out.includes('campfire')) out.push('campfire');
  }
  return out;
}

/** Дверь к постройке по типу. */
export const toBuilding = (type: BuildingTypeId): Source => ({ kind: 'building', type });

/** Постройки, у которых этот пассив есть хоть на каком-то уровне (`statAt` на потолке), — порядком таблицы построек. */
const withStat = (key: keyof BuildingStats): BuildingTypeId[] =>
  BUILDINGS.filter((d) => statAt(d.id, key, maxLevelFor(d.id)) > 0).map((d) => d.id);

/**
 * Какие постройки делают число верхней строки — главные кнопки его подсказки (docs/ui_v2.md, 5.2). Из данных игры, а не
 * списком рукой: запас — `producersOf`; жители — постройки с жильём (жильё — их предел и рычаг); мораль — постройки с
 * моралью и пиром; дружина — где учат каждый вид (`hiredAt`); оборона — постройки с обороной (стены, башня; 5.4).
 * Золото, энергию, алмазы, порядок и сезон не делает ни одна постройка: у них только окно (`WINDOW`).
 */
export function makersOf(key: SourceKey): BuildingTypeId[] {
  if ((RESOURCE_IDS as string[]).includes(key)) return producersOf(key as ResourceId);
  switch (key) {
    case 'pop':
      return withStat('housing');
    case 'morale': {
      const lift = new Set([...withStat('morale'), ...withStat('feast')]);
      return BUILDINGS.map((d) => d.id).filter((id) => lift.has(id));
    }
    case 'army':
      return [...new Set(TROOP_IDS.map(hiredAt))];
    case 'defense':
      return withStat('defense');
    default:
      return [];
  }
}
