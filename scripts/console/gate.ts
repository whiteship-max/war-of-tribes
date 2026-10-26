// `npm run gate` — бой события у ворот (волки, разбойники) на посёлке мерки той же дверью, что у мира (`LocalWorld.gateParty`
// → `gateField`, бой перед воротами, без стены), по сидам. Сила по умолчанию — таблица игры для этого посёлка
// (`data/events.gatePower`). Справка — `npm run gate -- --help`, рецепты — docs/handbook/console.md.
import { BATTLE_MAN } from '@/game/battle/kinds';
import { troopsOfKinds } from '@/game/battle/faces';
import { troopPower } from '@/game/battle/price';
import { defense } from '@/game/derived';
import { spiritOf } from '@/game/sim/spirit';
import { gatePower } from '@/game/data/events';
import type { GateFoe } from '@/world/types';
import type { BattleRecord } from '@/world/types';
import { menOfPower } from '@/world/garrison';
import { fail, has, heavy, helpIf, kindsWords, LIGHT_BATTLES, num, parseArgs, parseSide, rejectUnknown, replayHint, saveRecord, shareWords, spread, text, troopsWords } from './lib';
import { bench, gatePoint } from './world';

const C = 'gate';
const HELP = `
npm run gate -- --level L (--wolves [N] | --raiders [P]) [ключи]
Бой события у ворот — волки или разбойники — на посёлке мерки уровня L дверью мира (LocalWorld.gateField): гарнизон,
отряд полководца в городе, ополчение и стрелки башни против пришедших, в поле перед воротами.

  --level L          уровень посёлка 1…10 (5); --army "вид:N,…" — своё войско вместо мерки
  --wolves [N]       стая из N волков; без числа — сила таблицы игры для этого посёлка (data/events.gatePower)
  --raiders [P]      разбойники мощью P; без числа — таблица игры
  --world S          сид мира (7) — место боя
  --seed S --runs N  бои на сидах S, S+1, … (по умолчанию как у раздела 4 «raid-mix»: сид i·7919, 40 боёв)
  --watch            ролик первого боя

Примеры:
  npm run gate -- --level 3 --wolves
  npm run gate -- --level 5 --wolves 420 --runs 200
  npm run gate -- --level 7 --raiders 1500 --army spearman:60,archer:40`;

{
  const args = parseArgs();
  helpIf(args, HELP);
  const level = num(C, args, 'level', 5, { int: true, min: 1, max: 10 });
  const worldSeed = num(C, args, 'world', 7, { int: true });
  const seed = num(C, args, 'seed', 1, { int: true });
  const runs = num(C, args, 'runs', 40, { int: true, min: 1, max: 100000 });
  const watch = has(args, 'watch');
  const wolves = has(args, 'wolves');
  const raiders = has(args, 'raiders');
  if (wolves === raiders) fail(C, 'одно из двух: --wolves [N] или --raiders [P]');
  const foe: GateFoe = wolves ? 'wolves' : 'raiders';
  const given = text(args, foe);
  const armyText = text(args, 'army');
  const army = armyText ? parseSide(C, armyText, worldSeed, 'войско посёлка').troops : undefined;
  rejectUnknown(C, args);
  if (runs > LIGHT_BATTLES) await heavy(`бой у ворот, ${runs} сидов`);
  const b = await bench(level, worldSeed, army, { raids: false });
  const table = gatePower(b.g, foe);
  const power = given === undefined ? table : foe === 'wolves' ? Number(given) * BATTLE_MAN : Number(given);
  if (!Number.isFinite(power) || power <= 0) fail(C, `--${foe}: число больше нуля`);
  const p = gatePoint(b, foe, power, seed, runs);
  const name = foe === 'wolves' ? 'волки' : 'разбойники';
  const gate = p.first.gate as { home: Record<string, number>; militia: number; archers: number; field: { result: unknown } };
  console.log(`=== У ворот: ${name}, посёлок ${level}-го уровня, мир ${worldSeed} ===`);
  console.log(`посёлок: жителей ${b.g.pop}, оборона ${Math.round(defense(b.g))}; войско ${troopsWords(b.g.army)} — мощь ${Math.round(troopPower(b.g.army))}`);
  console.log(`оборона у ворот: дома ${troopsWords(gate.home)}, ополчение ${gate.militia}, стрелков башни ${gate.archers}`);
  // Дух дружины посёлка мерки (ДР-1): он идёт в бой у ворот (`ArmySetup.spirit`), у волков и разбойников духа нет.
  const sp = spiritOf(b.g);
  console.log(`дух дружины: мораль ${sp.morale}, дисциплина ${sp.discipline} (sim/spirit; нейтраль боя — 70)`);
  console.log(`пришли: ${name} мощью ${Math.round(power)} — ${menOfPower(power)} бойцов строя (${kindsWords((p.first.party as { kinds: never }).kinds)}); таблица игры для этого посёлка — ${Math.round(table)} (${menOfPower(table)})`);
  console.log('');
  console.log(`Пришедшие взяли верх: ${shareWords(p.won, runs)}.`);
  console.log(`Потери пришедших, %: ${spread(p.attackerLoss)}; обороны, %: ${spread(p.defenderLoss)}`);
  const party = p.first.party as { kinds: never; gear: never };
  const rec: BattleRecord | null = b.w.gateRecord(p.first.gate, foe === 'wolves' ? {} : troopsOfKinds(party.kinds, party.gear), 'gate');
  if (rec) {
    if (foe === 'wolves') rec.beasts = 'attacker';
    const file = saveRecord(C, { kind: 'battle', title: `${name} у ворот посёлка ${level}-го уровня`, rec });
    replayHint(file);
    if (watch) await (await import('./open')).openReplay(file);
  }
  process.exit(0);
}
