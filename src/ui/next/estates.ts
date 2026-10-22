// Сословия — вид раздела Ратуши (РТ-2, docs/stability.md, «РТ-2»): строки сословий, специализация города, разбор лояльности
// и влияния, примерка привилегии и дара. Своей арифметики нет (правило 18): влияние, лояльность, сила, плюс и минус — мерка игры
// `derived.estatesNow`; примерка — та же мерка на копии партии с дарованной привилегией или новым усилителем.
import type { EstateId, GameState } from '@/game/types';
import { DAY_LENGTH } from '@/game/constants';
import {
  DISLOYAL,
  ENVY,
  ESTATES,
  ESTATE_DOMINANT,
  ESTATE_HALLS,
  FERVOUR_SCALE,
  LOYAL,
  LOYALTY_BASE,
  PIETY_SCALE,
  PRIV_LOYALTY,
  PRIV_MAX,
  PRIV_SHARE,
  privOf,
  privTotal,
  specialOf,
  weightOf,
} from '@/game/estaterules';
import { ESTATE_META, EVEN_CITY, LOYALTY_WORD } from '@/game/data/estates';
import { ESTATE_TEXT } from '@/game/data/estateWords';
import { BOON_BY_ID, estateBoon } from '@/game/data/boons';
import { DECREE_BY_ID, ESTATE_DECREE } from '@/game/data/policy';
import { activeBoons, buildingTitle, decreeBlock, estateMurmur, estatesNow, levelsOf, type EstateNow } from '@/game/derived';
import { signed } from '@/ui/parts/signed';
import type { IconName } from '@/ui/icons/alias';

/** Ступень лояльности: верны, выжидают, ропщут (пороги EU4). */
export type LoyaltyState = keyof typeof LOYALTY_WORD;

export const loyaltyState = (loyalty: number): LoyaltyState => (loyalty >= LOYAL ? 'loyal' : loyalty < DISLOYAL ? 'disloyal' : 'wait');

/** Доля процентом со знаком: 0.123 → «+12,3 %»; малое — до десятой. */
const pct = (share: number): string => `${signed(share * 100, Math.abs(share) < 0.1 ? 1 : 0)} %`;
/** Очки со знаком: «+3,4». */
const pts = (n: number): string => signed(n, 1);

/** Плюс и минус сословия словами с числом — коротко для карточки, полно для листа. */
export function leverWords(e: EstateId, n: Pick<EstateNow, 'plus' | 'minus'>): { plus: string; minus: string; plusFull: string; minusFull: string } {
  switch (e) {
    case 'merchants':
      return { plus: `${pct(n.plus)} золота`, minus: `${pct(-n.minus)} стойкости`, plusFull: `Золото налога и рынка ${pct(n.plus)}`, minusFull: `Стойкость дружины ${pct(-n.minus)}` };
    case 'guilds':
      return { plus: `${pct(n.plus)} стройки`, minus: `${pct(n.minus)} хлеба`, plusFull: `Скорость стройки ${pct(n.plus)}`, minusFull: `Хлеба город ест ${pct(n.minus)}` };
    case 'peasants':
      return { plus: `${pct(n.plus)} добычи`, minus: `${pct(-n.minus)} налога`, plusFull: `Добыча дворов и прирост ${pct(n.plus)}`, minusFull: `Золото налога ${pct(-n.minus)}` };
    case 'knights':
      return {
        plus: `${pts(FERVOUR_SCALE * n.plus)} стойкости`,
        minus: `${pct(n.minus)} жалованья`,
        plusFull: `Стойкость дружины в бою ${pts(FERVOUR_SCALE * n.plus)}`,
        minusFull: `Жалованье войска ${pct(n.minus)}, прирост ${pct(-n.minus)}`,
      };
    case 'clergy':
      return {
        plus: `${pct(Math.min(1, n.plus))} терпения`,
        minus: `${pct(-n.minus)} налога`,
        plusFull: `Налог злит податных ${pct(-Math.min(1, n.plus))}, набожность ${pts(PIETY_SCALE * n.plus)}`,
        minusFull: `Десятина: золото налога ${pct(-n.minus)}`,
      };
  }
}

/** Строка сословия для карточки. */
export interface EstateRow {
  id: EstateId;
  name: string;
  icon: IconName;
  who: string;
  infl: number;
  loyalty: number;
  state: LoyaltyState;
  priv: number;
  /** Есть ли у сословия сила — влияние выше ровной доли или его указ. */
  strong: boolean;
  plus: string;
  minus: string;
  /** Ропот у податных, %. */
  murmur: number;
  dominant: boolean;
  decree: boolean;
}

export function estateRows(s: GameState): EstateRow[] {
  const now = estatesNow(s);
  return ESTATES.map((e) => {
    const n = now[e];
    const w = leverWords(e, n);
    return {
      id: e,
      name: ESTATE_META[e].name,
      icon: ESTATE_META[e].icon,
      who: ESTATE_TEXT[e].who,
      infl: n.infl,
      loyalty: n.loyalty,
      state: loyaltyState(n.loyalty),
      priv: privOf(s.estates?.priv, e),
      strong: n.strength > 0,
      plus: w.plus,
      minus: w.minus,
      murmur: estateMurmur(s, e),
      dominant: n.infl >= ESTATE_DOMINANT,
      decree: n.decree,
    };
  });
}

/** Специализация города: имя, чьё и сколько влияния; перевес — сословие, держащее больше половины. */
export function cityOf(s: GameState): { lead: EstateId | null; name: string; infl: number; dominant: EstateId | null } {
  const now = estatesNow(s);
  const infl = Object.fromEntries(ESTATES.map((e) => [e, now[e].infl])) as Record<EstateId, number>;
  const lead = specialOf(infl);
  const top = ESTATES.reduce((a, b) => (infl[b] > infl[a] ? b : a));
  return { lead, name: lead ? ESTATE_META[lead].city : EVEN_CITY, infl: infl[top], dominant: infl[top] >= ESTATE_DOMINANT ? top : null };
}

/** Слагаемое разбора: подпись, число, значок. */
export interface Line {
  label: string;
  value: number;
  icon?: IconName;
}

/** Что влияет на лояльность — слагаемыми той же мерки (`estaterules.loyaltyParts`); усилители — своим именем. */
export function loyaltyLines(s: GameState, e: EstateId): Line[] {
  const n = estatesNow(s)[e];
  const own = privOf(s.estates?.priv, e);
  const others = privTotal(s.estates?.priv) - own;
  const out: Line[] = [{ label: 'Ровная лояльность', value: LOYALTY_BASE }];
  if (own > 0) out.push({ label: `Свои привилегии: ${own}`, value: n.parts.own, icon: ESTATE_META[e].icon });
  if (others > 0) out.push({ label: `Зависть: привилегий другим ${others}`, value: n.parts.envy, icon: 'ui-scales' });
  for (const { def } of activeBoons(s)) {
    const v = def.estates?.[e];
    if (v) out.push({ label: def.name, value: v, icon: def.icon });
  }
  if (n.parts.greed < 0) out.push({ label: 'Перевес: требует больше', value: n.parts.greed, icon: 'ui-warning' });
  return out;
}

/** Откуда влияние: постройки сословия с уровнями, их средний уровень, доля по весу и привилегии. */
export function influenceParts(s: GameState, e: EstateId): { halls: { name: string; level: number }[]; mean: number; priv: number; privShare: number } {
  const levels = levelsOf(s);
  const halls = ESTATE_HALLS[e].map((t) => ({ name: buildingTitle(s, t), level: Math.max(0, Math.floor(levels[t] ?? 0)) }));
  const priv = privOf(s.estates?.priv, e);
  return { halls, mean: weightOf(levels, e), priv, privShare: PRIV_SHARE * priv };
}

/** Примерка: что станет с сословиями после дела — та же мерка на копии партии. */
function tryOn(s: GameState, priv: Partial<Record<EstateId, number>>, boon?: string): Record<EstateId, EstateNow> {
  const boons = boon ? [...(s.boons ?? []).filter((b) => b.id !== boon), { id: boon, until: s.time + (BOON_BY_ID[boon]?.days ?? 0) * DAY_LENGTH }] : s.boons;
  return estatesNow({ ...s, estates: { ...(s.estates ?? { grants: 0, revokes: 0, gifts: 0 }), priv }, boons });
}

/** Что изменит дело: лояльность и влияние каждого сословия до и после. */
export interface Preview {
  rows: { id: EstateId; name: string; loyalty: [number, number]; infl: [number, number] }[];
}

const previewOf = (s: GameState, after: Record<EstateId, EstateNow>): Preview => {
  const now = estatesNow(s);
  return { rows: ESTATES.map((e) => ({ id: e, name: ESTATE_META[e].name, loyalty: [now[e].loyalty, after[e].loyalty], infl: [now[e].infl, after[e].infl] })) };
};

/** Даровать следующую привилегию — что изменится. */
export function grantPreview(s: GameState, e: EstateId): Preview {
  const priv = { ...(s.estates?.priv ?? {}), [e]: Math.min(PRIV_MAX, privOf(s.estates?.priv, e) + 1) };
  return previewOf(s, tryOn(s, priv));
}

/** Отнять привилегию — что изменится: власть уходит городу, сословие помнит обиду сезон. */
export function revokePreview(s: GameState, e: EstateId): Preview {
  const priv = { ...(s.estates?.priv ?? {}), [e]: Math.max(0, privOf(s.estates?.priv, e) - 1) };
  return previewOf(s, tryOn(s, priv, estateBoon('rev', e)));
}

/** Одарить — что изменится: лояльность на сезон. */
export function giftPreview(s: GameState, e: EstateId): Preview {
  return previewOf(s, tryOn(s, { ...(s.estates?.priv ?? {}) }, estateBoon('gift', e)));
}

/** Сколько ещё держится дар сословию, игровых секунд; нет — 0. */
export function giftLeft(s: GameState, e: EstateId): number {
  const id = estateBoon('gift', e);
  const b = (s.boons ?? []).find((x) => x.id === id);
  return b ? Math.max(0, b.until - s.time) : 0;
}

/** Указ сословия: имя, смысл, открыт ли, действует ли и почему закрыт. */
export function estateDecreeOf(s: GameState, e: EstateId): { id: string; name: string; effect: string; on: boolean; why: string | null } {
  const id = ESTATE_DECREE[e];
  const d = DECREE_BY_ID[id];
  return { id, name: d.name, effect: d.effect, on: s.decree === id, why: decreeBlock(s, id) };
}

/** Числа устройства для подписи: своя привилегия и зависть, пороги. */
export const ESTATE_NUMBERS = { own: PRIV_LOYALTY, envy: ENVY, loyal: LOYAL, disloyal: DISLOYAL, share: PRIV_SHARE, dominant: ESTATE_DOMINANT } as const;
