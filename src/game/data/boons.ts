// Временные усилители — то, что ответ на весть оставляет после себя на несколько игровых дней
// (docs/events.md, раздел 3). Праздник греет, разлив топит поля, вольная рота рубит частокол.
//
// Устройство то же, что у сезона: усилитель — **поля `SeasonModifiers`**, а не условие в коде.
// Действующие усилители ложатся поверх сезона в одном месте — `derived.seasonMods`, единственной
// точке входа сезона в симуляцию; мораль — туда же, где пир и обряд, после потолка шкалы
// (`derived.moraleBreakdown`), иначе в большом посёлке она утонула бы. Тика у усилителя нет: он
// действует, пока `s.time` не дошло до его срока, — считается при чтении.
//
// **Чисел своих здесь нет — все выведены из уже живущих** (правила 2–5: числа из устройства):
//
// - сила — середина сезонного размаха дворов (`data/yards.ts`): хороший сезон двора даёт ×1.1…×1.5
//   (поле летом ×1.35, скот осенью ×1.2), плохой — до ×0.65…×0.8 (охота зимой ×0.75). Весть
//   двигает двор так же, как сезон, не сильнее: `BOON_UP` ×1.25 и `BOON_DOWN` ×0.75;
// - мораль праздника — половина обряда (`RITE_MORALE` 8): праздник по вести справляют без храма и
//   без золота прихода; беда — та же величина с минусом; малая радость — четверть обряда;
// - срок веселья — срок пира (`FEAST_DAYS`), срок работы и погоды — сезон (`SEASON_DAYS`).
import type { JobId } from '../types';
import { FEAST_DAYS, RITE_MORALE } from '../constants';
import { SEASON_DAYS } from './seasons';
import { TAX_BY_ID } from './policy';
import { discontentOf } from '../stabrules';
import type { IconName } from '@/ui/icons/alias';

/** Сколько двигает двор добрая весть: середина хороших сезонов дворов. */
export const BOON_UP = 1.25;
/** Сколько двигает двор худая весть: зеркально, середина плохих сезонов. */
export const BOON_DOWN = 0.75;
/** Мораль праздника по вести — половина обряда. */
export const BOON_JOY = RITE_MORALE / 2;
/** Малая радость (ярмарка) — четверть обряда. */
export const BOON_CHEER = RITE_MORALE / 4;
/** Беда — та же величина, что праздник, с минусом. */
export const BOON_GRIEF = -RITE_MORALE / 2;

export interface BoonDef {
  id: string;
  icon: IconName;
  name: string;
  /** Сколько игровых дней держится. */
  days: number;
  /** Множитель выработки профессий, как у сезона. */
  jobs?: Partial<Record<JobId, number>>;
  /** Множитель скорости стройки. */
  build?: number;
  /** Множитель потребления еды. */
  food?: number;
  /** Множитель дров на отопление. */
  heating?: number;
  /** Прибавка к цели морали — после потолка шкалы, как у пира. */
  morale?: number;
  /**
   * Прибавка к цели недовольства податных, % (вести державы, СБ-2): причиной у полосы своим именем и сроком
   * (`sim/stability.folkParts`). Минус — милость, плюс — обида.
   */
  folk?: number;
  /** То же у голодных (`sim/stability.hungryParts`). */
  hungry?: number;
}

/**
 * Обида и милость вести державы — доля налога (`data/policy`): малая — половина умеренного, заметная — умеренный налог
 * целиком. Весть злит или радует город так, как его злил бы налог, не сильнее.
 */
export const MOOD_SMALL = discontentOf(TAX_BY_ID.moderate.moralePenalty) / 2;
export const MOOD_BIG = discontentOf(TAX_BY_ID.moderate.moralePenalty);
/** Обида надолго — два сезона. */
const LONG = 2 * SEASON_DAYS;

export const BOONS: BoonDef[] = [
  { id: 'harvest_joy', icon: 'bld-farm', name: 'Праздник урожая', days: FEAST_DAYS, morale: BOON_JOY },
  { id: 'fair', icon: 'bld-market', name: 'Ярмарка', days: FEAST_DAYS, jobs: { crafter: BOON_UP }, morale: BOON_CHEER },
  { id: 'flood', icon: 'ui-wave', name: 'Залитые поля', days: SEASON_DAYS, jobs: { farmer: BOON_DOWN } },
  { id: 'silt_field', icon: 'season-spring', name: 'Ил на полях', days: SEASON_DAYS, jobs: { farmer: BOON_UP } },
  { id: 'silt_pasture', icon: 'ui-sheep', name: 'Заливной луг', days: SEASON_DAYS, jobs: { herder: BOON_UP } },
  { id: 'timber', icon: 'gear-axe', name: 'Рубка всем городом', days: SEASON_DAYS, jobs: { woodcutter: BOON_UP }, build: BOON_DOWN },
  { id: 'cold', icon: 'season-winter', name: 'Лютый холод', days: SEASON_DAYS, heating: BOON_UP, morale: BOON_GRIEF },
  { id: 'vein', icon: 'ui-pick', name: 'Богатая жила', days: SEASON_DAYS, jobs: { miner: BOON_UP } },
  { id: 'shut_vein', icon: 'ui-barrier', name: 'Забой закрыт', days: SEASON_DAYS, jobs: { miner: BOON_DOWN } },
  { id: 'mercs', icon: 'gear-shield', name: 'Вольная рота на стройке', days: SEASON_DAYS, build: BOON_UP },
  // Вести державы (СБ-2): обида и милость групп, засуха, грамоты.
  { id: 'cr_fair_right', icon: 'bld-market', name: 'Ярмарочная грамота', days: LONG, jobs: { crafter: BOON_UP }, folk: -MOOD_SMALL },
  { id: 'cr_law', icon: 'ui-scroll', name: 'Закон правителя', days: LONG, folk: -MOOD_BIG },
  { id: 'cr_liberty', icon: 'ui-scroll', name: 'Городские вольности', days: LONG, folk: -MOOD_BIG },
  { id: 'cr_promise', icon: 'ui-scroll', name: 'Пустое обещание', days: SEASON_DAYS, folk: MOOD_SMALL },
  { id: 'cr_omen', icon: 'ui-star', name: 'Дурное знамение', days: SEASON_DAYS, folk: MOOD_SMALL },
  { id: 'cr_drought', icon: 'season-summer', name: 'Засуха', days: SEASON_DAYS, jobs: { farmer: BOON_DOWN } },
  { id: 'cr_drought_hard', icon: 'season-summer', name: 'Сухие колодцы', days: SEASON_DAYS, jobs: { farmer: BOON_DOWN }, hungry: MOOD_SMALL },
  { id: 'cr_culprit', icon: 'ui-flame', name: 'Виновный найден', days: SEASON_DAYS, folk: -MOOD_SMALL },
  { id: 'cr_ashes', icon: 'ui-flame', name: 'Пепелище нижнего города', days: SEASON_DAYS, folk: MOOD_BIG },
  { id: 'cr_shut_gates', icon: 'ui-barrier', name: 'Ворота на запоре', days: SEASON_DAYS, folk: MOOD_SMALL },
  { id: 'cr_pestilence', icon: 'ui-skull', name: 'Мор', days: SEASON_DAYS, folk: MOOD_SMALL },
  { id: 'cr_mercy', icon: 'ui-chain', name: 'Милость правителя', days: SEASON_DAYS, folk: -MOOD_SMALL },
  { id: 'cr_crown_wrath', icon: 'ui-warning', name: 'Гнев короны', days: SEASON_DAYS, folk: MOOD_SMALL },
  { id: 'cr_interdict', icon: 'ui-candle', name: 'Интердикт', days: LONG, folk: MOOD_BIG },
  { id: 'cr_martyr', icon: 'ui-candle', name: 'Схваченный проповедник', days: SEASON_DAYS, folk: MOOD_SMALL },
  { id: 'cr_sermon', icon: 'ui-candle', name: 'Вольная проповедь', days: SEASON_DAYS, folk: -MOOD_SMALL },
  { id: 'cr_guild_anger', icon: 'bld-market', name: 'Обида цеха', days: SEASON_DAYS, folk: MOOD_SMALL },
  { id: 'cr_grain', icon: 'res-food', name: 'Купеческое зерно', days: SEASON_DAYS, hungry: -MOOD_SMALL },
  { id: 'cr_famine', icon: 'ui-bowl', name: 'Недород', days: LONG, hungry: MOOD_BIG },
];

export const BOON_BY_ID = Object.fromEntries(BOONS.map((b) => [b.id, b])) as Record<string, BoonDef>;

/** Чем назван двор в строке усилителя. */
const JOB_WORD: Record<JobId, string> = {
  idle: 'Свободные руки',
  gatherer: 'Сбор',
  hunter: 'Охота',
  woodcutter: 'Лес',
  stonecutter: 'Каменоломня',
  miner: 'Рудник',
  farmer: 'Поля',
  herder: 'Выпас',
  crafter: 'Мастерские',
  smith: 'Кузница',
  priest: 'Служители',
};

/** «+25%», «−25%»: множитель как сдвиг в процентах, минус длинный. */
const pct = (m: number): string => {
  const p = Math.round((m - 1) * 100);
  return `${p > 0 ? '+' : '−'}${Math.abs(p)}%`;
};

/** «+10 %», «−20 %» — недовольство, целыми процентами, минус длинный. */
const moodPct = (d: number): string => `${d > 0 ? '+' : '−'}${Math.round(Math.abs(d))} %`;

/** Что усилитель делает — словами, по полю на кусок: «Поля −25%, мораль −4». Числа — из самого усилителя. */
export function boonWords(b: BoonDef): string {
  const parts: string[] = [];
  for (const [job, m] of Object.entries(b.jobs ?? {}) as [JobId, number][]) parts.push(`${JOB_WORD[job]} ${pct(m)}`);
  if (b.build !== undefined) parts.push(`стройка ${pct(b.build)}`);
  if (b.food !== undefined) parts.push(`еды уходит ${pct(b.food)}`);
  if (b.heating !== undefined) parts.push(`дров на тепло ${pct(b.heating)}`);
  if (b.morale !== undefined) parts.push(`мораль ${b.morale > 0 ? '+' : '−'}${Math.abs(b.morale)}`);
  if (b.folk !== undefined) parts.push(`недовольство податных ${moodPct(b.folk)}`);
  if (b.hungry !== undefined) parts.push(`недовольство голодных ${moodPct(b.hungry)}`);
  const t = parts.join(', ');
  return t ? t[0].toUpperCase() + t.slice(1) : t;
}
