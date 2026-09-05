// Из чего состоит чужое войско. Мир хранит про поселение одно число — мощь;
// бою нужен состав. Состав выводится из мощи и сида детерминированно, поэтому
// сервер получит тот же гарнизон, а разведка, сделанная вчера, не разойдётся с
// тем, что стоит на поле сегодня: меняются числа, а не построение.
import { BATTLE_MAN } from '@/game/battle/kinds';
import {
  QUICK_PRESETS,
  QUICK_PRESET_IDS,
  emptyStack,
  type ArmySetup,
  type QuickPresetId,
  type Stack,
  type UnitKind,
} from '@/battle';

/** Уклад войска: кого в нём больше. Это и есть «построение», которое видит разведка. */
export type GarrisonStyle = 'balanced' | 'horde' | 'riders' | 'wall' | 'bowmen';

interface StyleDef {
  name: string;
  shares: Partial<Record<UnitKind, number>>;
}

export const GARRISON_STYLES: Record<GarrisonStyle, StyleDef> = {
  balanced: { name: 'смешанное войско', shares: { spear: 0.3, infantry: 0.35, archer: 0.2, cavalry: 0.15 } },
  horde: { name: 'пешая орда', shares: { infantry: 0.7, archer: 0.3 } },
  riders: { name: 'конная дружина', shares: { cavalry: 0.4, infantry: 0.35, archer: 0.25 } },
  wall: { name: 'копейная стена', shares: { spear: 0.45, infantry: 0.3, archer: 0.25 } },
  bowmen: { name: 'лучный засад', shares: { archer: 0.45, infantry: 0.35, spear: 0.2 } },
};

const STYLE_IDS: GarrisonStyle[] = ['balanced', 'horde', 'riders', 'wall', 'bowmen'];

/** Хеш строки с сидом: тот же вход — тот же уклад, без обращения к Math.random. */
function hash(seed: number, text: string): number {
  let h = (seed ^ 0x811c9dc5) >>> 0;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  }
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  return (h ^ (h >>> 13)) >>> 0;
}

/** Замок — всегда копейная стена: крепость держат строем, а не наскоком. */
export function styleOf(seed: number, id: string, castle: boolean): GarrisonStyle {
  if (castle) return 'wall';
  return STYLE_IDS[hash(seed, id) % STYLE_IDS.length];
}

/** Ступень снаряжения гарнизона: чем крупнее поселение, тем лучше оно кованое. */
export function gearTier(power: number, castle: boolean): number {
  const base = power >= 60 ? 2 : power >= 25 ? 1 : 0;
  return Math.min(3, base + (castle ? 1 : 0));
}

/** Мощь переводится в бойцов строя той же меркой, что и у племени. */
export const menOfPower = (power: number): number => Math.max(1, Math.round(power / BATTLE_MAN));

/** Делит людей по долям целыми числами; остаток — самой большой доле. */
function split(men: number, shares: Partial<Record<UnitKind, number>>): Stack {
  const out = emptyStack();
  const keys = Object.keys(shares) as UnitKind[];
  const total = keys.reduce((n, k) => n + (shares[k] ?? 0), 0);
  if (men <= 0 || total <= 0) return out;
  let left = men;
  let best: UnitKind = keys[0];
  for (const k of keys) {
    const n = Math.floor((men * (shares[k] ?? 0)) / total);
    out[k] = n;
    left -= n;
    if ((shares[k] ?? 0) > (shares[best] ?? 0)) best = k;
  }
  out[best] += left;
  return out;
}

export interface Garrison {
  style: GarrisonStyle;
  kinds: Stack;
  men: number;
  gear: Partial<Record<UnitKind, number>>;
  preset: QuickPresetId;
  setup: ArmySetup;
}

/**
 * Гарнизон поселения: состав и построение. Построение выбирается по сиду и
 * не зависит от времени — иначе разведданные устаревали бы не по возрасту, а
 * от каждой перерисовки. Свой план, приказы и резерв остаются скрытыми: их
 * разведка не показывает, и именно на этом держится вся неопределённость.
 */
export function garrisonOf(seed: number, id: string, power: number, castle = false): Garrison {
  const style = styleOf(seed, id, castle);
  const men = menOfPower(power);
  const kinds = split(men, GARRISON_STYLES[style].shares);
  const tier = gearTier(power, castle);
  const gear: Partial<Record<UnitKind, number>> = { spear: tier, infantry: tier, archer: tier, cavalry: tier };
  const preset = QUICK_PRESET_IDS[hash(seed, `${id}#plan`) % QUICK_PRESET_IDS.length];
  const setup = { ...QUICK_PRESETS[preset].layout(kinds), gear };
  return { style, kinds, men, gear, preset, setup };
}

/**
 * Отряд, вышедший в набег на игрока: тот же перевод мощи в состав, но уклад и
 * построение — по сиду похода. Что идёт в этом отряде, дома заранее не знают.
 */
export function raidingParty(seed: number, marchId: string, power: number): Garrison {
  const style = STYLE_IDS[hash(seed, `${marchId}!raid`) % STYLE_IDS.length];
  const men = menOfPower(power);
  const kinds = split(men, GARRISON_STYLES[style].shares);
  const tier = gearTier(power, false);
  const gear: Partial<Record<UnitKind, number>> = { spear: tier, infantry: tier, archer: tier, cavalry: tier };
  const preset = QUICK_PRESET_IDS[hash(seed, `${marchId}!plan`) % QUICK_PRESET_IDS.length];
  const setup = { ...QUICK_PRESETS[preset].layout(kinds), gear };
  return { style, kinds, men, gear, preset, setup };
}
