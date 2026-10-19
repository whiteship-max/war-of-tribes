// Приказы лазутчика и кому какой приказ принадлежит.
//
// Форма строки та же, что у приказов дипломата (`data/diplomacy.ts`): цена,
// время и шанс приезжают в меню числами, а не пересчитываются в разметке.
// Второго вида меню заводить нельзя — иначе следующая фигура принесёт третий.
import type { FigureId, OrderActionId, RivalDeedId, SpyActionId } from '../types';
import { DIPLO_ACTIONS } from './diplomacy';
import { SPY_BUSY } from './tuning';
import type { IconName } from '@/ui/icons/alias';

export interface SpyActionDef {
  id: SpyActionId;
  name: string;
  description: string;
  /** Что означает показанный шанс. */
  chanceLabel: string;
  /** Сколько лазутчик занят после **удачного** дела, мс. Провал держит дольше. */
  busy: number;
}

export const SPY_ACTIONS: SpyActionDef[] = [
  {
    id: 'probe',
    name: 'Выведать гарнизон',
    description:
      'Сосчитать гарнизон на глаз и по разговорам. Число выйдет приблизительным и со временем устареет.',
    chanceLabel: 'удастся',
    busy: SPY_BUSY,
  },
  {
    id: 'revolt',
    name: 'Поддержать повстанцев',
    description:
      'Сговориться с недовольными. Пока идёт бунт, город не растёт и слабеет. Время для удара.',
    chanceLabel: 'удастся',
    busy: SPY_BUSY,
  },
];

export const SPY_ACTION_BY_ID: Record<SpyActionId, SpyActionDef> = Object.fromEntries(
  SPY_ACTIONS.map((a) => [a.id, a]),
) as Record<SpyActionId, SpyActionDef>;

/**
 * Кто отдаёт какой приказ. Таблица одна на всех: по ней меню собирает строки
 * для выбранного агента, а мир проверяет, что приказ отдаёт тот, кому он
 * принадлежит. Развести это по двум местам значит однажды разойтись.
 */
export const ORDER_AGENT: Record<OrderActionId, FigureId> = {
  ...(Object.fromEntries(DIPLO_ACTIONS.map((a) => [a.id, 'diplomat' as FigureId])) as Record<
    OrderActionId,
    FigureId
  >),
  ...(Object.fromEntries(SPY_ACTIONS.map((a) => [a.id, 'spy' as FigureId])) as Record<
    OrderActionId,
    FigureId
  >),
};

/** Строки меню для агента: у разведчика и полководца своих приказов пока нет. */
export function actionsOf(agent: FigureId): { id: OrderActionId; name: string; description: string; chanceLabel: string; busy: number }[] {
  if (agent === 'diplomat') return DIPLO_ACTIONS;
  if (agent === 'spy') return SPY_ACTIONS;
  return [];
}

// ---------- Дела против города живого игрока (docs/spy_pvp.md) ----------
//
// Числа дизайна в одном месте, рядом с делами против логов: шанс считает та же `spy.spyChance` (трудность дела —
// множитель `hard`, как у бунта `SPY_REVOLT_HARDER`), гибель — та же `peril.perilOf`, цена в энергии — та же таблица
// `data/energy.ENERGY_PRICE`. Исход считает сервер войны (`netlify/lib/war.ts` через `world/rivalspy.ts`); клиент его
// не присылает.

export interface RivalDeedDef {
  id: RivalDeedId;
  name: string;
  /** Значок дела в меню (набор ЗН-1, docs/icons.md). */
  icon: IconName;
  /** Что дело делает — для меню. */
  description: string;
  /** Во сколько раз дело труднее пробы гарнизона (`SPY_PROBE_BASE`): множитель базы шанса. */
  hard: number;
  /** Нападение ли это — вредит ли городу удача (бот пишет только о нападении, docs/NOTIFY.md). */
  hostile: boolean;
  /** Почему столько — строка обоснования (данные дизайна, а не мерка). */
  why: string;
}

export const RIVAL_DEEDS: RivalDeedDef[] = [
  {
    id: 'look',
    name: 'Разведать',
    icon: 'ui-eye',
    description: 'Сосчитать дружину и оборону соседа до бойца. Кто дома, кто в походе, сколько ополчения на стене.',
    hard: 1,
    hostile: false,
    why: 'Та же проба, что у логова (трудность 1): подглядеть, ни с кем не сговариваясь. Числа точные, а не вилкой — город игрока живёт по слепку, и сервер знает его до головы.',
  },
  {
    id: 'fire',
    name: 'Поджог',
    icon: 'ui-flame',
    description: 'Поджечь склад. Сгорает часть того, что лежит на виду. Тайник огонь не берёт.',
    hard: 0.7,
    hostile: true,
    why: 'Труднее бунта (0.8): к складу надо подойти под самой стражей. Легче кражи (0.6): поджечь — не унести.',
  },
  {
    id: 'theft',
    name: 'Кража',
    icon: 'ui-pouch',
    description: 'Унести часть запасов и золота. Что ушло у соседа, приходит к нам. Тайник не достать.',
    hard: 0.6,
    hostile: true,
    why: 'Самое трудное дело: войти, взять и уйти с поклажей. Добро переходит, а не начисляется, — поэтому и шанс ниже поджога.',
  },
  {
    id: 'unrest',
    name: 'Смута',
    icon: 'spy-revolt',
    description: 'Подбить жителей на ропот. Мораль в городе падает, часть недовольных уходит к нам.',
    hard: 0.8,
    hostile: true,
    why: 'Тот же сговор, что бунт у логова (`SPY_REVOLT_HARDER` = 0.8): уговорить людей, а не обойти стражу.',
  },
];

export const RIVAL_DEED_BY_ID: Record<RivalDeedId, RivalDeedDef> = Object.fromEntries(RIVAL_DEEDS.map((d) => [d.id, d])) as Record<
  RivalDeedId,
  RivalDeedDef
>;

/**
 * Сила дел — доли и потолки. Обоснование у каждого числа: это данные дизайна, их мерки нет (docs/spy_pvp.md, решения).
 */
export const RIVAL_POWER = {
  /**
   * Поджог: какая доля открытого склада (сверх тайника) сгорает. Четверть — заметно, но не участь: взятый город теряет
   * всё сверх тайника, поджог — четверть, и за ним не идёт войско. Казна не горит.
   */
  fireShare: 0.25,
  /**
   * Кража: какая доля открытого склада и казны уходит — не больше, чем унесёт один воин набега (`units.warrior.carry`;
   * потолок считает `world/rivalspy` той же `stackCarry`, что обоз войска). Пятая часть — меньше поджога: добро не
   * пропадает, а переходит к нападающему, и выгода у него двойная.
   */
  theftShare: 0.2,
  /** Кража: сколько воинов набега по поклаже уносит лазутчик (`stackCarry({ warrior })`). Один — лазутчик и мул. */
  theftCarriers: 1,
  /** Смута: насколько падает дух города. Меньше проигранного боя (−6 у войны): людей не убили, их подбили. */
  unrestMorale: -5,
  /** Смута: какая доля горожан уходит к нападающему. Последний житель не уходит никогда. */
  unrestShare: 0.03,
  /** Смута: потолок ушедших за одно дело — столько уведёт один человек без конвоя. */
  unrestCap: 10,
} as const;

/**
 * Защита соседа (docs/spy_pvp.md): стража — мощь тех, кто дома (`spy.guardOf`, как у логова), Дозор соседа и его
 * лазутчик дома. Чем сильнее охрана, тем ниже шанс дела — и тем выше шанс, что лазутчика схватят: провал, которого не
 * скрыла скрытность, и есть поимка.
 */
export const RIVAL_GUARD = {
  /**
   * Дозор соседа: стража множится на его `intelKeen` в этой степени. Единица — Дозор в обороне весит столько же, сколько
   * Дозор нападающего в деле: при равных Дозорах они гасят друг друга.
   */
  watch: 1,
  /** Свой лазутчик соседа дома (у ворот или в городе): знает ремесло изнутри — стража ×1.3. */
  counter: 1.3,
} as const;
