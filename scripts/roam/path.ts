// Путь бродяги до первого замка — автопилот трёх стилей на заглушках (ГДД 2.4, 3.6.2, 3.9.1; ПН-0ч).
//
// **Это заглушка, а не игра.** Режима в коде почти нет (ГДД 7.1): ни дел, встреч и договоров
// (ПН-5, ПН-7), ни вольных замков (ПН-10). Поэтому путь здесь — схема ГДД, где каждое число, которого нет в коде, приходит
// входом (`PathKnobs` — только из `Ctx.use` раздела, см. `run.ts`), а всё, что в коде уже есть, — дверью. С ПН-1 отряд между
// делами живёт дверями партии бродяги: паёк и фураж сезона (`roamrules.bandRationPerDay`, `forageShare`), жалованье, терпение
// героя и уход равной долей (`sim/upkeep.bandUpkeep` на партии-оболочке), вместимость обоза (`sim/roam.cargoCap`); мощь и перевод в бой
// (`price.troopPower`, `kindsOf`), бой в поле и у стены ядром мира (`world/battle.resolveField`, `fights.wallFight`), отряд и
// гарнизон НПС (`garrison.raidingParty`, `garrisonOf`), потери долей родов (`price.shareLosses`), престиж и его ступень по
// порогам-заглушкам (`sim/prestige.prestigeAfter`, `prestigeStage`, ПН-2), путь
// (`geo.travelTime`, `pvp.generalSpeed`, `pace.realMs`) и случайность (`sim/random.seeded`). Каждая пачка заменяет свою часть
// дверью, и тогда этот модуль худеет до вызова настоящего шага.
//
// Устройство. Время — настоящие часы от выхода. Игрок заходит 3–5 раз в сутки в часы бодрствования (правило 2.4); на заходе
// он либо идёт на штурм вольного замка, если дорос, либо берёт договор из трёх предложений, либо растит отряд. Разбоя в
// Срезе 1 нет (Р10), поэтому все три стиля живут договорами; разнятся они риском, лагерем, маршем, запасом и наймом. Между заходами отряд живёт сам: ест, платит, принимает просящихся, уходит неуплатой.
import type { RoamState, TroopId } from '../../src/game/types';
import type { TroopStack } from '../../src/game/battle/kinds';
import { kindsOf, shareLosses, troopPower } from '../../src/game/battle/price';
import { DAY_LENGTH, dayRealSeconds, realMs } from '../../src/game/pace';
import { createInitialState } from '../../src/game/state';
import { seasonMods } from '../../src/game/derived';
import { bandRationPerDay, bandWage, bandWagesPerDay, forageShare } from '../../src/game/roamrules';
import { bandUpkeep } from '../../src/game/sim/upkeep';
import { cargoCap } from '../../src/game/sim/roam';
import { prestigeAfter, prestigeStage } from '../../src/game/sim/prestige';
import { mixSeed, seeded } from '../../src/game/sim/random';
import { wallFight } from '../../src/world/fights';
import { garrisonOf } from '../../src/world/garrison';
import { travelTime } from '../../src/world/geo';
import { generalSpeed } from '../../src/world/pvp';
import { SCALING, wallFront } from '../../src/world/wall';
import { LAIR_GOLD_PER_POWER } from '../../src/world/data/tuning';
import type { Gait } from '../../src/world/data/gait';
import { standWay } from '../../src/world/roammove';
import { MARKS, type Camp, type Mark, type Origin } from './kinds';
import { fieldFight } from './foes';

/** Стиль игры автопилота — параметр прибора, как `Player` у автопилота посёлка; не вход ГДД и не заглушка пачки. */
export interface Style {
  id: 'ataman' | 'captain' | 'careful';
  name: string;
  /** До какой доли ровного боя своей ступени отряд берёт дело. */
  edge: number;
  /** Доля побед в разведке штурма, с которой отряд идёт на замок. */
  storm: number;
  camp: Camp;
  gait: Gait;
  /** Сверх срока до следующего захода — сколько настоящих часов содержания отряд держит в кошеле, прежде чем тратить на рост. */
  margin: number;
  /** Принимает всех просящихся, а не столько, сколько прокормит запас. */
  takeAll: boolean;
  /** В кого растит дубинщиков и кого нанимает. */
  grow: TroopId;
}

export const STYLES: readonly Style[] = [
  {
    id: 'ataman',
    name: 'Атаман',
    edge: 1,
    storm: 0.5,
    camp: 'hidden',
    gait: 'light',
    margin: 1,
    takeAll: true,
    grow: 'axeman',
  },
  {
    id: 'captain',
    name: 'Капитан',
    edge: 0.9,
    storm: 0.75,
    camp: 'open',
    gait: 'normal',
    margin: 3,
    takeAll: false,
    grow: 'spearman',
  },
  {
    id: 'careful',
    name: 'осторожный',
    edge: 0.75,
    storm: 1,
    camp: 'ruin',
    gait: 'normal',
    margin: 6,
    takeAll: false,
    grow: 'spearman',
  },
];

/** Всё, чего у пути нет в коде, — из входов раздела. */
export interface PathKnobs {
  sessions: { per: readonly [number, number]; wake: readonly [number, number] };
  stages: readonly number[];
  stageTier: readonly number[];
  S: number;
  K: number;
  R: number;
  term: { roads: number; days: number };
  /** Содержание эталона тира I…III, золота за игровой день. */
  etalonUpkeep: readonly number[];
  marks: { share: Record<Mark, number>; ripe: readonly [number, number] };
  reach: { deed: readonly [number, number]; castle: readonly [number, number] };
  recruits: {
    per: readonly (readonly [number, number])[];
    every: readonly [number, number];
    camp: Record<Camp, number>;
  };
  /** Фураж по виду лагеря (ориентир ПН-3); сезон — дверь ПН-1. */
  forage: Record<Camp, number>;
  /** Доля еды из села; остальное — рынок города. */
  foodMix: number;
  /** Золота за единицу еды: село и рынок города. */
  foodPrice: { village: number; town: number };
  defeat: { purse: number; prestige: number };
  /** Вольный замок I: с какой ступени престижа и мощь гарнизона. */
  castle: { stage: number; power: number };
  /** Договоров на доске за заход и сколько их можно держать. */
  board: number;
  contracts: number;
  upgrade: (from: TroopId, to: TroopId) => number;
  hire: (id: TroopId) => number;
  limitDays: number;
}

export interface PathRun {
  style: Style['id'];
  origin: Origin['id'];
  seed: number;
  /** Час взятия замка; `null` — не взял за срок. */
  castleAt: number | null;
  /** Час входа в ступень престижа; `null` — не вошёл. */
  stageAt: (number | null)[];
  /** Отряд в минуту входа в ступень — эталон ступени для силы НПС. */
  bandAt: (TroopStack | null)[];
  deeds: number;
  wins: number;
  storms: number;
  deserted: number;
  recruited: number;
  prestige: number;
  purse: number;
  band: TroopStack;
}

const total = (t: TroopStack): number => Object.values(t).reduce((n: number, v) => n + Math.max(0, v ?? 0), 0);
const add = (t: TroopStack, id: TroopId, n: number): void => {
  t[id] = (t[id] ?? 0) + n;
};
const minus = (t: TroopStack, lost: TroopStack): void => {
  for (const [id, n] of Object.entries(lost) as [TroopId, number][]) t[id] = Math.max(0, (t[id] ?? 0) - n);
};

/** Ступень престижа по порогам — дверью ступеней (`sim/prestige.prestigeStage`, ПН-2); пороги — заглушка прибора. */
export const stageOf = (stages: readonly number[], prestige: number): number => prestigeStage(prestige, stages);

/** Настоящих часов пути на `dist` клеток по равнине в режиме марша — двери пути и времени. */
export const roadHours = (dist: number, gait: Gait): number => realMs(travelTime(dist, 1, generalSpeed(gait))) / 3_600_000;

/** Игровых дней в настоящем часе — дверь времени. */
const dayPerHour = (): number => 3600 / dayRealSeconds();

/** Шаг дверей отряда в модели — четверть игрового дня (см. `live`). */
const PIECE = DAY_LENGTH / 4;

const styleSalt = (style: Style, origin: Origin): number => {
  let h = 0x811c9dc5;
  for (const c of `${style.id}/${origin.id}`) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193) >>> 0;
  return h;
};

/**
 * Одна партия пути. `table` — сила НПС по ступеням (мощь), `even` — ровный бой ступени к мощи её эталона (оценка автопилота
 * «по силам ли дело»). Сиды боёв — из `seed` и номера дела: та же партия — тот же путь бит в бит.
 */
export function runPath(seed: number, style: Style, origin: Origin, table: readonly number[], even: readonly number[], k: PathKnobs): PathRun {
  const root = mixSeed(seed, styleSalt(style, origin));
  const rng = seeded(root);
  const between = (lo: number, hi: number): number => lo + (hi - lo) * rng();
  const whole = (lo: number, hi: number): number => Math.floor(between(lo, hi + 1));
  const band: TroopStack = { ...origin.band };
  // Партия-оболочка с отрядом бродяги: двери ПН-1 шагают её так же, как партию игрока. Отряд — тот же объект, что у модели.
  const party = createInitialState(root);
  party.phase = 'roam';
  const roam: RoamState = {
    origin: origin.id,
    hero: { name: '', war: origin.war },
    band,
    wounded: [],
    purse: origin.gold,
    cargo: {},
    gear: {},
    // Ход — стоянка в режиме стиля (ПН-3: режим марша живёт в ходе); лагерь своего вида — дверь ПН-3 считает его фураж.
    way: standWay(style.gait),
    camp: { kind: style.camp, since: 0, builders: 0 },
  };
  party.roam = roam;
  // Паёк и жалованье для расчётов вперёд (запас, найм) — среднего сезона; сам шаг ест сезонным пайком.
  const ration = (): number => bandRationPerDay({ band, wounded: [] }, 1);
  const wages = (): number => bandWagesPerDay(band);
  const foodGold = k.foodMix * k.foodPrice.village + (1 - k.foodMix) * k.foodPrice.town * origin.food;
  const run: PathRun = {
    style: style.id,
    origin: origin.id,
    seed,
    castleAt: null,
    stageAt: k.stages.map((_, i) => (i === 0 ? 0 : null)),
    bandAt: k.stages.map((_, i) => (i === 0 ? { ...band } : null)),
    deeds: 0,
    wins: 0,
    storms: 0,
    deserted: 0,
    recruited: 0,
    prestige: 0,
    purse: origin.gold,
    band,
  };
  let food = Math.min(origin.foodDays * ration(), cargoCap(roam));
  let t = 0;
  let busyUntil = 0;
  let nextRecruit = between(k.recruits.every[0], k.recruits.every[1]);
  // Бои взятых договоров — по порядку, в минуту прихода к цели.
  const queue: { at: number; apply: () => void }[] = [];
  const limit = k.limitDays * 24;
  const stage = (): number => stageOf(k.stages, run.prestige);
  const gain = (p: number): void => {
    const before = stage();
    run.prestige = prestigeAfter(run.prestige, p);
    for (let s = before + 1; s <= stage(); s++) {
      if (run.stageAt[s] !== null) continue;
      run.stageAt[s] = t;
      run.bandAt[s] = { ...band };
    }
  };

  // Отряд живёт сам от `t` до `to`: ест (фураж, запас, покупка), платит, ждёт неуплаты и уходит, принимает просящихся. Шаг дверей —
  // четверть игрового дня: правило ухода — доля в день, и мельче шага игры (`CATCHUP_STEP`) итог не меняется дальше доли человека,
  // а шагов в семь с половиной раз меньше.
  const live = (to: number): void => {
    while (t < to) {
      while (queue.length > 0 && queue[0].at <= t) (queue.shift() as { apply: () => void }).apply();
      const dt = Math.min(1, to - t, queue.length > 0 ? Math.max(1e-6, queue[0].at - t) : 1);
      // В пути — пока идёт дело; дошёл — снова лагерем своего стиля.
      const camp: Camp | 'road' = t < busyUntil ? 'road' : style.camp;
      roam.camp = camp === 'road' ? null : { kind: camp, since: 0, builders: 0 };
      roam.purse = run.purse;
      const before = total(band);
      for (let left = dt * dayPerHour() * DAY_LENGTH; left > 1e-9; left -= PIECE) {
        const piece = Math.min(PIECE, left);
        party.time += piece;
        const mods = seasonMods(party);
        const need = (bandRationPerDay(roam, mods.food) * piece) / DAY_LENGTH;
        // Фураж: сезон и вид лагеря — дверь (`forageShare`; доли скрытого и руин — заглушки игры ПН-3, `game/roamstubs`).
        const land = forageShare(mods, roam);
        let rest = need * (1 - land);
        const eat = Math.min(food, rest);
        food -= eat;
        rest -= eat;
        const buy = foodGold > 0 ? Math.min(rest, roam.purse / foodGold) : rest;
        roam.purse -= buy * foodGold;
        rest -= buy;
        // Жалованье, долг, терпение героя и уход равной долей — дверь содержания отряда.
        bandUpkeep(party, piece, need > 0 ? rest / need : 0);
      }
      run.purse = roam.purse;
      run.deserted += Math.max(0, before - total(band));
      food = Math.min(food, cargoCap(roam));
      t += dt;
      while (nextRecruit <= t) {
        const [lo, hi] = k.recruits.per[stage()];
        const came = Math.round(between(lo, hi) * k.recruits.camp[style.camp]);
        // Сколько прокормит кошель сверх запаса отряда на полсуток — у тех, кто берёт не всех.
        const head = (bandWage('clubman') + bandRationPerDay({ band: { clubman: 1 }, wounded: [] }, 1) * foodGold) * dayPerHour() * (12 + style.margin);
        const room = style.takeAll ? came : Math.max(0, Math.floor((run.purse - reserve(12)) / head));
        const n = Math.min(came, room);
        if (n > 0) {
          add(band, 'clubman', n);
          run.recruited += n;
        }
        nextRecruit += between(k.recruits.every[0], k.recruits.every[1]);
      }
    }
  };

  // Запас: содержание отряда до следующего захода и поле стиля — ночь без заходов не должна кончаться уходом.
  const reserve = (gap: number): number => (wages() + ration() * foodGold) * dayPerHour() * (gap + style.margin);

  // Рост на заходе: повышение дубинщиков в вид стиля, потом найм в городе — пока кошель выше запаса.
  const grow = (gap: number): void => {
    for (let i = 0; i < 200; i++) {
      const up = (band.clubman ?? 0) > 0 ? k.upgrade('clubman', style.grow) * origin.gear : Infinity;
      const hire = k.hire(style.grow) * origin.hire;
      const price = Math.min(up, hire);
      if (!Number.isFinite(price) || run.purse - price < reserve(gap)) return;
      run.purse -= price;
      if (up <= hire) add(band, 'clubman', -1);
      add(band, style.grow, 1);
    }
  };

  const lost = (share: number): void => {
    const l = shareLosses(band, share);
    minus(band, l);
  };

  const wiped = (): void => {
    if (total(band) > 0) return;
    run.purse *= 1 - k.defeat.purse;
  };

  const sessionsOf = (day: number): number[] => {
    const n = whole(k.sessions.per[0], k.sessions.per[1]);
    return Array.from({ length: n }, () => day * 24 + between(k.sessions.wake[0], k.sessions.wake[1])).sort((a, b) => a - b);
  };

  // Часы партии — от первого захода: игрок видит отряд с минуты выхода, и до неё отряд не живёт.
  const drawn = Array.from({ length: k.limitDays }, (_, day) => sessionsOf(day)).flat();
  const times = drawn.map((h) => h - drawn[0]);
  /** Часов от `h` до первого захода не раньше `h` — того, на котором игрок сможет распорядиться отрядом снова. */
  const untilNext = (h: number): number => (times.find((x) => x > h) ?? h + 12) - h;
  let deed = 0;
  for (const at of times) {
    if (run.castleAt !== null || at >= limit) break;
    live(at);
    if (at < busyUntil) continue;
    const s = stage();
    const power = troopPower(band);
    // Штурм с ходу: дорос ли по ступени и по силе — разведкой четырьмя боями у стены (сиды разведки — не сиды штурма).
    if (s >= k.castle.stage && power >= 0.8 * k.castle.power) {
      const scout = [1, 2, 3, 4].filter((i) => storm(band, k.castle.power, mixSeed(root, 9000 + deed * 8 + i))).length / 4;
      if (scout >= style.storm) {
        deed++;
        run.storms++;
        const road = roadHours(between(k.reach.castle[0], k.reach.castle[1]), style.gait);
        busyUntil = at + 2 * road;
        live(at + road);
        const r = stormFight(band, k.castle.power, mixSeed(root, 5000 + deed));
        lost(r.loss);
        if (r.won) {
          run.castleAt = t;
          break;
        }
        gain(-run.prestige * k.defeat.prestige);
        wiped();
        continue;
      }
    }
    // Договоры: доска ступени, по силам — до `edge` ровного боя ступени; берётся до `contracts` лучших по плате за час пути, и
    // отряд идёт по ним подряд, от города к цели и назад (3.8.4).
    const offers = Array.from({ length: k.board }, () => {
      const mark: Mark = MARKS[whole(0, MARKS.length - 1)];
      const tier = whole(1, k.stageTier[s]);
      const foe = table[s] * k.marks.share[mark] * between(k.marks.ripe[0], k.marks.ripe[1]);
      const road = roadHours(between(k.reach.deed[0], k.reach.deed[1]), style.gait);
      const roadDays = road * dayPerHour();
      // Договор (3.8.3): содержание эталона тира на срок и доля риска — добыча, у Воина и Уведённого её больше (3.1).
      const pay = k.etalonUpkeep[tier - 1] * (k.term.roads * roadDays + k.term.days) * k.K + foe * LAIR_GOLD_PER_POWER * k.R * origin.loot;
      const fame = foe / k.S + tier * 10;
      return { mark, tier, foe, road, pay, fame };
    });
    const able = offers.filter((o) => o.foe <= power * even[s] * style.edge);
    if (able.length === 0) {
      grow(untilNext(at));
      continue;
    }
    const taken = [...able].sort((a, b) => b.pay / b.road - a.pay / a.road).slice(0, k.contracts);
    let when = at;
    for (const o of taken) {
      deed++;
      run.deeds++;
      const seedOf = mixSeed(root, deed);
      const tag = `roam-${style.id}-${origin.id}-${seed}-${deed}`;
      queue.push({
        at: when + o.road,
        apply: () => {
          // Отряд, ослабший в прежнем бою цепочки, на дело не по силам не идёт: договор сорван, платы нет.
          if (o.foe > troopPower(band) * even[s] * style.edge) return;
          const r = fieldFight(band, o.foe, seedOf, tag);
          lost(r.loss);
          if (r.won) {
            run.wins++;
            run.purse += o.pay;
            gain(o.fame);
          } else {
            gain(-run.prestige * k.defeat.prestige);
            wiped();
          }
        },
      });
      when += 2 * o.road;
    }
    busyUntil = when;
    live(Math.min(busyUntil, limit));
    grow(untilNext(busyUntil));
  }
  return run;
}

/** Штурм вольного замка с ходу: гарнизон — строй замка (`garrisonOf`, `castle`), фронт — лестницы (`wall.SCALING`). */
function stormFight(band: TroopStack, power: number, seed: number): { won: boolean; loss: number } {
  const g = garrisonOf(seed, 'roam-castle', power, true);
  const { field } = wallFight({
    seed,
    attacker: { kinds: kindsOf(band) },
    defender: { kinds: g.kinds, militia: 0, archers: 0 },
    front: wallFront(SCALING),
  });
  return { won: field.won, loss: field.attackerLoss };
}

const storm = (band: TroopStack, power: number, seed: number): boolean => stormFight(band, power, seed).won;
