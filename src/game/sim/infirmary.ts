// Лазарет: раненые после боя, места, срок и возвращение в строй.
//
// Решения владельца (docs/infirmary.md, раздел 9) — все здесь, и писатель у раненых один:
// - **раненый встаёт бойцом того же вида со снаряжением** — не жителем: здание существует ради
//   сбережения войска, а житель не сберегает ни одного найма;
// - **ранены** — доля `healShare` павших, **мест** — `infirmaryBeds` (11 бойцов строя на уровень); сверх мест
//   раненые не выживают;
// - **лежат** `WOUND_DAYS` игровых дня. Срок — отметка в группе, а не счётчик: встают группой, когда
//   часы партии её прошли (`settleWounds`), и офлайн-догон проходит мимо ровно так же, как игра;
// - **раненые полководца лежат дома**: бой в поле кладёт их при нём (`until` null), мест они не
//   занимают, и срок и место у них начинаются, когда дружина вернулась к воротам (`woundsHome`);
// - **рассеянные не пациенты**: падение города голодом и разгром полководца ранеными не кладут.
// При голоде раненые уходят той же дверью, что войско (`sim/upkeep`), но всегда голодом и совсем.
import type { GameState, TroopId, WoundGroup } from '../types';
import { DAY_LENGTH, WOUND_DAYS } from '../constants';
import { TROOP_BY_ID, TROOP_IDS } from '../data/troops';
import { BATTLE_MAN, troopPower, troopTotal, type TroopStack } from '../battle/kinds';
import { bedsTaken, healShare, infirmaryBeds } from '../derived';
import { log } from './log';

/**
 * `n` человек из `stack` пропорционально составу, наибольшими остатками; при равных остатках —
 * порядком видов. Одна раскладка и на «кто ранен», и на «кому хватило мест»: пропорция одна.
 */
export function shareOf(stack: TroopStack, n: number): TroopStack {
  const whole = troopTotal(stack);
  const want = Math.max(0, Math.min(whole, Math.round(n)));
  const out: TroopStack = {};
  if (want <= 0 || whole <= 0) return out;
  let given = 0;
  const rests: [TroopId, number][] = [];
  for (const id of TROOP_IDS) {
    const have = stack[id] ?? 0;
    if (have <= 0) continue;
    const exact = (have * want) / whole;
    const base = Math.floor(exact);
    if (base > 0) out[id] = base;
    given += base;
    rests.push([id, exact - base]);
  }
  rests.sort((a, b) => b[1] - a[1] || TROOP_IDS.indexOf(a[0]) - TROOP_IDS.indexOf(b[0]));
  for (const [id] of rests) {
    if (given >= want) break;
    out[id] = (out[id] ?? 0) + 1;
    given++;
  }
  return out;
}

const minus = (a: TroopStack, b: TroopStack): TroopStack => {
  const out: TroopStack = {};
  for (const id of TROOP_IDS) {
    const n = (a[id] ?? 0) - (b[id] ?? 0);
    if (n > 0) out[id] = n;
  }
  return out;
};

/** Сколько мест свободно сейчас — в бойцах строя (`derived.bedsTaken`). */
export const freeBeds = (s: GameState): number => Math.max(0, infirmaryBeds(s) - bedsTaken(s));

/**
 * Сколько голов из `wounded` поместится на `room` мест: место — боец строя, а не голова, и
 * всадник занимает столько же, сколько весит в бою (docs/stable.md, решение 9). Пропорция та
 * же (`shareOf`), просто головы снимаются, пока состав не влезет: другого способа уложить
 * смешанных раненых без второй арифметики нет.
 */
export function fitBeds(wounded: TroopStack, room: number): TroopStack {
  const whole = troopTotal(wounded);
  for (let heads = Math.min(whole, Math.floor(room * BATTLE_MAN)); heads > 0; heads--) {
    const take = shareOf(wounded, heads);
    if (troopPower(take) / BATTLE_MAN <= room + 1e-9) return take;
  }
  return {};
}

/** Уложить раненых в лазарет: сколько легло — на срок, остальные сверх мест не выжили. */
function layDown(s: GameState, wounded: TroopStack): { laid: number; lost: number } {
  const whole = troopTotal(wounded);
  if (whole <= 0) return { laid: 0, lost: 0 };
  const laid = fitBeds(wounded, freeBeds(s));
  const n = troopTotal(laid);
  if (n > 0) s.wounded.push({ troops: laid, until: s.time + WOUND_DAYS * DAY_LENGTH });
  return { laid: n, lost: whole - n };
}

export interface Casualties {
  /** Легли в лазарет сейчас. */
  laid: number;
  /** Остались при полководце в поле. */
  carried: number;
  /** Ранены, но мест не хватило. */
  noBed: number;
}

/**
 * Павшие боя: кто из них ранен. Зовёт одна дверь последствий боя (`applyExpedition`); не
 * выживших сверх мест (`noBed`) погибшими пишет она же.
 * `lost` — кого бой снял с войска, по видам; `field` — сколько из них пало при полководце в поле;
 * `routed` — потери рассеяны, а не ранены (пациентов нет).
 */
export function woundsOfBattle(s: GameState, lost: TroopStack, field: TroopStack | undefined, routed: boolean): Casualties {
  const none = { laid: 0, carried: 0, noBed: 0 };
  if (routed || troopTotal(lost) <= 0) return none;
  const share = healShare(s);
  if (share <= 0) return none;
  // Поле — часть потерь; больше, чем бой снял с войска, в нём быть не может.
  const inField: TroopStack = {};
  for (const id of TROOP_IDS) {
    const n = Math.min(lost[id] ?? 0, field?.[id] ?? 0);
    if (n > 0) inField[id] = n;
  }
  const atHome = minus(lost, inField);
  const home = shareOf(atHome, troopTotal(atHome) * share);
  const carried = shareOf(inField, troopTotal(inField) * share);
  const { laid, lost: noBed } = layDown(s, home);
  const c = troopTotal(carried);
  if (c > 0) s.wounded.push({ troops: carried, until: null });
  return { laid, carried: c, noBed };
}

/** Строка летописи о раненых боя — её пишет дверь последствий рядом со строкой самого боя. */
export const woundLine = (c: Casualties): string => {
  const parts: string[] = [];
  if (c.laid > 0) parts.push(`${c.laid} легли в лазарет на ${WOUND_DAYS} дня`);
  if (c.carried > 0) parts.push(`${c.carried} при полководце — лягут, когда дружина вернётся`);
  if (c.noBed > 0) parts.push(`${c.noBed} не хватило мест — не выжили`);
  return `Раненые: ${parts.join('; ')}.`;
};

/**
 * Дружина вернулась к воротам: раненые, лежавшие при полководце, ложатся в лазарет, и срок у них
 * начинается с этой минуты. Мест не хватило — не выжили. Возвращает, сколько не выжило.
 */
export function woundsHome(s: GameState): number {
  const carried = (s.wounded ?? []).filter((g) => g.until === null);
  if (carried.length === 0) return 0;
  s.wounded = s.wounded.filter((g) => g.until !== null);
  const all: TroopStack = {};
  for (const g of carried) for (const [id, n] of Object.entries(g.troops) as [TroopId, number][]) all[id] = (all[id] ?? 0) + n;
  const { laid, lost } = layDown(s, all);
  s.stats.died += lost;
  log(s, `Дружина привезла раненых: ${laid} легли в лазарет на ${WOUND_DAYS} дня${lost > 0 ? `, ${lost} не хватило мест — не выжили` : ''}.`, lost > 0 ? 'bad' : 'info');
  return lost;
}

/** Шаг партии: чей срок прошёл — встают в строй того же вида. Возвращает, сколько встало. */
export function settleWounds(s: GameState): number {
  if (!s.wounded || s.wounded.length === 0) return 0;
  let back = 0;
  const keep: WoundGroup[] = [];
  for (const g of s.wounded) {
    if (g.until === null || s.time < g.until) {
      keep.push(g);
      continue;
    }
    for (const [id, n] of Object.entries(g.troops) as [TroopId, number][]) {
      if (n <= 0) continue;
      s.army[id] = (s.army[id] ?? 0) + n;
      back += n;
      // По строке на бойца, склеенной счётчиком за сутки, — как у казарм.
      for (let i = 0; i < n; i++) log(s, `Из лазарета в строй: ${TROOP_BY_ID[id].one}.`, 'good', `wound:back:${id}`);
    }
  }
  s.wounded = keep;
  return back;
}

/**
 * Снять `n` раненых вида `id` — голодом, совсем. Первыми уходят те, кто лёг последним: при
 * полководце, потом свежие; лежавшим дольше до строя ближе всего. Возвращает, сколько снято.
 */
export function loseWounded(s: GameState, id: TroopId, n: number): number {
  let left = Math.max(0, Math.floor(n));
  let gone = 0;
  const order = [...s.wounded].sort((a, b) => (b.until ?? Infinity) - (a.until ?? Infinity));
  for (const g of order) {
    if (left <= 0) break;
    const take = Math.min(left, g.troops[id] ?? 0);
    if (take <= 0) continue;
    g.troops[id] = (g.troops[id] ?? 0) - take;
    if (g.troops[id] === 0) delete g.troops[id];
    left -= take;
    gone += take;
  }
  s.wounded = s.wounded.filter((g) => troopTotal(g.troops) > 0);
  return gone;
}
