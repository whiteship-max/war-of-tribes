// Осада числами: как часто она случается, стоит ли выходить на вылазку и что
// даёт лагерю его готовность.
//
// Отчёт нужен ровно потому, что у осады два числа, которые нельзя выбрать на
// глаз, и оба меняют игру целиком:
//
//  1. **Частота.** Осада случается там, где штурм безнадёжен, — то есть тем
//     чаще, чем крепче деревня. Без ограничителя из этого следует, что
//     развитый игрок видит лагерь вместо набега почти всегда, и вложение в
//     стену наказывается исчезновением набега как события. Раздел «частота»
//     печатает распределение «набег / осада» для слабой, средней и крепкой
//     деревни — и до правки, и после: старое правило («садятся всегда, когда
//     можно») считается на тех же самых пришедших отрядах, поэтому сравнение
//     честное, а не по двум разным прогонам.
//
//  2. **Прибавка лагерю.** Вылазка бьёт в готовое, и без прибавки она была бы
//     бесплатной кнопкой: лагерь и так слабее обороны — иначе он бы штурмовал.
//     Раздел «вылазка» гоняет настоящее ядро боя на настоящих составах и
//     печатает долю побед по отношению сил, а заодно проверяет, не выгоднее ли
//     ходить малыми вылазками вместо одной большой (от ответа зависит, нужен
//     ли откат).
//
//   npx vite-node scripts/siege-report.ts
import { LocalWorld } from '@/world/local/LocalWorld';
import { resolveField } from '@/world/battle';
import { menOfPower, raidingParty } from '@/world/garrison';
import { campMen } from '@/world/siege';
import { gearOf, kindsOf, troopLosses, type TroopStack } from '@/game/battle/kinds';
import { stackTotal } from '@/battle';
import {
  AI_ATTACK_MAX,
  AI_ATTACK_MIN,
  SIEGE_CHANCE,
  SIEGE_COOLDOWN,
  SIEGE_IF_BELOW,
  SIEGE_RELIEF_AT,
  SIEGE_SORTIE_RATIO,
  SORTIE_CAMP_BONUS,
} from '@/world/data/tuning';
import type { PlayerProfile, Report } from '@/world/types';

const MIN = 60_000;
const SEEDS = [11, 42, 77, 101, 202, 303];
/** Сколько игрового времени крутим на каждой деревне. */
const HOURS = 8;

// ---------------------------------------------------------------- частота ---

/** Три деревни: слабая, средняя и крепкая. Разница только в обороне. */
const TOWNS = [
  { name: 'слабая', defense: 60, army: { clubman: 12 } as TroopStack },
  { name: 'средняя', defense: 220, army: { spearman: 20, archer: 10 } as TroopStack },
  { name: 'крепкая', defense: 900, army: { legionary: 40, spearman: 30, archer: 20 } as TroopStack },
];

const profile = (defense: number, army: TroopStack): PlayerProfile => ({
  name: 'Отчёт',
  pop: 400,
  defense,
  warriorPower: 12,
  units: { warrior: 40, scout: 6 },
  army: { ...army },
  command: 120,
  warning: 120,
  resources: { food: 900, wood: 600 },
  // Часы голода: полтора часа на пустой гарнизон, меньше — с полным.
  food: 9000,
  foodPerHour: 6000,
  soldierFoodPerHour: 40,
});

interface Counts {
  /** Отрядов дошло до ворот. */
  came: number;
  /** Из них сели лагерем. */
  sieges: number;
  /** Из них **могли бы** сесть по одному порогу, без доли и остывания. */
  couldOld: number;
}

async function frequency(seed: number, defense: number, army: TroopStack): Promise<Counts> {
  let now = 1_700_000_000_000;
  const world = new LocalWorld({ seed, now: () => now, storage: null });
  const p = profile(defense, army);
  const out: Counts = { came: 0, sieges: 0, couldOld: 0 };
  const seen = new Set<string>();
  const end = now + HOURS * 60 * MIN;
  await world.sync(p);
  while (now < end) {
    now += 10_000;
    const pulse = await world.sync(p);
    for (const r of pulse.reports as Report[]) {
      if (r.kind !== 'defense' || seen.has(r.id)) continue;
      seen.add(r.id);
      // «Набег не состоялся» — это отряд, пришедший без игрока; в счёт он не
      // идёт ни в старом правиле, ни в новом.
      if (r.title === 'Набег не состоялся') continue;
      const siege = r.title === 'Город в осаде';
      const battle = r.title === 'Нападение отбито' || r.title === 'Деревню разграбили';
      if (!siege && !battle) continue;
      out.came++;
      if (siege) out.sieges++;
      // Старое правило целиком: садились всегда, когда штурм был безнадёжен.
      if ((r.enemyPower ?? 0) < Math.max(1, defense) * SIEGE_IF_BELOW) out.couldOld++;
    }
  }
  return out;
}

// ---------------------------------------------------------------- вылазка ---

/**
 * Один бой вылазки — теми же составами, что строит мир: гарнизон игрока против
 * отряда лагеря, раздутого прибавкой за готовность (`campMen`). Своей арифметики
 * у отчёта нет: он зовёт те же функции, что и `LocalWorld.campArmy`.
 */
function sortieOnce(
  seed: number,
  going: TroopStack,
  campPower: number,
  bonus: number,
): { won: boolean; ourLoss: number; campLoss: number } {
  const party = raidingParty(seed, `camp${seed}`, campPower);
  const kinds = { ...party.kinds };
  if (bonus > 0) kinds.infantry += campMen(stackTotal(kinds), bonus) - stackTotal(kinds);
  const field = resolveField({
    seed,
    // Снаряжение вылазки — своё, из видов бойцов: ровно то же, что кладёт мир
    // (`ownGear`). Забудь его — и отряд выйдет голым против кованого лагеря.
    attacker: { kinds: kindsOf(going), gear: gearOf(going), setup: null },
    defender: { kinds, gear: party.gear, setup: bonus > 0 ? null : party.setup },
  });
  const lost = field.result ? troopLosses(going, field.result.sides.attacker.losses) : {};
  // Обе убыли — в бойцах строя, а не в головах найма: латник весит восьмерых, и
  // считать размен по головам значило бы врать в восемь раз.
  return {
    won: field.won,
    ourLoss: stackTotal(kindsOf(lost)),
    campLoss: Math.round(stackTotal(kinds) * field.defenderLoss),
  };
}

/**
 * Пропорция вылазки: копья, латники, лучники. Числа — доли, а не головы: в
 * бойцов строя их переводит `kindsOf`, и только после этого отряд сравним с
 * лагерем (мир меряет войско бойцами строя, см. `BATTLE_MAN`).
 */
const MIX: TroopStack = { spearman: 4, legionary: 3, archer: 3 };
const MIX_MEN = stackTotal(kindsOf(MIX));

/** Отряд на вылазку в заданное число бойцов строя. */
const party = (men: number): TroopStack => {
  const k = Math.max(1, Math.round(men / MIX_MEN));
  const out: TroopStack = {};
  for (const [id, n] of Object.entries(MIX) as [keyof TroopStack, number][]) out[id] = n * k;
  return out;
};

/** Мощь лагеря. `menOfPower` переводит её в бойцов строя — с ними и сравниваем. */
const CAMP_POWER = 240;
const CAMP_MEN = menOfPower(CAMP_POWER);

const BONUSES = [0, 0.15, 0.25, 0.4, 0.6];
/** Отношение «наш отряд к лагерю» по бойцам строя. */
const RATIOS = [0.8, 1, 1.25, 1.6];
const TRIES = 40;

// ------------------------------------------------------------------ печать ---

const pct = (a: number, b: number): string => (b > 0 ? `${Math.round((a / b) * 100)}%` : '—');

console.log('=== Осада числами ===');
console.log(
  `порог осады (SIEGE_IF_BELOW): ${SIEGE_IF_BELOW} · доля попыток (SIEGE_CHANCE): ${SIEGE_CHANCE} · ` +
    `остывание (SIEGE_COOLDOWN): ${SIEGE_COOLDOWN / MIN} мин`,
);
console.log(`пауза между набегами ИИ: ${AI_ATTACK_MIN / MIN}…${AI_ATTACK_MAX / MIN} мин`);

console.log('');
console.log(`--- частота: набег или осада (${HOURS} ч на деревню, ${SEEDS.length} сидов) ---`);
console.log('деревня   пришло   осад (было → стало)   доля осад: было → стало');
let totalCame = 0;
let totalOld = 0;
let totalNew = 0;
for (const town of TOWNS) {
  let came = 0;
  let sieges = 0;
  let old = 0;
  for (const seed of SEEDS) {
    const c = await frequency(seed, town.defense, town.army);
    came += c.came;
    sieges += c.sieges;
    old += c.couldOld;
  }
  totalCame += came;
  totalOld += old;
  totalNew += sieges;
  console.log(
    `${town.name.padEnd(9)} ${String(came).padStart(6)}   ${String(old).padStart(5)} → ${String(
      sieges,
    ).padStart(3)}          ${pct(old, came).padStart(5)} → ${pct(sieges, came)}`,
  );
}
console.log(`всего:    ${totalCame} прихода, осад было бы ${totalOld} (${pct(totalOld, totalCame)}), стало ${totalNew} (${pct(totalNew, totalCame)})`);

console.log('');
console.log(`--- вылазка: прибавка лагерю (сейчас SORTIE_CAMP_BONUS = ${SORTIE_CAMP_BONUS}) ---`);
console.log('прибавка  ' + RATIOS.map((r) => `×${r}`.padStart(7)).join('') + '   средний размен');
for (const bonus of BONUSES) {
  const cells: string[] = [];
  let ours = 0;
  let theirs = 0;
  for (const ratio of RATIOS) {
    let won = 0;
    for (let i = 0; i < TRIES; i++) {
      const r = sortieOnce(1000 + i * 7, party(Math.round(CAMP_MEN * ratio)), CAMP_POWER, bonus);
      if (r.won) won++;
      ours += r.ourLoss;
      theirs += r.campLoss;
    }
    cells.push(pct(won, TRIES).padStart(7));
  }
  const mark = Math.abs(bonus - SORTIE_CAMP_BONUS) < 1e-9 ? ' ←' : '';
  console.log(`${String(bonus).padEnd(9)} ${cells.join('')}   ${(theirs / Math.max(1, ours)).toFixed(2)}${mark}`);
}
console.log('строки — прибавка лагерю, столбцы — во сколько раз вылазка крупнее лагеря;');
console.log('в клетке — доля побед вылазки, справа — сколько чужих за одного своего.');

console.log('');
console.log('--- нужен ли откат: одна большая вылазка против нескольких малых ---');
console.log('способ                        побед   своих   чужих   размен');
{
  const CAMP = CAMP_POWER;
  for (const parts of [1, 2, 4]) {
    let won = 0;
    let ours = 0;
    let theirs = 0;
    for (let i = 0; i < TRIES; i++) {
      // Один и тот же гарнизон, разбитый на `parts` заходов. Лагерь между
      // заходами слабеет ровно так же, как в игре (`wearCamp`).
      let camp = CAMP;
      // Весь наличный гарнизон — столько же бойцов строя, сколько в лагере.
      const men = CAMP_MEN;
      let lifted = false;
      for (let k = 0; k < parts && !lifted; k++) {
        const r = sortieOnce(2000 + i * 13 + k, party(Math.round(men / parts)), camp, SORTIE_CAMP_BONUS);
        ours += r.ourLoss;
        theirs += r.campLoss;
        // Лагерь между заходами слабеет ровно так же, как в игре (`wearCamp`).
        camp = Math.max(1, camp * (1 - r.campLoss / Math.max(1, menOfPower(camp))));
        if (r.won) lifted = true;
      }
      if (lifted) won++;
    }
    console.log(
      `${(parts === 1 ? 'одна вылазка целиком' : `${parts} вылазки по ${Math.round(100 / parts)}%`).padEnd(29)} ${pct(
        won,
        TRIES,
      ).padStart(5)}   ${String(ours).padStart(5)}   ${String(theirs).padStart(5)}   ${(
        theirs / Math.max(1, ours)
      ).toFixed(2)}`,
    );
  }
  console.log('если дробление выигрывает по всем трём столбцам — нужен откат; если нет — не нужен.');
}

// ------------------------------------------------------- осада игроком ---

/**
 * Что бывает, когда в осаду садится игрок. Здесь гоняется настоящий мир целиком:
 * полководец идёт к соседу, обкладывает его и ждёт. Проверяются разом три вещи,
 * которые иначе пришлось бы брать на веру, — что осада вообще ставится, что
 * осаждённый бот выходит на вылазку по порогу сил, и что соседи приходят на
 * выручку.
 */
const RAID_ARMY: TroopStack = { legionary: 30, spearman: 24, archer: 16, rider: 8 };

async function playerSiege(seed: number): Promise<string> {
  let now = 1_700_000_000_000;
  const world = new LocalWorld({ seed, now: () => now, storage: null });
  const p = profile(900, RAID_ARMY);
  await world.sync(p);
  const err0 = await world.setGarrison({ ...RAID_ARMY });
  if (err0) return `дружину не собрать: ${err0}`;
  const g0 = (await world.figures()).find((f) => f.id === 'general');
  now = Math.max(now, g0?.readyAt ?? now);
  await world.sync(p);

  const info = await world.info();
  const near = (await world.region({ x: info.home.x - 20, y: info.home.y - 20, w: 40, h: 40 })).settlements
    .filter((s) => !s.mine)
    .sort(
      (a, b) =>
        Math.hypot(a.x - info.home.x, a.y - info.home.y) - Math.hypot(b.x - info.home.x, b.y - info.home.y),
    )[0];
  if (!near) return 'соседей рядом нет';
  const moveErr = await world.moveFigure('general', { x: near.x, y: near.y });
  if (moveErr) return `не дойти: ${moveErr}`;
  const g1 = (await world.figures()).find((f) => f.id === 'general');
  now = Math.max(now, g1?.arriveAt ?? now);
  await world.sync(p);

  const err = await world.besiege();
  if (err) return `осада не встала: ${err}`;

  const seen = new Set<string>();
  const log: string[] = [];
  const start = now;
  const stamp = (): string => `+${((now - start) / MIN).toFixed(0)}м`;
  for (let i = 0; i < 900; i++) {
    now += 20_000;
    const pulse = await world.sync(p);
    for (const r of pulse.reports) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      if (r.title.startsWith('Выручка отбита')) log.push(`выручка отбита ${stamp()}`);
      if (r.title.startsWith('Город взят голодом')) {
        log.push(`город доели голодом ${stamp()}`);
        return log.join(', ');
      }
      if (r.title.startsWith('Лагерь разбит')) {
        log.push(`лагерь сбила выручка ${stamp()}`);
        return log.join(', ');
      }
    }
    const fig = (await world.figures()).find((f) => f.id === 'general');
    if (!fig?.besieging) {
      log.push(`осада кончилась ${stamp()}`);
      return log.join(', ');
    }
  }
  return [...log, 'осада всё ещё идёт'].join(', ');
}

console.log('');
console.log('--- осада игроком: чем кончается (настоящий мир, полководец у ворот) ---');
console.log(`порог вылазки бота: гарнизон ≥ лагерь × ${SIEGE_SORTIE_RATIO}; выручка выходит через ${SIEGE_RELIEF_AT / MIN} мин`);
for (const seed of SEEDS) {
  console.log(`сид ${String(seed).padStart(4)}: ${await playerSiege(seed)}`);
}
