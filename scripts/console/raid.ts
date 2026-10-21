// `npm run raid` — набег логова на посёлок мерки: бой у стены той же дверью, что у мира (`LocalWorld.wallField`, штурм с
// ходу), сухим прогоном по сидам; `--live` — настоящий мир: логово выходит сейчас, идёт, бьётся у стены, грабит или садится
// лагерем, и осада идёт фазами до конца. Справка — `npm run raid -- --help`, рецепты — docs/handbook/console.md.
import { troopPower } from '@/game/battle/price';
import { troopsOfKinds } from '@/game/battle/faces';
import { defense } from '@/game/derived';
import { lairPower, lairRaid } from '@/world/lairs';
import { LAIR_ANCHOR_MID, LAIR_RIPE } from '@/world/data/tuning';
import { menOfPower } from '@/world/garrison';
import type { BattleRecord } from '@/world/types';
import {
  fail,
  has,
  heavy,
  helpIf,
  kindsWords,
  num,
  parseArgs,
  parseSide,
  rejectUnknown,
  replayHint,
  saveRecord,
  shareWords,
  spread,
  text,
  troopsWords,
} from './lib';
import { WAIT_DAYS, bench, daysOf, play, raidNow, spanDays } from './world';

const C = 'raid';
const HELP = `
npm run raid -- --level L [--power P] [ключи]
Набег логова на посёлок мерки уровня L (тот же посёлок, что у отчётов: autopilot.townAt) в мире --world.

  --level L          уровень посёлка 1…10 (5)
  --army "вид:N,…"   своё войско посёлка вместо мерки (виды племени, головы)
  --power P          мощь набега (дубинщик весит 2); нет — дозревшее логово медианной опоры при жителях посёлка
                     (lairs.lairRaid), как у «набега логова» в отчёте конюшни
  --men N            то же числом бойцов строя (мощь = 2N)
  --world S          сид мира (7) — от него логова, дорога и место боя
  --no-shield        без защиты слабого: логово замечает город любой величины (по умолчанию защита есть, как в игре)
  --seed S --runs N  сухой прогон: бои у стены на сидах S…S+N−1 (1 и 40)
  --live             настоящий мир: логово выходит сейчас и идёт до конца — бой у стены, грабёж или лагерь, осада фазами
  --days D           сколько игровых дней ждать конца в --live (${WAIT_DAYS})
  --watch            открыть ролик (боя у стены; в --live — осады, если она была)

Примеры:
  npm run raid -- --level 5 --runs 100
  npm run raid -- --level 7 --power 1600 --army spearman:60,archer:40,legionary:30
  npm run raid -- --level 4 --power 900 --live --watch`;

const args = parseArgs();
helpIf(args, HELP);
const level = num(C, args, 'level', 5, { int: true, min: 1, max: 10 });
const worldSeed = num(C, args, 'world', 7, { int: true });
const seed = num(C, args, 'seed', 1, { int: true });
const runs = num(C, args, 'runs', 40, { int: true, min: 1, max: 100000 });
const live = has(args, 'live');
const days = num(C, args, 'days', WAIT_DAYS, { min: 1 });
const watch = has(args, 'watch');
const shield = !has(args, 'no-shield');
const armyText = text(args, 'army');
const army = armyText ? parseSide(C, armyText, worldSeed, 'войско посёлка').troops : undefined;
if (armyText && Object.keys(army ?? {}).length === 0) fail(C, '--army — только виды племени (spearman:40,…), не рода ядра');
const powerArg = has(args, 'power') ? num(C, args, 'power', 0, { min: 2 }) : has(args, 'men') ? 2 * num(C, args, 'men', 0, { min: 1 }) : null;
rejectUnknown(C, args);
await heavy(live ? `набег в мире, посёлок ${level}-го уровня` : `набег у стены, ${runs} сидов`);

const b = await bench(level, worldSeed, army, { shield });
const g = b.g;
const lair = lairPower(LAIR_ANCHOR_MID, { bornAt: 0, burnedAt: 0 }, LAIR_RIPE, g.pop);
const shielded = lairRaid(lair, g.pop, troopPower(g.army));
if (powerArg === null && shield && shielded <= 0) {
  fail(C, `посёлок ${level}-го уровня — слабый город: логово его не замечает (lairs.weakCity), набега нет. Задай --power P или --no-shield (тогда набег — всё логово, мощь ${Math.round(lair)})`);
}
const power = powerArg ?? (shield ? shielded : lair);
console.log(`=== Набег логова на посёлок ${level}-го уровня, мир ${worldSeed} ===`);
console.log(`посёлок: жителей ${g.pop}, оборона ${Math.round(defense(g))}; войско ${troopsWords(g.army)} — мощь ${Math.round(troopPower(g.army))}`);
console.log(`набег: мощь ${Math.round(power)} (${menOfPower(power)} бойцов строя)${powerArg === null ? ` — дозревшее логово медианной опоры при этих жителях (lairs.lairRaid${shield ? '' : ', без защиты слабого'})` : ''}`);

if (!live) {
  const at = b.sky.now();
  const fights = Array.from({ length: runs }, (_, i) => b.w.wallField({ id: `console${seed + i}`, seed: (seed + i) * 7919, power }, at));
  const first = fights[0];
  console.log(`у стены: набег ${kindsWords(first.party.kinds)}; оборона — дома ${troopsWords(first.home)}, ополчение ${first.militia}, стрелков башни ${first.archers}`);
  const won = fights.filter((f: { field: { won: boolean } }) => f.field.won).length;
  console.log('');
  console.log(`Набег прорвал стену: ${shareWords(won, runs)}.`);
  console.log(`Потери набега, %: ${spread(fights.map((f: { field: { attackerLoss: number } }) => f.field.attackerLoss * 100))}; обороны, %: ${spread(fights.map((f: { field: { defenderLoss: number } }) => f.field.defenderLoss * 100))}`);
  console.log('Сел бы набег лагерем — решает мир в минуту боя (сухой прогон осады): смотри --live.');
  const rec: BattleRecord | null = b.w.gateRecord(first, troopsOfKinds(first.party.kinds, first.party.gear), 'wall');
  if (rec) {
    const file = saveRecord(C, { kind: 'battle', title: `Набег на посёлок ${level}-го уровня, мощь ${Math.round(power)}`, rec });
    replayHint(file);
    if (watch) await (await import('./open')).openReplay(file);
  }
  process.exit(0);
}

const m = raidNow(b, power);
if ('error' in m) fail(C, m.error);
console.log(`[${daysOf(b)}] вышел набег из «${m.from}», мощь ${Math.round(m.power)}; у стены — через ${spanDays(m.arriveAt - b.sky.now())}`);
const played = await play(b, days, {
  until: (p) => {
    const mine = p.reports.filter((r) => r.id.startsWith(m.id));
    if (p.ended) return true;
    return mine.length > 0 && !b.w.save.sieges.home;
  },
});
if (!played.reports.some((r) => r.id.startsWith(m.id))) console.log(`Набег не дошёл за ${days} игр. дн.`);
const withSiege = played.ended;
const withBattle = played.reports.find((r) => r.id.startsWith(m.id) && r.battle);
if (withSiege) {
  const file = saveRecord(C, { kind: 'siege', title: withSiege.title, rec: withSiege.siege, report: withSiege });
  replayHint(file);
  if (watch) await (await import('./open')).openReplay(file);
} else if (withBattle?.battle) {
  const file = saveRecord(C, { kind: 'battle', title: withBattle.title, rec: withBattle.battle });
  replayHint(file);
  if (watch) await (await import('./open')).openReplay(file);
}
process.exit(0);
