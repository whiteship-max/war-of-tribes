// Лазарет — раздел `sack:report`.
//
// Раздел заведён до кода лазарета (docs/infirmary.md) тем же порядком, что содержание войска
// и башня: сначала числа, на которых стоит предложение, потом решение владельца, потом код.
// Меряется ровно то, что нужно предложению:
//
//  1. **Что лазарет даёт сегодня** — `healShare` по уровням, настоящей функцией игры.
//  2. **Сколько бойцов игрок теряет в настоящем мире** — `LocalWorld` с настоящим племенем и
//     пульсом, каким его гоняет `world/store` (слепок → последствия → `applyExpedition`),
//     в трёх манерах игры. Потери и то, что вернул лазарет, читаются из самого племени.
//  3. **Сколько он терял бы, если бы бой что-то решал** — та же охота полководца, но ближнее
//     логово силой зеркалит войско игрока (`world/mirror.mirrorPower`, стенд `MIRROR_ON`).
//     Стенд выключен для игроков, поэтому здесь он подставлен в экземпляр мира: сила логова
//     спрашивается у стенда, а весь остальной путь боя — мир как есть.
//  4. **Скорость и цена** — учения (`recruitRate`), ковка снаряжения (`forgeRate`), еда бойца
//     (`soldierFoodPerDay`) и жалованье (`wageOf`) на посёлке каждого уровня.
//  5. **Уход войска** — сколько добавили бы к доле ухода раненые, если бы ели из котла, а в
//     войске не числились. Здесь своя арифметика — `foodShortfall` с прибавкой к расходу, —
//     потому что раненых в игре ещё нет; подписана как таковая.
//
// Все числа — против нынешнего потолка набегов (`AI_POWER_SHARE`, `AI_POWER_VS_DEFENSE`):
// решит его владелец — раздел гоняется заново целиком.
import { LocalWorld } from '@/world/local/LocalWorld';
import { applyEffects, playerProfile, syncAway, syncSiege } from '@/world/bridge';
import { awayOf, homeOf } from '@/world/muster';
import { generateWorld, isLair, type GenSettlement } from '@/world/gen';
import { lairPhase } from '@/world/lairs';
import { distance } from '@/world/geo';
import { mirrorPower } from '@/world/mirror';
import { AI_POWER_SHARE, AI_POWER_VS_DEFENSE, AI_RANGE, SIEGE_ROUT } from '@/world/data/tuning';
import type { WorldSave } from '@/world/local/state';
import type { Coord, FigureView, MarchView } from '@/world/types';
import { createInitialState } from '@/game/state';
import { autoAssign } from '@/game/sim/workers';
import {
  armySize,
  buildingOfType,
  foodShortfall,
  forgeRate,
  healShare,
  housingCapacity,
  recruitRate,
  soldierFoodPerDay,
  storageCap,
  wageOf,
} from '@/game/derived';
import { DAY_LENGTH, INFIRMARY_HEAL_CAP, MAX_BUILDING_LEVEL, RESOURCE_IDS } from '@/game/constants';
import { TROOPS, TROOP_BY_ID } from '@/game/data/troops';
import { EQUIPMENT_BY_ID } from '@/game/data/equipment';
import { troopTotal, type TroopStack } from '@/game/battle/kinds';
import type { GameState, TroopId } from '@/game/types';

const MIN = 60_000;
const START = 1_700_000_000_000;
const HOURS = 4;
const SEEDS = [7, 11, 42, 51, 77];
const LEVELS = [1, 5, 10];
/** Состав войска посёлка — тот же, что у осады (`siege:report`): замеры сравнимы между отчётами. */
const MIX: TroopStack = { spearman: 4, archer: 3, legionary: 2, rider: 1 };
/** Мерка войска посёлка уровня L — та же, что у `siege:report`: две прежние вместимости Статуи. */
const armyAt = (level: number): number => 2 * (20 + 10 * (level - 1));

const pad = (v: string | number, w: number): string => String(v).padStart(w);
const pct = (x: number): string => `${Math.round(x * 100)}%`;

/** Посёлок уровня L: жильё на 90 %, склад полон, войско — `armyAt` по `MIX`. */
function townAt(level: number): GameState {
  const g = createInitialState(7);
  g.tutorialDone = true;
  for (const b of g.buildings) b.level = level;
  g.pop = Math.round(housingCapacity(g) * 0.9);
  const n = armyAt(level);
  let left = n;
  const ids = Object.keys(MIX) as TroopId[];
  ids.forEach((id, i) => {
    const k = i === ids.length - 1 ? left : Math.round((n * (MIX[id] ?? 0)) / 10);
    g.army[id] = k;
    left -= k;
  });
  autoAssign(g);
  for (const r of RESOURCE_IDS) g.resources[r] = storageCap(g);
  return g;
}

function memory(data: string | null = null) {
  return {
    read: (): string | null => data,
    write: (json: string): void => {
      data = json;
    },
  };
}

/** Настоящее состояние мира: отчёт — прибор, ему положено видеть больше панели. */
interface Inside {
  save: WorldSave;
  gen: { settlements: GenSettlement[] };
  alive(s: GenSettlement, now: number): boolean;
  powerNow(s: GenSettlement, now: number): number;
}
const inside = (w: LocalWorld): Inside => w as unknown as Inside;

function nearestLair(w: LocalWorld, now: number, from: Coord): Coord | null {
  const save = inside(w).save;
  const live: Coord[] = [];
  for (const x of [...generateWorld(save.seed).settlements.filter(isLair), ...save.spawned]) {
    if (distance(x, save.home) > AI_RANGE) continue;
    if (lairPhase(save.lairs[x.id] ?? { bornAt: save.createdAt, burnedAt: 0 }, now) !== 'alive') continue;
    live.push({ x: x.x, y: x.y });
  }
  live.sort((a, b) => Math.hypot(a.x - from.x, a.y - from.y) - Math.hypot(b.x - from.x, b.y - from.y));
  return live[0] ?? null;
}

type Style = 'defend' | 'passive' | 'hunt' | 'mirror';
const STYLE_NAME: Record<Style, string> = {
  defend: 'дома, на осаду — вылазкой',
  passive: 'дома, на осаду не отвечает',
  hunt: 'полководец жжёт логова',
  mirror: 'то же, логово — зеркало войска',
};

interface Fight {
  kind: string;
  went: number;
  lost: number;
}
interface Run {
  fights: Fight[];
  /** Минуты мира, в которые полководец бил. */
  strikes: number[];
  battles: number;
  healed: number;
  armyEnd: number;
}

/** Вид боя по последствию: имя последствия мир собирает из того, что случилось. */
function kindOf(id: string): string {
  if (id.endsWith('-defense')) return 'частокол';
  if (id.endsWith('-battle')) return 'удар полководца';
  if (id.endsWith('-fell')) return 'падение города';
  if (id.startsWith('camp-wear')) return 'наш лагерь';
  if (id.startsWith('fig-')) return 'разгром полководца';
  if (id.endsWith('-eff')) return 'бой у лагеря';
  return 'прочее';
}

async function play(level: number, seed: number, style: Style): Promise<Run> {
  const g = townAt(level);
  let now = START;
  const world = new LocalWorld({ seed, now: () => now, storage: memory() });
  if (style === 'mirror') {
    const w = inside(world);
    const own = w.powerNow.bind(w);
    w.powerNow = (s, at) =>
      mirrorPower(
        { lairs: w.gen.settlements, home: w.save.home, seed: w.save.seed, profile: w.save.profile ?? null },
        (x, t) => w.alive(x, t),
        s,
        at,
      ) ?? own(s, at);
  }
  let marches: MarchView[] = [];
  let figures: FigureView[] = [];
  const run: Run = { fights: [], strikes: [], battles: 0, healed: 0, armyEnd: 0 };
  // Сколько вышло в бой — знает тот, кто послал: удар полководца и вылазка. У частокола и
  // падения выходит весь гарнизон, и доля «от вышедших» там не печатается.
  let strikeWent = 0;
  let sortieWent = 0;
  const pulse = async () => {
    const p = await world.sync(playerProfile(g, awayOf(marches, figures)));
    run.battles += p.reports.filter((r) => r.battle).length;
    for (const e of p.effects) {
      const lost = troopTotal(e.lostTroops ?? {});
      if (lost === 0) {
        applyEffects(g, [e]);
        continue;
      }
      const diedBefore = g.stats.died;
      applyEffects(g, [e]);
      // Лазарет возвращает раненых жителями; погибшими племя считает остальных.
      run.healed += Math.max(0, lost + (e.lost.scout ?? 0) - (g.stats.died - diedBefore));
      const kind = kindOf(e.id);
      const went = kind === 'удар полководца' ? strikeWent : kind === 'бой у лагеря' ? sortieWent : 0;
      run.fights.push({ kind, went, lost });
    }
    syncAway(g, p.marches, p.figures);
    syncSiege(g, p.siege, p.now);
    marches = p.marches;
    figures = p.figures;
    return p;
  };
  const whole = (): TroopStack => {
    const o: TroopStack = {};
    for (const [id, n] of Object.entries(g.army)) if ((n ?? 0) > 0) o[id as TroopId] = n;
    return o;
  };

  await pulse();
  const hunting = style === 'hunt' || style === 'mirror';
  if (hunting) await world.setGarrison(whole());
  let back = false;
  let lastFight = 0;
  let lastSortie = 0;
  const until = START + HOURS * 60 * MIN;
  while (now < until) {
    now += 20_000;
    const p = await pulse();
    if (style !== 'passive' && p.siege && now - lastSortie > 5 * MIN) {
      const home = homeOf(g.army, awayOf(marches, figures));
      if (troopTotal(home) > 0) {
        sortieWent = troopTotal(home);
        await world.sortie(home);
        lastSortie = now;
      }
    }
    if (!hunting) continue;
    const gen = figures.find((f) => f.id === 'general');
    if (!gen || (gen.phase !== 'home' && gen.phase !== 'field') || gen.readyAt !== 0) continue;
    // После боя — домой и забрать всё войско заново: так играет тот, кто не нанимает.
    if (back) {
      if (gen.phase !== 'home') await world.moveFigure('general', inside(world).save.home);
      else {
        await world.setGarrison(whole());
        back = false;
      }
      continue;
    }
    if (now - lastFight < 10 * MIN) continue;
    const target = nearestLair(world, now, gen.at);
    if (!target) continue;
    if (gen.at.x !== target.x || gen.at.y !== target.y) {
      await world.moveFigure('general', target);
      continue;
    }
    strikeWent = troopTotal(gen.troops ?? {});
    const res = await world.attack({ setup: null });
    if (!res.error) {
      back = true;
      lastFight = now;
      run.strikes.push((now - START) / MIN);
    }
  }
  run.armyEnd = armySize(g);
  return run;
}

export async function infirmarySection(): Promise<void> {
  console.log('');
  console.log('--- лазарет: сколько раненых бывает и что с ними можно сделать ---');
  console.log(`Все числа — против нынешнего потолка набегов (AI_POWER_SHARE ${AI_POWER_SHARE}, AI_POWER_VS_DEFENSE ${AI_POWER_VS_DEFENSE}).`);
  console.log('');

  // 1. Что даёт лазарет сегодня.
  console.log('Доля потерь, которую лазарет возвращает жителями (healShare), по уровню здания:');
  let prev = -1;
  let flat: number | null = null;
  const row: string[] = [];
  for (let l = 1; l <= MAX_BUILDING_LEVEL; l++) {
    const g = createInitialState(7);
    for (const b of g.buildings) if (b.type === 'infirmary') b.level = l;
    const h = healShare(g);
    row.push(`L${l} ${pct(h)}`);
    if (flat === null && Math.abs(h - prev) < 1e-9) flat = l;
    prev = h;
  }
  console.log(`  ${row.join('  ')}`);
  console.log(`  Потолок INFIRMARY_HEAL_CAP ${pct(INFIRMARY_HEAL_CAP)}: ${flat === null ? 'не достигается' : `с уровня ${flat} уровень ничего не прибавляет`}.`);
  console.log('');

  // 2–3. Потери в настоящем мире.
  console.log(`Бои живого мира: ${HOURS} ч на каждом из ${SEEDS.length} миров, посёлок уровня L (войско — мерка siege:report).`);
  console.log('«потеряно» — бойцов, списанных боем (у падения — рассеянных, SIEGE_ROUT); «крупнейший» —');
  console.log('наибольшая потеря одного боя и её доля от вышедших; «вернул» — жителей по нынешнему правилу.');
  console.log('');
  console.log(' манера игры                       ур  войско  боёв  с потерями  потеряно  крупнейший (доля)  вернул  войско в конце');
  const perBattle: Record<number, number[]> = {};
  const gaps: number[] = [];
  for (const style of ['defend', 'passive', 'hunt', 'mirror'] as Style[]) {
    for (const level of LEVELS) {
      let battles = 0;
      let lossy = 0;
      let lost = 0;
      let big: Fight | null = null;
      let healed = 0;
      let end = 0;
      for (const seed of SEEDS) {
        const r = await play(level, seed, style);
        battles += r.battles;
        lossy += r.fights.length;
        healed += r.healed;
        end += r.armyEnd;
        if (style === 'mirror') for (let i = 1; i < r.strikes.length; i++) gaps.push(r.strikes[i] - r.strikes[i - 1]);
        for (const f of r.fights) {
          lost += f.lost;
          if (!big || f.lost > big.lost) big = f;
          if (style === 'mirror' && f.kind === 'удар полководца' && f.went > 0) (perBattle[level] ??= []).push(f.lost / f.went);
        }
      }
      const bigText = big ? `${big.lost} из ${big.went || '—'}${big.went ? ` (${pct(big.lost / big.went)})` : ''}` : '—';
      console.log(
        ` ${STYLE_NAME[style].padEnd(32)}  ${pad(level, 2)}  ${pad(armyAt(level), 6)}  ${pad(battles, 4)}  ${pad(lossy, 10)}  ${pad(lost, 8)}  ${pad(bigText, 17)}  ${pad(healed, 6)}  ${pad(Math.round(end / SEEDS.length), 14)}`,
      );
    }
  }
  console.log('');
  console.log('Доля вышедших, которых стоил один удар полководца по зеркальному логову:');
  for (const level of LEVELS) {
    const xs = (perBattle[level] ?? []).slice().sort((a, b) => a - b);
    if (xs.length === 0) {
      console.log(`  L${level}: ударов не было`);
      continue;
    }
    const q = (p: number): number => xs[Math.min(xs.length - 1, Math.floor(p * xs.length))];
    console.log(`  L${level}: ударов ${xs.length}, медиана ${pct(q(0.5))}, девять из десяти — не больше ${pct(q(0.9))}, наибольшая ${pct(xs[xs.length - 1])}`);
  }
  console.log(`Падение города без ответа рассеивает долю гарнизона SIEGE_ROUT (${pct(SIEGE_ROUT)}) — это крупнейшая потеря в игре без стенда.`);
  gaps.sort((a, b) => a - b);
  const gap = gaps.length > 0 ? gaps[Math.floor(gaps.length / 2)] : 0;
  console.log(`Между ударами по зеркальному логову проходит (медиана) ${gap.toFixed(0)} мин мира: дорога, бой, возврат и сбор дружины.`);
  console.log('');

  // Ёмкость из измеренных потерь: раненые одного тяжёлого боя посёлка уровня L.
  const p90 = Math.max(
    ...LEVELS.map((l) => {
      const xs = (perBattle[l] ?? []).slice().sort((a, b) => a - b);
      return xs.length > 0 ? xs[Math.min(xs.length - 1, Math.floor(0.9 * xs.length))] : 0;
    }),
  );
  console.log(`Ёмкость из измеренного: раненые одного тяжёлого удара — девять из десяти ударов стоят не больше ${pct(p90)}`);
  console.log('вышедших (наибольшая из долей трёх уровней выше); вышло всё войско посёлка уровня L (мерка siege:report);');
  console.log('ранены из потерь — доля healShare лазарета того же уровня. Свою арифметику здесь делает сама таблица.');
  console.log(' ур  войско  healShare  потеря тяжёлого удара  раненых в нём');
  for (let l = 1; l <= MAX_BUILDING_LEVEL; l++) {
    const g = createInitialState(7);
    for (const b of g.buildings) if (b.type === 'infirmary') b.level = l;
    const loss = p90 * armyAt(l);
    console.log(`  ${pad(l, 2)}  ${pad(armyAt(l), 6)}  ${pad(pct(healShare(g)), 9)}  ${pad(Math.round(loss), 21)}  ${pad(Math.ceil(loss * healShare(g)), 13)}`);
  }
  console.log('');

  // 4. Скорость и цена: найм против лечения.
  console.log('Найм бойца на посёлке уровня L (казармы и кузница того же уровня, кузница укомплектована):');
  console.log('«учения» — work / recruitRate; «ковка» — работа снаряжения вида / forgeRate;');
  console.log('«добро» — ресурсы найма и материалы снаряжения; «еда в день» и «жалованье в день» — soldierFoodPerDay, wageOf.');
  console.log(' ур  вид              учения, с  ковка, с  добро  еда/день  жалованье/день  дней еды на цену добра');
  for (const level of LEVELS) {
    const g = townAt(level);
    const smithy = buildingOfType(g, 'smithy');
    if (smithy) g.workers[smithy.id] = smithy.level * 4;
    const forge = forgeRate(g);
    const food = soldierFoodPerDay(g);
    for (const t of TROOPS) {
      let forgeWork = 0;
      let goods = Object.values(t.cost).reduce((n, v) => n + (v ?? 0), 0);
      for (const [id, per] of Object.entries(t.gear)) {
        const def = EQUIPMENT_BY_ID[id as keyof typeof EQUIPMENT_BY_ID];
        forgeWork += def.work * (per ?? 0);
        goods += Object.values(def.cost).reduce((n, v) => n + (v ?? 0), 0) * (per ?? 0);
      }
      const train = t.work / Math.max(1e-9, recruitRate(g, t.id));
      console.log(
        `  ${pad(level, 2)}  ${TROOP_BY_ID[t.id].one.padEnd(15)}  ${pad(train.toFixed(1), 9)}  ${pad(forge > 0 ? (forgeWork / forge).toFixed(1) : '—', 8)}  ${pad(goods, 5)}  ${pad(food.toFixed(2), 8)}  ${pad(wageOf(g, t.id).toFixed(2), 14)}  ${pad((goods / food).toFixed(0), 22)}`,
      );
    }
  }
  console.log(`Игровой день — DAY_LENGTH (${DAY_LENGTH} с).`);
  console.log('');
  {
    const g = townAt(1);
    const food = soldierFoodPerDay(g);
    const goodsOf = (id: TroopId): number => {
      const t = TROOP_BY_ID[id];
      let sum = Object.values(t.cost).reduce((n, v) => n + (v ?? 0), 0);
      for (const [e, per] of Object.entries(t.gear)) {
        sum += Object.values(EQUIPMENT_BY_ID[e as keyof typeof EQUIPMENT_BY_ID].cost).reduce((n, v) => n + (v ?? 0), 0) * (per ?? 0);
      }
      return sum;
    };
    const cheap = TROOPS.reduce((a, b) => (goodsOf(a.id) <= goodsOf(b.id) ? a : b));
    console.log(`Цена лежания против цены найма: еда раненого за срок (soldierFoodPerDay) — доля добра найма самого дешёвого вида (${cheap.one}, ${goodsOf(cheap.id)}),`);
    console.log(`и срок в минутах мира против медианы между ударами (${gap.toFixed(0)} мин).`);
    console.log(' срок, дн  еды  доля добра дешёвого найма  минут мира  короче промежутка между ударами');
    for (const days of [1, 2, 3, 5, 10]) {
      const eat = days * food;
      const minutes = (days * DAY_LENGTH) / 60;
      console.log(`  ${pad(days, 7)}  ${pad(eat.toFixed(1), 3)}  ${pad(pct(eat / goodsOf(cheap.id)), 25)}  ${pad(minutes.toFixed(0), 10)}  ${pad(minutes < gap ? 'да' : 'нет', 31)}`);
    }
    console.log('Добро найма — без человека и без учений: они в долю не входят, и лечение против найма на деле дешевле таблицы.');
  }
  console.log('');

  // 5. Уход войска: раненые, которые едят, но в войске не числятся.
  console.log('Уход войска голодом, если раненые едят из котла, а в войске не числятся (своя арифметика:');
  console.log('foodShortfall с прибавкой их еды к нехватке; раненых в игре ещё нет). Посёлок с пустым амбаром,');
  console.log('производство еды срезано так, что войску не хватает четверти пайка:');
  console.log(' ур  войско  раненых  доля ухода без них  едят, в войске не числятся  едят и числятся при голоде');
  for (const level of LEVELS) {
    const g = townAt(level);
    g.resources.food = 0;
    const armyFood = armySize(g) * soldierFoodPerDay(g);
    const base = foodShortfall(g);
    // Нехватка без раненых: четверть пайка войска поверх того, что есть (производство не трогаем —
    // сдвигаем расход через долю, которую foodShortfall сам сравнивает с едой войска).
    const short = base.army * armyFood + 0.25 * armyFood;
    for (const wounded of [0, Math.round(armySize(g) * 0.1), Math.round(armySize(g) * 0.3)]) {
      const extra = wounded * soldierFoodPerDay(g);
      const apart = Math.min(1, (short + extra) / armyFood);
      const counted = Math.min(1, (short + extra) / (armyFood + extra));
      console.log(`  ${pad(level, 2)}  ${pad(armySize(g), 6)}  ${pad(wounded, 7)}  ${pad(pct(Math.min(1, short / armyFood)), 18)}  ${pad(pct(apart), 26)}  ${pad(pct(counted), 28)}`);
    }
  }
}
