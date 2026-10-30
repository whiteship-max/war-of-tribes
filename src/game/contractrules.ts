// Правила договоров НПС (ПН-7, docs/gdd/path_of_sword.md, 3.8.3–3.8.5 и «Решения ПН-7») — числа и формулы без состояния партии:
// плата, аванс, неустойка, престиж, срок, тир по ступени и строка договора. Читают их дверь договоров (`sim/contracts`), доска
// (`world/dealboard` — срок и сила), окно доски, прибор (`npm run roam:report`) и вывод таблицы наград дел сервера (`scripts/deeds`):
// одни числа на всех.
//
//   плата      = содержание_эталона[тир] × дни × K_вида + мощь_противника × LAIR_GOLD_PER_POWER × R_вида
//   аванс      = плата × (0.20 + 0.05 × (Дипломатия − 1)), не больше 40 %
//   неустойка  = аванс × 1.5; отказ — половина неустойки
//   престиж    = тир × 10 сверх престижа победы (мощь / S кладёт бой — `sim/roamfight.takeFight`)
//
// **Плата — от эталонного отряда тира, а не от отряда игрока** (эксплойт E1, 6.2): ни одного числа отряда в формуле нет — тир даёт
// ступень престижа, мощь противника — сила НПС по престижу (`world/roamfoes`), дни — дорога от заказчика к цели. Содержание эталона —
// двери отряда (`roamrules.bandWagesPerDay`, `bandRationPerDay`, хлеб по цене села `townrules.villageFoodPrice` — им отряд и
// кормится). K и R — вывод прибора (`data/contracts`), сроки 3.8.2 — заглушки игры (`game/roamstubs`, за выключателем).
import type { TroopStack } from './battle/kinds';
import { bandRationPerDay, bandWagesPerDay } from './roamrules';
import { villageFoodPrice } from './townrules';
import { roamStub } from './roamstubs';
import { DAY_LENGTH, gameDaysOfMs, realSeconds } from './pace';
import { realSpan } from './span';
import { CONTRACTS_MAX, DEAL_DEFS, DEAL_K, DEAL_R, ETALONS, type DealKind, type DealTier } from './data/contracts';
import { LAIR_GOLD_PER_POWER } from '../world/data/tuning';
import { travelTime } from '../world/geo';
import { generalSpeed } from '../world/data/gait';
import { menOfPower } from '../world/garrison';
import { cargoCap } from './cargocap';

/** Договоров разом — правило 3.8.4 (`data/contracts`: его читает и книга сервера). */
export { CONTRACTS_MAX };

/** Аванс: доля платы при Дипломатии 1 и прибавка за кружок, не больше потолка (3.8.3). */
export const ADVANCE_BASE = 0.2;
export const ADVANCE_STEP = 0.05;
export const ADVANCE_MAX = 0.4;
/** Неустойка — во столько раз больше аванса; отказ — эта доля неустойки (3.8.3, 3.8.5). */
export const PENALTY_OF_ADVANCE = 1.5;
export const REFUSE_SHARE = 0.5;
/** Престиж договора — столько за тир сверх престижа победы (3.8.3). */
export const FAME_PER_TIER = 10;

const TIER_WORD = ['', 'I', 'II', 'III'] as const;
/** Тир словами. */
export const tierWord = (t: DealTier): string => TIER_WORD[t];

/**
 * Высший тир договоров ступени престижа (3.9.1, столбец «Открывает»): «Безвестный» и «Замеченный» — договоры I, «Известный» — II,
 * «Грозный» и выше — III. Правило ГДД, а не число: пороги ступеней — заглушка `stages` у двери ступени.
 */
export const stageTier = (stage: number): DealTier => (stage >= 3 ? 3 : stage >= 2 ? 2 : 1);

/** Эталонный отряд тира (ГДД 4.3). */
export const etalonOf = (t: DealTier): TroopStack => ETALONS[t - 1];

/**
 * Содержание эталона тира за игровой день: жалованье (`roamrules.bandWagesPerDay`) и паёк среднего сезона, хлеб — по цене села
 * (`townrules.villageFoodPrice`): эталон кормится, как отряд бродяги.
 */
export function etalonUpkeep(t: DealTier): number {
  const band = etalonOf(t);
  return bandWagesPerDay(band) + bandRationPerDay({ band, wounded: [] }, 1) * villageFoodPrice();
}

/** «Доставить груз» (3.8.2): груз — доля `dealCargo` обоза эталона тира обычным маршем (`cargocap.cargoCap`). */
export const cargoGoods = (t: DealTier): number => Math.max(1, Math.floor(cargoCap({ band: etalonOf(t) }) * roamStub('dealCargo')));

/** Доля аванса при Дипломатии героя `dip` (кружков 1…5; навыка у героя Среза 1 нет — 1). */
export const advanceShare = (dip = 1): number => Math.min(ADVANCE_MAX, ADVANCE_BASE + ADVANCE_STEP * (Math.max(1, Math.floor(dip)) - 1));

/**
 * Дорога в плате — не длиннее двух радиусов доски обычным маршем (игр. дн.): цель лежит не дальше `dealReach.target` клеток, и обход
 * воды дальше двойного радиуса плату не растит. Тот же потолок держит таблица наград дел сервера (`scripts/deeds`).
 */
export const roadCapDays = (): number => travelTime(2 * roamStub('dealReach').target, 1, generalSpeed('normal')) / DAY_LENGTH;

/** Что нужно, чтобы назвать условия договора: вид, тир, сила противника, дорога от заказчика к цели и стоянка вида. */
export interface DealIn {
  kind: DealKind;
  tier: DealTier;
  /** Мощь противника договора (сила НПС по престижу, `world/roamfoes`); без боя — засада дороги ступени, служба — 0. */
  power: number;
  /** Дорога от заказчика к цели обычным маршем, мс мира. */
  roadMs: number;
  /** Сколько игр. дн. стоять (защита села — до набега, гарнизонная служба — срок службы); прочим — 0. */
  stand?: number;
  /** Дипломатия героя, кружков. */
  dip?: number;
}

/** Условия договора — одни числа на доску, взятие, сдачу, неустойку, прибор и сервер. */
export interface DealTerms {
  kind: DealKind;
  tier: DealTier;
  power: number;
  /** Срок, игр. дн. */
  days: number;
  pay: number;
  advance: number;
  penalty: number;
  /** Неустойка отказа. */
  refuse: number;
  /** Престиж сдачи — сверх престижа победы. */
  fame: number;
}

/** Срок договора, игр. дн. (3.8.2): дорог от заказчика к цели (не длиннее потолка) и дни сверх пути — заглушки; стоянка — своя. */
export function dealDays(kind: DealKind, roadMs: number, stand = 0): number {
  const road = Math.min(roadCapDays(), gameDaysOfMs(Math.max(0, roadMs)));
  return roamStub('dealRoads')[kind] * road + roamStub('dealDays')[kind] + Math.max(0, stand);
}

/** Условия договора (3.8.3) — единственная формула платы, аванса, неустойки и престижа. */
export function contractTerms(d: DealIn): DealTerms {
  const days = dealDays(d.kind, d.roadMs, d.stand);
  const power = Math.max(0, d.power);
  const pay = Math.round(etalonUpkeep(d.tier) * days * DEAL_K[d.kind] + power * LAIR_GOLD_PER_POWER * DEAL_R[d.kind]);
  const advance = Math.round(pay * advanceShare(d.dip));
  const penalty = Math.round(advance * PENALTY_OF_ADVANCE);
  return { kind: d.kind, tier: d.tier, power, days, pay, advance, penalty, refuse: Math.round(penalty * REFUSE_SHARE), fame: d.tier * FAME_PER_TIER };
}

/** Сколько платы приходит при сдаче — остаток сверх аванса (аванс получен при взятии). Одна арифметика на дверь сдачи и окно. */
export const settlePay = (t: Pick<DealTerms, 'pay' | 'advance'>): number => Math.max(0, t.pay - t.advance);

/** Риск договора словами: бой с ~N, засады в пути или без боя. */
export function riskWords(t: Pick<DealTerms, 'kind' | 'power'>): string {
  const fight = DEAL_DEFS[t.kind].fight;
  if (fight && t.power > 0) return `бой с ~${menOfPower(t.power)}`;
  return t.kind === 'garrison' ? 'без боя' : 'засады в пути';
}

/** Срок словами: настоящее время (игровой день — полчаса). */
export const termWords = (days: number): string => realSpan(realSeconds(days * DAY_LENGTH));

/** Строка договора по полям (ГДД 5.4: вид, плата, аванс, срок, тир, риск) — те же числа, что `contractTerms`. */
export interface DealRow {
  name: string;
  pay: string;
  advance: string;
  term: string;
  tier: string;
  risk: string;
}

/** Строка договора (правило 18): каждое поле — из `contractTerms`, своей арифметики у окна нет. */
export function dealRow(t: DealTerms): DealRow {
  return {
    name: DEAL_DEFS[t.kind].name,
    pay: `плата ${t.pay}`,
    advance: `аванс ${t.advance}`,
    term: `срок ${termWords(t.days)}`,
    tier: `тир ${tierWord(t.tier)}`,
    risk: `риск: ${riskWords(t)}`,
  };
}

/** Строка договора одной строкой — летопись и подсказка. */
export const dealLine = (t: DealTerms): string => Object.values(dealRow(t)).join(' · ');
