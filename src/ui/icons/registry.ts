// Накладная на значки: какие имена игра спрашивает из своих таблиц — зданий, войск, снаряжения, запасов, профессий,
// сезонов, вестей, писем, указов. Список здесь **не пишется руками**: идентификаторы берутся прямо из данных игры.
// Заведут новое здание — оно само появится в накладной, и проверка (`icons.test.ts`, `npm run icons:build`) спросит его
// рисунок. Имя, которое интерфейс пишет буквально (`<Icon name="ui-mail" />`), проверяет `tsc`: тип `IconName` собран из
// нарисованного (`generated.ts`) и ссылок (`alias.ts`).
//
// Модуль чистый: ни React, ни DOM. Его читают двое — сборка значков (scripts/build-icons.ts) и сам интерфейс, — и второй
// правды между ними быть не должно.
import { BATTLE_ART } from '@/battle/report';
import { ACHIEVEMENTS } from '@/game/data/quests';
import { DAILY_GAMES } from '@/game/data/daily';
import { MINIGAMES } from '@/game/data/minigames';
import { GEM_PACKS } from '@/game/data/gems';
import { DECREES, RATIONS, TAXES } from '@/game/data/policy';
import { EVENTS } from '@/game/data/events';
import { SOCIAL_LINKS } from '@/game/data/social';
import { TEMPERS } from '@/world/data/diplomacy';
import { LETTER_KINDS } from '@/world/data/letters';
import { DEALS, FIGURES } from '@/world/data/figures';
import { DIPLO_ACTIONS, STANDING_META } from '@/world/data/diplomacy';
import { RELATION_ORDER, STAGES } from '@/world/data/meta';
import { SPY_ACTIONS } from '@/world/data/spy';
import { ADVISOR_POSTS } from '@/game/councilrules';
import { RESOURCE_IDS } from '@/game/constants';
import { ATTENTION_META } from '@/game/derived';
import { BUILDINGS } from '@/game/data/buildings';
import { DAY_PART_UNTIL } from '@/game/data/seasons';
import { EQUIPMENT_IDS } from '@/game/data/equipment';
import { JOBS } from '@/game/data/jobs';
import { SEASON_META } from '@/game/data/seasons';
import { TROOPS } from '@/game/data/troops';
import type { Season } from '@/game/types';
import { drawnOf, type IconName } from './alias';

export type { IconName } from './alias';

/** Приставки групп описи. Имя из пары «группа + идентификатор» строится только с ними (`iconName`): опечатка в группе —
 * ошибка `tsc`, а не пустое место на экране. Список сверяется с `ICON_GROUPS` тестом. */
export const ICON_PREFIXES = [
  'res', 'bld', 'gear', 'troop', 'job', 'season', 'attn', 'bat', 'stage', 'rel', 'fig', 'letter', 'decree', 'ration', 'tax',
  'evt', 'temper', 'daily', 'mini', 'gempack', 'maze', 'soc', 'ach', 'state', 'deal', 'dip', 'spy', 'post',
] as const;
export type IconPrefix = (typeof ICON_PREFIXES)[number];

export interface IconGroup {
  /** Приставка имени. */
  prefix: IconPrefix;
  /** Идентификаторы, у которых обязан быть рисунок. */
  ids: readonly string[];
  /** Откуда взят список — для отчёта сборки. */
  source: string;
}

/** Сезон лета и дневное солнце — один рисунок на оба (`alias.ts`). */
const seasonIds = Object.keys(SEASON_META) as Season[];

export const ICON_GROUPS: readonly IconGroup[] = [
  // Золото и алмаз — не ресурсы: они не лежат на складе. Но значок им нужен там же, где ресурсам, — в цене и в казне.
  { prefix: 'res', ids: [...RESOURCE_IDS, 'gold', 'gem'], source: 'RESOURCE_IDS + золото и алмаз' },
  { prefix: 'bld', ids: BUILDINGS.map((b) => b.id), source: 'BUILDINGS' },
  { prefix: 'gear', ids: EQUIPMENT_IDS, source: 'EQUIPMENT_IDS' },
  // Конь показывается там, где речь про конницу как род, а не про всадника.
  { prefix: 'troop', ids: [...TROOPS.map((t) => t.id), 'horse'], source: 'TROOPS + конь' },
  { prefix: 'job', ids: JOBS.map((j) => j.id), source: 'JOBS' },
  { prefix: 'season', ids: seasonIds, source: 'SEASON_META' },
  { prefix: 'attn', ids: Object.keys(ATTENTION_META), source: 'ATTENTION_META' },
  // Значки отчёта о бое перечислены там же, где строки отчёта.
  { prefix: 'bat', ids: BATTLE_ART.map((n) => n.slice('bat-'.length)), source: 'BATTLE_ART в battle/report.ts' },
  // Замок — не ступень развития, а вид цели: рисуется поверх стадии своим значком.
  { prefix: 'stage', ids: [...STAGES.map((s) => s.id), 'castle'], source: 'STAGES + замок' },
  { prefix: 'rel', ids: RELATION_ORDER, source: 'RELATION_ORDER' },
  { prefix: 'fig', ids: FIGURES.map((f) => f.id), source: 'FIGURES' },
  { prefix: 'letter', ids: LETTER_KINDS.map((l) => l.id), source: 'LETTER_KINDS' },
  { prefix: 'decree', ids: DECREES.map((d) => d.id), source: 'DECREES' },
  { prefix: 'ration', ids: RATIONS.map((r) => r.id), source: 'RATIONS' },
  { prefix: 'tax', ids: TAXES.map((x) => x.id), source: 'TAXES' },
  { prefix: 'evt', ids: EVENTS.map((e) => e.id), source: 'EVENTS' },
  { prefix: 'temper', ids: TEMPERS.map((t) => t.id), source: 'TEMPERS' },
  { prefix: 'daily', ids: DAILY_GAMES.map((g) => g.id), source: 'DAILY_GAMES' },
  { prefix: 'mini', ids: MINIGAMES.map((g) => g.id), source: 'MINIGAMES' },
  { prefix: 'gempack', ids: GEM_PACKS.map((p) => p.id), source: 'GEM_PACKS' },
  { prefix: 'maze', ids: ['key', 'door', 'chest'], source: 'клетки лабиринта' },
  { prefix: 'soc', ids: SOCIAL_LINKS.map((l) => l.id), source: 'SOCIAL_LINKS' },
  { prefix: 'ach', ids: ACHIEVEMENTS.map((a) => a.id), source: 'ACHIEVEMENTS' },
  { prefix: 'state', ids: Object.keys(STANDING_META), source: 'STANDING_META' },
  { prefix: 'deal', ids: DEALS.map((d) => d.id), source: 'DEALS' },
  { prefix: 'dip', ids: DIPLO_ACTIONS.map((a) => a.id), source: 'DIPLO_ACTIONS' },
  { prefix: 'spy', ids: SPY_ACTIONS.map((a) => a.id), source: 'SPY_ACTIONS' },
  // Должности совета Ратуши (РТ-1): карточка должности и весть о пустом месте.
  { prefix: 'post', ids: ADVISOR_POSTS, source: 'ADVISOR_POSTS' },
];

/** Имя значка для пары «группа + идентификатор». Ссылку раскрывает `Icon` (`alias.ts`). */
export const iconName = (prefix: IconPrefix, id: string): IconName => `${prefix}-${id}` as IconName;

/** Все имена, которые игра спрашивает из своих таблиц, — накладная целиком. */
export const ICON_MANIFEST: readonly string[] = [...new Set(ICON_GROUPS.flatMap((g) => g.ids.map((id) => `${g.prefix}-${id}`)))];

/** Нарисованный значок под именем накладной. */
export const drawnName = (name: string): string => drawnOf(name);

/** К какой группе относится имя. `null` — приставка игре незнакома. */
export function groupOf(name: string): IconGroup | null {
  const dash = name.indexOf('-');
  if (dash < 0) return null;
  const prefix = name.slice(0, dash);
  return ICON_GROUPS.find((g) => g.prefix === prefix) ?? null;
}

// ---------- Состояние, у которого нет своего идентификатора ----------
//
// Мораль и время суток — числа, а не записи в таблице: значок им выбирает порог. Пороги стоят здесь, а не в двух панелях
// по отдельности: строка состояния и «Племя» иначе разошлись бы, поправь кто-то одну.

/** Ступени морали: значок по порогу. Порядок — сверху вниз. */
export const MOOD_STEPS: readonly { from: number; name: IconName }[] = [
  { from: 70, name: 'mood-good' },
  { from: 40, name: 'mood-mid' },
  { from: -Infinity, name: 'mood-bad' },
];

export const moodOf = (morale: number) => MOOD_STEPS.find((step) => morale >= step.from) ?? MOOD_STEPS[2];

/**
 * Время суток по фазе солнца. Границы — из таблицы игры (`DAY_PART_UNTIL`): по ним же считается риск тайного дела, и ночь
 * в строке состояния обязана быть той же ночью, что прячет лазутчика.
 */
export const DAY_PARTS: readonly { until: number; name: IconName; label: string }[] = [
  { until: DAY_PART_UNTIL.morning, name: 'day-morning', label: 'утро' },
  { until: DAY_PART_UNTIL.day, name: 'season-sun', label: 'день' },
  { until: DAY_PART_UNTIL.evening, name: 'day-evening', label: 'вечер' },
  { until: Infinity, name: 'day-night', label: 'ночь' },
];

export const daypartOf = (solar: number) => DAY_PARTS.find((p) => solar < p.until) ?? DAY_PARTS[3];
