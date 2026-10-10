// Легенда карты — значками самой карты (docs/map_tw.md, 14.6): строки строятся теми же функциями, что и значки на
// земле (`scene.placeMarkOf`, `scene.hostMarkOf`, `marks.badgeLook`), и рисуются той же кистью (`marks.markUrl`).
// Прежняя легенда показывала силуэты миниатюр, которых на карте больше нет (`village.silhouetteUrl`, 14.2, 6).
// Кусок ленивый: легенда тянет его, когда открыта, — первая загрузка не растёт.
import { RELATION_META, STAGE_BY_ID } from '@/world/data/meta';
import type { Relation, SettlementView, Stage } from '@/world/types';
import { SIDE_COLOR } from '@/side';
import { badgeLook, markUrl, PIPS, STAGE_PIPS, type BadgeKind, type MarkLook } from './marks';
import { hostMarkOf, placeMarkOf } from './scene';

/** Строка легенды: значок, имя, пояснение. */
export interface LegendMark {
  mark: MarkLook;
  name: string;
  note?: string;
  /** Диаметр значка в легенде, CSS px: метки у места — малые, как на карте. */
  d?: number;
}

/** Место карты — как его видит сцена: только поля, от которых зависит значок. */
const place = (stage: Stage, relation: Relation, more: Partial<SettlementView> = {}): MarkLook =>
  placeMarkOf({ stage, relation, color: RELATION_META[relation].color, mine: false, ruin: false, sacked: false, ...more } as SettlementView);

/**
 * Города и логова. Разорённого двора нет (логово на победе сгорает), союзников и врагов нет — легенда не обещает того,
 * чего на карте не бывает (`legend.test.ts`).
 */
export const PLACE_ROWS: readonly LegendMark[] = [
  {
    mark: place('village', 'self', { mine: true }),
    name: 'Твой город',
    note: 'корона и золотое кольцо; гнёзда под ним — твой размер',
  },
  ...Object.values(STAGE_BY_ID).map((s) => ({
    mark: place(s.id, 'neutral'),
    name: s.name,
    note: `город соседа; ${STAGE_PIPS[s.id]} из ${PIPS} гнёзд — размер, кольцо — кто он тебе`,
  })),
  { mark: place('stronghold', 'barbarian'), name: 'Логово', note: 'разбойники; гнёзда — сколько их' },
  { mark: place('camp', 'barbarian', { ruin: true }), name: 'Пепелище', note: 'сожжённое логово, след сойдёт сам' },
];

const BADGE_ROWS: { kind: BadgeKind; name: string; note: string }[] = [
  { kind: 'attack', name: 'Под ударом', note: 'бой у стен — мигает' },
  { kind: 'troops', name: 'Свои войска', note: 'стоят у места' },
  { kind: 'siege', name: 'В осаде', note: 'вблизи — рогатки на земле' },
  { kind: 'wolves', name: 'Волки у ворот', note: 'стая ждёт боя' },
  { kind: 'raiders', name: 'Разбойники у ворот', note: 'шайка ждёт боя' },
];

/** Отряды на карте и метки у мест. */
export const HOST_ROWS: readonly LegendMark[] = [
  { mark: hostMarkOf({ camp: false, color: SIDE_COLOR.ours, size: 2, west: false }), name: 'Отряд в походе', note: 'гнёзда — горстка, отряд, войско, орда' },
  { mark: hostMarkOf({ camp: true, color: SIDE_COLOR.ours, size: 2, west: false }), name: 'Лагерь у цели', note: 'осада или подмога' },
  { mark: hostMarkOf({ camp: false, color: SIDE_COLOR.foe, size: 0, west: false }), name: 'Слух об отряде', note: 'сколько их — не видно' },
  ...BADGE_ROWS.map((b) => ({ mark: badgeLook(b.kind), name: b.name, note: b.note, d: 24 })),
];

/** Диаметр значка в легенде, CSS px: как на ближнем масштабе карты. */
export const LEGEND_D = 36;

/** Картинка строки: значок карты той же кистью. */
export const legendUrl = (row: LegendMark): string => markUrl(row.mark, row.d ?? LEGEND_D);
