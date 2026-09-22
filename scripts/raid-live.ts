// Прогон «Найма» — `live`: посёлок, мир и игрок, который платит за войско, шагом общего автопилота.
// Вынесен из `raid-hiring.ts` переносом, без правки: его зовут три раздела («Найм», «Лазарет»,
// «Оборона по составу»), а разделы разведены по отчётам (docs/realm.md, раздел 8), и «Обороне по
// составу» незачем тянуть в своё замыкание таблицы «Найма».
import type { GameState, TroopId } from '@/game/types';
import type { FigureView, HomeEffect, PlayerProfile } from '@/world/types';
import type { LocalWorld } from '@/world/local/LocalWorld';
import { awayOf, homeOf, type Away } from '@/world/muster';
import { BATTLE_MAN, troopPower, troopTotal, type TroopStack } from '@/game/battle/kinds';
import { popGrowth } from '@/game/sim/population';
import {
  armySize,
  bedsTaken,
  buildingOfType,
  defense,
  healShare,
  infirmaryBeds,
  productionPerDay,
  soldierFoodPerDay,
  upkeepInfo,
  wageOf,
  woundedStacks,
} from '@/game/derived';
import { shareOf } from '@/game/sim/infirmary';
import {
  GAME,
  pilot,
  player,
  unitCost,
  type Ledger,
  type Player,
  type Run,
  type Step,
} from './autopilot';
import { sum } from './raid-common';

export type Style = 'means' | 'meansHigh' | 'feed' | 'builder';
export const STYLES: Style[] = ['means', 'meansHigh', 'feed', 'builder'];
export const NAME: Record<Style, string> = {
  means: 'по средствам',
  meansHigh: 'по средствам, высокий налог',
  feed: 'всё, что прокормит',
  builder: 'строит',
};

/**
 * Поведение — это игрок общего автопилота с параметрами, а не свой автопилот. Налог закреплён у
 * поведения: высокий — у «высокого налога», умеренный — у остальных.
 */
const playerOf = (style: Style, over: Partial<Player> = {}): Player =>
  style === 'builder'
    ? player(null, { tax: 'moderate', build: false, siegeLevy: true, ...over })
    : player(style === 'feed' ? 'feed' : 'means', { tax: style === 'meansHigh' ? 'high' : 'moderate', build: false, ...over });

/** Счёт найма сверх того, что ведёт сам автопилот: жалованье, доход, дома и восстановление после боя. */
interface HireLedger extends Ledger {
  /** Причины ухода по решениям, где войско уходило. */
  whyPay: number;
  whyFood: number;
  wages: number[];
  income: number[];
  debt: number;
  armyHome: number[];
  /** Жители и оборона посёлка по решениям. */
  pops: number[];
  defs: number[];
  /** Восстановление после удержанного боя: сколько мс до прежнего числа дома; null — не успели. */
  restore: { at: number; target: number; lost: number; done: number | null; cost: number }[];
  /** Каждый бой, стоивший бойцов, — для раздела «Лазарет» (`raid-infirmary.ts`). */
  fights: Fight[];
  /** Прирост жителей за игровой день по решениям (`popGrowth`). */
  growth: number[];
  /** Решений, на которых войску не хватало еды, и из них — где строка тревоги назвала повод неуплатой. */
  unfed: number;
  unfedAsPay: number;
  /**
   * Ушло из строя голодом и неуплатой — по строкам летописи, которые пишет сама дверь содержания
   * (`desert:<вид>:food`, `desert:<вид>`, `desert:<вид>:home`). Голодом уходят совсем, поэтому
   * `starvedHome` обязан быть нулём: поводы делят уходящих, и жителем возвращается только неуплата.
   */
  starvedLine: number;
  paidLine: number;
  starvedHome: number;
  /** Лазарет по решениям: наибольшее число занятых мест и решений с полным лазаретом. */
  bedsPeak: number;
  bedsFull: number;
  /** Встало из лазарета в строй, ушло голодом из лазарета и с учений — по строкам летописи. */
  risen: number;
  starvedWounded: number;
  starvedDrafts: number;
  /** Раненые полководца, привезённые дружиной: легли и не хватило мест. */
  broughtLaid: number;
  broughtLost: number;
}

/**
 * Бой, стоивший бойцов, глазами лазарета. Пишется крючками прибора: прогон от них не меняется.
 * `kind` — по имени последствия, которое мир собирает из того, что случилось.
 */
export interface Fight {
  /** мс от начала прогона. */
  at: number;
  kind: FightKind;
  lost: number;
  lostBy: TroopStack;
  /** Сколько бойцов вышло в бой; 0 — прибор этого не знает (падение, лагерь, разгром полководца). */
  went: number;
  /** Всё войско в минуту, когда последствие легло. */
  army: number;
  /** Уровень лазарета и его доля в эту минуту. */
  level: number;
  heal: number;
  /** Ранены: легли в лазарет, остались при полководце, не хватило мест (`sim/infirmary`). */
  laid: number;
  carried: number;
  noBed: number;
  /**
   * Ранены в этом бою — в бойцах строя (место в лазарете — боец строя, `derived.bedsTaken`): доля павших дома и в
   * поле той же раскладкой, что `sim/infirmary.woundsOfBattle`. 0 — потери рассеяны.
   */
  woundMen: number;
  /** Выработка еды посёлка в эту минуту, в игровой день. */
  food: number;
  /** Паёк бойца в эту минуту (`soldierFoodPerDay`) и среднее жалованье павшего (`wageOf` по составу павших), в игровой день. */
  eat: number;
  wage: number;
}

export type FightKind = 'стена: удержали' | 'стена: прорыв' | 'вылазка' | 'удар по лагерю' | 'перехват' | 'удар полководца' | 'падение голодом' | 'наш лагерь' | 'разгром полководца' | 'прочее';

export function fightKind(e: HomeEffect): FightKind {
  if (e.id.endsWith('-defense')) return e.battle === 'won' ? 'стена: удержали' : 'стена: прорыв';
  if (e.id.endsWith('-fell')) return 'падение голодом';
  if (e.id.startsWith('camp-wear')) return 'наш лагерь';
  if (e.id.startsWith('fig-')) return 'разгром полководца';
  if (e.id.endsWith('-battle')) return 'удар полководца';
  if (e.id.endsWith('-eff')) {
    if (e.id.startsWith('sortie')) return 'вылазка';
    if (e.id.startsWith('camp')) return 'удар по лагерю';
    if (e.id.startsWith('chase')) return 'перехват';
  }
  return 'прочее';
}

export interface Out {
  run: Run;
  l: HireLedger;
  g: GameState;
}

interface Opts {
  g: GameState;
  seed: number;
  style: Style;
  step?: Step;
  hours: number;
  ripe: boolean;
  ref?: number;
  /** Поднимает ли игрок уровни (партия с первой секунды — да, лестница мерки — нет). */
  build?: boolean;
  /** Своё действие отчёта — после расстановки, до найма. */
  also?: (g: GameState) => void;
  /** Состав найма; нет — мерка `MIX` общего автопилота. */
  mix?: TroopStack;
  hourly?: (h: number, g: GameState) => void;
  effect?: (e: HomeEffect, now: number) => void;
  after?: (x: { g: GameState; world: LocalWorld; now: number; figures: FigureView[] }) => Promise<void>;
  /** Крючки прибора, без них прогон тот же. */
  profile?: (p: PlayerProfile, g: GameState, away: Away) => void;
  /** Сколько бойцов было при полководце перед его последним ударом — знает тот, кто его ведёт. */
  strikeWent?: () => number;
}

export async function live(o: Opts): Promise<Out> {
  const { g, style } = o;
  const x = {
    whyPay: 0,
    whyFood: 0,
    wages: [] as number[],
    income: [] as number[],
    debt: 0,
    armyHome: [] as number[],
    pops: [] as number[],
    defs: [] as number[],
    restore: [] as HireLedger['restore'],
    fights: [] as Fight[],
    growth: [] as number[],
    unfed: 0,
    unfedAsPay: 0,
    starvedLine: 0,
    paidLine: 0,
    starvedHome: 0,
    bedsPeak: 0,
    bedsFull: 0,
    risen: 0,
    starvedWounded: 0,
    starvedDrafts: 0,
    broughtLaid: 0,
    broughtLost: 0,
  };
  // Строки летописи, уже сосчитанные: склеенные растут счётчиком `n`.
  const seen = new WeakMap<object, number>();
  // Кто вышел в бой: у стены — войско дома перед пульсом, у вылазки — кого выпустили.
  let homeBefore = 0;
  let sortieWent = 0;
  let wounds = { lying: 0, carried: 0 };
  let open: Fight | null = null;
  const woundsNow = (s: GameState) => {
    const w = woundedStacks(s);
    return { lying: troopTotal(w.lying), carried: troopTotal(w.carried) };
  };
  const flown = await pilot({
    g,
    seconds: o.hours * 3600,
    player: playerOf(style, { build: o.build ? { skip: [] } : false, also: o.also, mix: o.mix }),
    world: { seed: o.seed, pulse: 30, raids: true, ripe: o.ripe, step: o.step ?? GAME, ref: o.ref },
    economy: 'live',
    tick: 1,
    decide: 30,
    watch: {
      decided: (s) => {
        const u = upkeepInfo(s);
        if (u.leavingPerDay > 0) {
          if (u.why === 'food') x.whyFood++;
          else x.whyPay++;
        }
        x.wages.push(u.wages);
        x.pops.push(s.pop);
        x.defs.push(defense(s));
        x.income.push(u.income);
        x.growth.push(popGrowth(s).perDay);
        if (u.unfed > 0) {
          x.unfed++;
          if (u.why === 'pay') x.unfedAsPay++;
        }
        const taken = bedsTaken(s);
        x.bedsPeak = Math.max(x.bedsPeak, taken);
        if (taken > 0 && taken >= infirmaryBeds(s)) x.bedsFull++;
        for (const e of s.log) {
          const n = e.n ?? 1;
          const was = seen.get(e) ?? 0;
          if (n <= was) continue;
          seen.set(e, n);
          if (e.group?.startsWith('desert:')) {
            if (e.group.endsWith(':food')) x.starvedLine += n - was;
            else x.paidLine += n - was;
            // Строка «остался в посёлке жителем» бывает только у неуплаты; голодная здесь — поломка правила.
            if (e.group.endsWith(':home') && e.text.includes('нечем кормить')) x.starvedHome += n - was;
          } else if (e.group?.startsWith('wound:back:')) x.risen += n - was;
          else if (e.group?.startsWith('starve:wounded:')) x.starvedWounded += n - was;
          else if (e.group?.startsWith('starve:draft:')) x.starvedDrafts += n - was;
          else if (was === 0) {
            const m = /^Дружина привезла раненых: (\d+) легли[^,]*(?:, (\d+) не хватило)?/.exec(e.text);
            if (m) {
              x.broughtLaid += Number(m[1]);
              x.broughtLost += Number(m[2] ?? 0);
            }
          }
        }
      },
      hourly: o.hourly,
      profile: (p, s, away) => {
        homeBefore = troopTotal(homeOf(s.army, away));
        o.profile?.(p, s, away);
      },
      sortie: (home) => {
        sortieWent = troopTotal(home);
      },
      landed: (e, s) => {
        if (open === null) return;
        const after = woundsNow(s);
        open.laid = after.lying - wounds.lying;
        open.carried = after.carried - wounds.carried;
        // Ранены из павших дома той же раскладкой, что у игры: сколько из них не легло — «не хватило мест».
        if (!e.routed) {
          const home: TroopStack = {};
          for (const [id, n] of Object.entries(open.lostBy) as [TroopId, number][]) {
            const k = n - (e.field?.[id] ?? 0);
            if (k > 0) home[id] = k;
          }
          open.noBed = Math.max(0, troopTotal(shareOf(home, troopTotal(home) * open.heal)) - open.laid);
          const field: TroopStack = {};
          for (const [id, n] of Object.entries(open.lostBy) as [TroopId, number][]) {
            const k = Math.min(n, e.field?.[id] ?? 0);
            if (k > 0) field[id] = k;
          }
          const men = (x: TroopStack): number => troopPower(shareOf(x, troopTotal(x) * open!.heal)) / BATTLE_MAN;
          open.woundMen = men(home) + men(field);
        }
        x.fights.push(open);
        open = null;
      },
      effect: (e, now) => {
        o.effect?.(e, now);
        const lost = troopTotal(e.lostTroops ?? {});
        if (lost > 0) {
          const kind = fightKind(e);
          const went = kind === 'стена: удержали' || kind === 'стена: прорыв' ? homeBefore : kind === 'вылазка' ? sortieWent : kind === 'удар полководца' ? (o.strikeWent?.() ?? 0) : 0;
          const inf = buildingOfType(g, 'infirmary');
          wounds = woundsNow(g);
          open = { at: now, kind, lost, lostBy: { ...(e.lostTroops ?? {}) }, went, army: armySize(g), level: inf?.level ?? 0, heal: healShare(g), laid: 0, carried: 0, noBed: 0, woundMen: 0, food: productionPerDay(g).food, eat: soldierFoodPerDay(g), wage: sum((Object.entries(e.lostTroops ?? {}) as [TroopId, number][]).map(([id, n]) => n * wageOf(g, id))) / lost };
        }
        if (e.id.endsWith('-defense') && e.battle === 'won') {
          const lost = e.lostTroops ?? {};
          const n = troopTotal(lost);
          if (n > 0) {
            const cost = sum((Object.entries(lost) as [TroopId, number][]).map(([id, k]) => k * unitCost(id)));
            x.restore.push({ at: now, target: -n, lost: n, done: null, cost });
          }
        }
      },
      after: async ({ g: s, world, now, marches, figures }) => {
        const home = troopTotal(homeOf(s.army, awayOf(marches, figures)));
        x.armyHome.push(home);
        for (const r of x.restore) {
          // Цель — сколько было дома до боя: потерянные плюс оставшиеся в минуту, когда бой лёг.
          if (r.target < 0 && r.at <= now) r.target = home + r.lost;
          else if (r.done === null && r.target > 0 && home >= r.target) r.done = now - r.at;
        }
        await o.after?.({ g: s, world, now, figures });
      },
    },
  });
  x.debt = g.pay.debt;
  return { run: flown.run, l: Object.assign(flown.ledger, x), g };
}
