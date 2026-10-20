// `npm run intercept` — перехват набега в поле настоящим миром: логово выходит сейчас, полководец с дружиной идёт навстречу
// приказом мира (`LocalWorld.intercept`, тот же, что кнопка «Перехватить»), бой в поле, а уцелевшие идут дальше к стене.
// Справка — `--help`, рецепты — docs/handbook/console.md.
import { troopPower } from '@/game/battle/price';
import { defense } from '@/game/derived';
import { lairPower, lairRaid } from '@/world/lairs';
import { LAIR_ANCHOR_MID, LAIR_RIPE } from '@/world/data/tuning';
import { HOME_ID } from '@/world/local/LocalWorld';
import type { TroopStack } from '@/game/battle/kinds';
import { fail, has, heavy, helpIf, num, parseArgs, parseSide, rejectUnknown, replayHint, saveRecord, text, troopsWords } from './lib';
import { WAIT_DAYS, bench, daysOf, play, raidNow, spanDays } from './world';

const C = 'intercept';
const HELP = `
npm run intercept -- --level L [--power P] [ключи]
Перехват набега в поле: логово выходит на посёлок мерки уровня L сейчас, полководец ведёт дружину навстречу приказом мира
(тот же, что кнопка «Перехватить»: встреча, энергия, отказ — правилами мира). Бой в поле печатается донесением; уцелевшие
идут к стене, и набег решается там же, как в игре.

  --level L            уровень посёлка 1…10 (8); --army "вид:N,…" — своё войско вместо мерки
  --garrison "вид:N,…" кто остаётся в городе (остальное — дружина полководца); по умолчанию — половина каждого вида
  --power P            мощь набега (по умолчанию — дозревшее логово при жителях посёлка, lairs.lairRaid)
  --world S            сид мира (7); --no-shield — без защиты слабого
  --days D             сколько игровых дней ждать конца (${WAIT_DAYS})
  --watch              открыть ролик боя в поле

Примеры:
  npm run intercept -- --level 8 --power 2000
  npm run intercept -- --level 9 --army legionary:80,rider:60,archer:60 --garrison archer:60 --watch`;

const args = parseArgs();
helpIf(args, HELP);
const level = num(C, args, 'level', 8, { int: true, min: 1, max: 10 });
const worldSeed = num(C, args, 'world', 7, { int: true });
const days = num(C, args, 'days', WAIT_DAYS, { min: 1 });
const shield = !has(args, 'no-shield');
const watch = has(args, 'watch');
const armyText = text(args, 'army');
const army = armyText ? parseSide(C, armyText, worldSeed, 'войско посёлка').troops : undefined;
const garrisonText = text(args, 'garrison');
const powerArg = has(args, 'power') ? num(C, args, 'power', 0, { min: 2 }) : null;
rejectUnknown(C, args);
await heavy(`перехват, посёлок ${level}-го уровня`);

const b = await bench(level, worldSeed, army, { shield });
const g = b.g;
const lair = lairPower(LAIR_ANCHOR_MID, { bornAt: 0, burnedAt: 0 }, LAIR_RIPE, g.pop);
const power = powerArg ?? (shield ? lairRaid(lair, g.pop, troopPower(g.army)) : lair);
if (power < 2) fail(C, `посёлок ${level}-го уровня — слабый город: логово его не замечает (lairs.weakCity). Задай --power P или --no-shield`);
console.log(`=== Перехват набега: посёлок ${level}-го уровня, мир ${worldSeed} ===`);
console.log(`посёлок: жителей ${g.pop}, оборона ${Math.round(defense(g))}; войско ${troopsWords(g.army)} — мощь ${Math.round(troopPower(g.army))}`);
const say = (what: string, err: string | null): void => console.log(`  [${daysOf(b)}] ${what}: ${err ? `мир отказал — ${err}` : 'принято'}`);

const keep: TroopStack = garrisonText
  ? parseSide(C, garrisonText, worldSeed, 'гарнизон').troops
  : (Object.fromEntries(Object.entries(g.army).map(([id, n]) => [id, Math.ceil((n ?? 0) / 2)])) as TroopStack);
say(`гарнизон ${troopsWords(keep)}`, await b.w.setGarrison(keep));
const ready = (await b.w.figures()).find((f: { id: string }) => f.id === 'general');
b.sky.at(Math.max(b.sky.now(), ready?.readyAt ?? b.sky.now()));
await b.sky.pulse();

const m = raidNow(b, power);
if ('error' in m) fail(C, m.error);
console.log(`[${daysOf(b)}] вышел набег из «${m.from}», мощь ${Math.round(m.power)}; у стены — через ${spanDays(m.arriveAt - b.sky.now())}`);
await b.sky.pulse();
const plan = await b.w.interceptPlan(m.id);
if (plan.can) console.log(`  встреча через ${(plan.seconds / 60).toFixed(0)} мин настоящего времени (${spanDays(plan.seconds * 1000)})`);
const err = await b.w.intercept(m.id);
say('полководец идёт на перехват', err);
if (err) process.exit(1);
const played = await play(b, days, { until: (p) => p.reports.some((r) => r.id.startsWith(m.id)) && !b.w.save.sieges[HOME_ID] && !b.w.save.marches.some((x: { id: string }) => x.id === m.id) });
const field = played.reports.find((r) => r.battle && !r.id.startsWith(`${m.id}-defense`));
if (field?.battle) {
  const file = saveRecord(C, { kind: 'battle', title: field.title, rec: field.battle });
  replayHint(file);
  if (watch) await (await import('./open')).openReplay(file);
} else console.log('Боя в поле не было (донесения выше).');
process.exit(0);
