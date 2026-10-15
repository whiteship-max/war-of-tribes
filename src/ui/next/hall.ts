// Ратуша «Стройка» одной сеткой (docs/ui_v2.md, раздел 5, UI-2): что знает плитка постройки, группы и порядок. Чистые
// функции без React — тест сверяет их с числами игры (`hall.test.ts`). Своих чисел нет (правило 18): уровень, места,
// выход, срок и «можно ли» — `derived`, тем же `upgradeInfo`, что гасит кнопку и решает в `startUpgrade`.
import type { Building, BuildingTypeId, GameState, ResourceId } from '@/game/types';
import { RESOURCE_IDS } from '@/game/constants';
import { BUILDINGS, BUILDING_BY_ID } from '@/game/data/buildings';
import { JOB_BY_ID } from '@/game/data/jobs';
import {
  buildRate,
  buildingProduction,
  buildingSlots,
  buildingTitle,
  currentSite,
  handsCount,
  isSite,
  maxLevelFor,
  upgradeInfo,
} from '@/game/derived';
import { asGame, type GameSec } from '@/game/pace';

// ---------- Группы ----------

export type HallGroup = 'food' | 'raw' | 'war' | 'home';

/** Группы — порядком сетки. «Жильё» — жильё и службы города: всё, что не двор и не война. */
export const HALL_GROUPS: readonly { id: HallGroup; label: string; icon: { name: string; glyph: string } }[] = [
  { id: 'food', label: 'Еда', icon: { name: 'res-food', glyph: '🍖' } },
  { id: 'raw', label: 'Сырьё', icon: { name: 'res-wood', glyph: '🌲' } },
  { id: 'war', label: 'Война', icon: { name: 'hud-army', glyph: '⚔️' } },
  { id: 'home', label: 'Жильё', icon: { name: 'bld-houses', glyph: '🏘️' } },
];

/**
 * Постройки войны: оборона, войско, его снаряжение, разведка и раненые. Дворы сюда не попадают — их группа выводится из
 * выработки профессии (`groupOf`), а не списком; остальное, не война и не двор, — «Жильё».
 */
export const WAR: ReadonlySet<BuildingTypeId> = new Set<BuildingTypeId>([
  'palisade',
  'tower',
  'barracks',
  'stable',
  'smithy',
  'watch',
  'statue',
  'infirmary',
]);

/** Что делает профессия постройки: ресурсы её выработки (таблица профессий), пусто — постройка не двор. */
export function yieldsOf(type: BuildingTypeId): ResourceId[] {
  const job = BUILDING_BY_ID[type].job;
  if (!job) return [];
  const y = JOB_BY_ID[job].yield;
  return RESOURCE_IDS.filter((r) => (y[r] ?? 0) > 0);
}

/** Группа постройки: двор с едой — «Еда», прочий двор — «Сырьё»; не двор — «Война» или «Жильё». */
export function groupOf(type: BuildingTypeId): HallGroup {
  const res = yieldsOf(type);
  if (res.includes('food')) return 'food';
  if (res.length > 0) return 'raw';
  return WAR.has(type) ? 'war' : 'home';
}

// ---------- Плитка ----------

/** Где постройка в деле стройки: строится первой, ждёт очереди, можно улучшить, нельзя, на потолке. */
export type HallState = 'site' | 'queued' | 'ready' | 'locked' | 'top';

export interface HallTile {
  b: Building;
  group: HallGroup;
  name: string;
  level: number;
  max: number;
  /** Руки на местах — вольные, невольники и мастера; `null` — у постройки нет мест. */
  hands: number | null;
  slots: number;
  /** Главный ресурс выработки и его выход за игровой день (`buildingProduction`); `null` — не двор. */
  out: { r: ResourceId; perDay: number } | null;
  /** Весь выход за день, всеми ресурсами, — для порядка «Выход». */
  outSum: number;
  state: HallState;
  /** Срок первой стройки в игровых секундах; `null` — не строится первой или строить некому. */
  eta: GameSec | null;
  /** Доля стройки, 0…100. */
  share: number;
  /** Почему нельзя улучшить (`upgradeInfo.blocked`); `null` — можно. */
  why: string | null;
}

export function hallTile(s: GameState, b: Building, rate: number = buildRate(s), first: Building | null = currentSite(s)): HallTile {
  const up = upgradeInfo(s, b);
  const max = maxLevelFor(b.type);
  const slots = buildingSlots(b);
  const res = yieldsOf(b.type);
  const prod = res.length > 0 ? buildingProduction(s, b) : null;
  const site = isSite(b);
  const state: HallState = site
    ? first !== null && first.id === b.id
      ? 'site'
      : 'queued'
    : b.level >= max
      ? 'top'
      : up.blocked === null
        ? 'ready'
        : 'locked';
  return {
    b,
    group: groupOf(b.type),
    name: buildingTitle(s, b.type),
    level: b.level,
    max,
    hands: slots > 0 ? handsCount(s, b.id) : null,
    slots,
    out: prod ? { r: res[0], perDay: prod[res[0]] } : null,
    outSum: prod ? res.reduce((a, r) => a + prod[r], 0) : 0,
    state,
    eta: state === 'site' && rate > 0 ? asGame(Math.max(0, b.workRequired - b.work) / rate) : null,
    share: site ? Math.floor((b.work / Math.max(1, b.workRequired)) * 100) : 0,
    why: up.blocked,
  };
}

/** Все постройки города плитками — порядком таблицы построек (`BUILDINGS`). */
export function hallTiles(s: GameState): HallTile[] {
  const rate = buildRate(s);
  const first = currentSite(s);
  return [...s.buildings].sort(byBook).map((b) => hallTile(s, b, rate, first));
}

// ---------- Порядок ----------

export type HallSort = 'group' | 'level' | 'output' | 'ready';

/** Порядки сетки — по кругу одной кнопкой «Порядок»; подпись — по чему: «готовность» — что строится и что можно заложить. */
export const HALL_SORTS: readonly { id: HallSort; label: string }[] = [
  { id: 'ready', label: 'Готовность' },
  { id: 'group', label: 'Группы' },
  { id: 'level', label: 'Уровень' },
  { id: 'output', label: 'Выход' },
];

export const nextSort = (sort: HallSort): HallSort => HALL_SORTS[(HALL_SORTS.findIndex((x) => x.id === sort) + 1) % HALL_SORTS.length].id;

const BOOK = new Map(BUILDINGS.map((d, i) => [d.id, i]));
const byBook = (a: Building, b: Building): number => (BOOK.get(a.type) ?? 99) - (BOOK.get(b.type) ?? 99);
const GROUP_RANK = new Map(HALL_GROUPS.map((g, i) => [g.id, i]));
/** «Улучшить»: что строится — первым, за ним что можно заложить сейчас, потом нельзя, потом потолок. */
const STATE_RANK: Record<HallState, number> = { site: 0, queued: 1, ready: 2, locked: 3, top: 4 };

/** Сетка в выбранном порядке; при равенстве — порядком таблицы построек, чтобы плитки не прыгали. */
export function sortTiles(tiles: readonly HallTile[], sort: HallSort): HallTile[] {
  const key = (t: HallTile): number[] => {
    switch (sort) {
      case 'group':
        return [GROUP_RANK.get(t.group) ?? 9];
      case 'ready':
        return [STATE_RANK[t.state]];
      case 'level':
        return [-t.level];
      case 'output':
        return [-t.outSum];
    }
  };
  return [...tiles].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i];
    return byBook(a.b, b.b);
  });
}

/** Сколько построек можно улучшить прямо сейчас — в группе или во всём городе. */
export const readyCount = (tiles: readonly HallTile[], group: HallGroup | 'all' = 'all'): number =>
  tiles.filter((t) => t.state === 'ready' && (group === 'all' || t.group === group)).length;
