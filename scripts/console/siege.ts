// `npm run siege` и `npm run camp` — осада своего города настоящим миром: логово выходит сейчас, садится лагерем, и осада
// идёт фазами (кость, поправки, проломы, машины лагеря, обстрел, кольцо Р-5, хлеб до голода) до конца; приказы защитника —
// те же двери, что кнопки окна осады (`LocalWorld.defend`, `sortie`, `strikeCamp`). `camp` — то же с ударом по лагерю:
// вылазкой из города или полководцем из поля. Справка — `--help`, рецепты — docs/handbook/console.md.
import { troopPower } from '@/game/battle/price';
import { defense } from '@/game/derived';
import { lairPower, lairRaid } from '@/world/lairs';
import { LAIR_ANCHOR_MID, LAIR_RIPE } from '@/world/data/tuning';
import { HOME_ID } from '@/world/local/LocalWorld';
import { rowsOf } from '@/world/siegeroll';
import type { TroopStack } from '@/game/battle/kinds';
import type { GunAim } from '@/world/data/shelling';
import { fail, has, heavy, helpIf, num, parseArgs, parseSide, rejectUnknown, replayHint, saveRecord, text, troopsWords } from './lib';
import { WAIT_DAYS, bench, daysOf, play, raidNow, reportWords, spanDays, type Bench } from './world';
import { deriveCut } from './siegefood';
import { setPhaseDie } from '@/world/siegeroll';

const CAMP = process.argv.includes('--camp');
const C = CAMP ? 'camp' : 'siege';
const HELP = `
npm run ${C} -- --level L [--power P] [ключи]
Осада своего города настоящим миром: логово выходит сейчас, бьётся у стены, садится лагерем (если мир так решит) и
осада идёт фазами до конца — голодом, сдачей, штурмом, снятием или ударом по лагерю. Посёлок стоит (уровни, склад,
войско — как поставили), мир идёт. Каждая фаза печатается строкой мира: кость, поправки, исход, хлеб, машины, кольцо.

  --level L          уровень посёлка 1…10 (8); --army "вид:N,…" — своё войско вместо мерки
  --power P          мощь набега (по умолчанию — дозревшее логово при жителях посёлка, ×2: чтобы оно садилось лагерем)
  --world S          сид мира (7); --no-shield — без защиты слабого
  --repair --ration  наказы защитника с первой фазы: чинить проломы, урезать паёк при половине хлеба
  --gun [--gun-aim camp|machines]  требушет на стене и его цель (Р-5)
  --days D           сколько игровых дней ждать конца (${WAIT_DAYS})
  --watch            открыть ролик осады (ГФ-2) после конца
Хлеб осады (ОС-1, docs/siege_v2.md, 23):
  --ratio R          мощь набега — R мощностей гарнизона (мерка кольца и штрафа к добыче) вместо --power
  --sit              лагерь садится, даже если мир решил бы штурмовать или уйти (замер правила хлеба, не частоты осад)
  --calm             кость фаз — «без перемен»: осаду кончают только голод и уход лагеря
  --derive           вывод штрафа к добыче по посёлкам мерки 1–10 (CUT_MIN, CUT_MID) — без мира, одной таблицей
Удар по лагерю (npm run camp):
  --sortie "вид:N,…" вылазка из города этим отрядом
  --strike           удар полководца из поля его дружиной; --joint — вместе с гарнизоном из ворот
  --garrison "вид:N,…" кто остаётся в городе гарнизоном при --strike (остальное войско — дружина полководца,
                     она до набега выходит в поле рядом с городом); по умолчанию — половина каждого вида
  --at-phase K       в какую фазу осады бить (1 — сразу, как лагерь сел; по умолчанию 2)

Примеры:
  npm run siege -- --level 8 --power 3000
  npm run siege -- --level 6 --power 2500 --repair --ration --gun --watch
  npm run camp -- --level 8 --power 3000 --sortie legionary:30,spearman:40 --at-phase 3
  npm run camp -- --level 8 --power 3000 --strike --joint
  npm run siege -- --derive
  npm run siege -- --level 5 --ratio 1 --sit --calm`;

const args = parseArgs();
helpIf(args, HELP);
has(args, 'camp');
const level = num(C, args, 'level', 8, { int: true, min: 1, max: 10 });
const worldSeed = num(C, args, 'world', 7, { int: true });
const days = num(C, args, 'days', WAIT_DAYS, { min: 1 });
const shield = !has(args, 'no-shield');
const watch = has(args, 'watch');
const armyText = text(args, 'army');
const army = armyText ? parseSide(C, armyText, worldSeed, 'войско посёлка').troops : undefined;
const powerArg = has(args, 'power') ? num(C, args, 'power', 0, { min: 2 }) : null;
const repair = has(args, 'repair');
const ration = has(args, 'ration');
const gun = has(args, 'gun');
const gunAim = text(args, 'gun-aim') as GunAim | undefined;
if (gunAim && gunAim !== 'camp' && gunAim !== 'machines') fail(C, '--gun-aim: camp или machines');
const sortieText = text(args, 'sortie');
const strike = has(args, 'strike');
const joint = has(args, 'joint');
const garrisonText = text(args, 'garrison');
const atPhase = num(C, args, 'at-phase', 2, { int: true, min: 1 });
const ratioArg = has(args, 'ratio') ? num(C, args, 'ratio', 1, { min: 0.01 }) : null;
const sit = has(args, 'sit');
const calm = has(args, 'calm');
const derive = has(args, 'derive');
rejectUnknown(C, args);
if (ratioArg !== null && powerArg !== null) fail(C, 'одно из двух: --power (мощь) или --ratio (доля гарнизона)');
if (derive) {
  await heavy('вывод штрафа к добыче осады');
  deriveCut();
  process.exit(0);
}
if (calm) setPhaseDie(() => 7);
if (CAMP && !sortieText && !strike) fail(C, 'удар по лагерю: --sortie "вид:N,…" или --strike');
if (sortieText && strike) fail(C, 'одно из двух: --sortie (из города) или --strike (полководец из поля)');
await heavy(`осада посёлка ${level}-го уровня`);

const b: Bench = await bench(level, worldSeed, army, { shield });
const g = b.g;
const lair = lairPower(LAIR_ANCHOR_MID, { bornAt: 0, burnedAt: 0 }, LAIR_RIPE, g.pop);
const power = ratioArg !== null ? ratioArg * troopPower(g.army) : (powerArg ?? 2 * (shield ? lairRaid(lair, g.pop, troopPower(g.army)) : lair));
if (power < 2) fail(C, `посёлок ${level}-го уровня — слабый город: логово его не замечает (lairs.weakCity). Задай --power P или --no-shield`);
console.log(`=== ${CAMP ? 'Удар по лагерю' : 'Осада'}: посёлок ${level}-го уровня, мир ${worldSeed} ===`);
console.log(`посёлок: жителей ${g.pop}, оборона ${Math.round(defense(g))}; войско ${troopsWords(g.army)} — мощь ${Math.round(troopPower(g.army))}`);

const say = (what: string, err: string | null): void => console.log(`  [${daysOf(b)}] ${what}: ${err ? `мир отказал — ${err}` : 'принято'}`);

if (strike) {
  // Дружина полководца — всё, что не оставлено гарнизоном; до набега она выходит в поле рядом с городом (как у осады в
  // отчётах: `siege-report.freezeField`), чтобы бить по лагерю из поля.
  const keep: TroopStack = garrisonText
    ? parseSide(C, garrisonText, worldSeed, 'гарнизон').troops
    : (Object.fromEntries(Object.entries(g.army).map(([id, n]) => [id, Math.ceil((n ?? 0) / 2)])) as TroopStack);
  say(`гарнизон ${troopsWords(keep)}`, await b.w.setGarrison(keep));
  const ready = (await b.w.figures()).find((f: { id: string }) => f.id === 'general');
  b.sky.at(Math.max(b.sky.now(), ready?.readyAt ?? b.sky.now()));
  await b.sky.pulse();
  const info = await b.w.info();
  say('полководец выходит в поле рядом с городом', await b.w.moveFigure('general', { x: info.home.x + 3, y: info.home.y + 2 }));
  const out = (await b.w.figures()).find((f: { id: string }) => f.id === 'general');
  b.sky.at(Math.max(b.sky.now(), out?.arriveAt ?? b.sky.now()));
  await b.sky.pulse();
}

// Замер правила хлеба: лагерь садится при любом исходе сухого прогона, кроме прорыва (мир решил бы штурм или уход).
if (sit) {
  const w = b.w;
  w.sitsDown = (id: string, _m: unknown, _at: number, field: { won: boolean }): boolean => !field.won && !w.save.sieges[id];
}
const m = raidNow(b, power);
if ('error' in m) fail(C, m.error);
console.log(`[${daysOf(b)}] вышел набег из «${m.from}», мощь ${Math.round(m.power)}; у стены — через ${spanDays(m.arriveAt - b.sky.now())}`);

let ordered = false;
let struck = false;
let struckAt = Infinity;
const played = await play(b, days, {
  each: async () => {
    const w = b.w.save.sieges[HOME_ID];
    if (!w) return;
    if (!ordered) {
      ordered = true;
      if (repair || ration) say(`наказы: ${[repair ? 'чинить проломы' : '', ration ? 'урезать паёк' : ''].filter(Boolean).join(', ')}`, await b.w.defend({ act: 'orders', defend: { ...(repair ? { repair: true } : {}), ...(ration ? { ration: true } : {}) } }));
      if (gun) say('требушет на стену', await b.w.defend({ act: 'gun' }));
      if (gunAim) say(`цель требушета — ${gunAim === 'camp' ? 'лагерь' : 'машины'}`, await b.w.defend({ act: 'gunAim', aim: gunAim }));
    }
    if (!struck && (sortieText || strike) && rowsOf(w).length >= atPhase - 1) {
      struck = true;
      struckAt = b.sky.now();
      if (sortieText) {
        const troops = parseSide(C, sortieText, worldSeed, 'вылазка').troops;
        const r = await b.w.sortie(troops);
        say(`вылазка ${troopsWords(troops)}`, r.error);
      } else say(`удар полководца по лагерю${joint ? ' вместе с гарнизоном' : ''}`, await b.w.strikeCamp(HOME_ID, joint));
    }
  },
  until: (p) => {
    if (p.ended) return true;
    const raid = p.reports.some((r) => r.id.startsWith(m.id));
    return raid && !b.w.save.sieges[HOME_ID] && !p.siege;
  },
});

if (!played.siege) {
  console.log('Лагерь не сел: набег решился боем у стены (донесение выше). Лагерем садятся, только когда штурм не удался бы, кость');
  console.log('посадки выпала и лагерь удержит вылазку (LocalWorld.sitsDown): прорвали — --power поменьше; отбиты и ушли — побольше или другой --world.');
}
else if (!played.ended) console.log(`Осада не кончилась за ${days} игр. дн. (--days).`);
// Бой у лагеря — своим роликом (ГФ-1): донесение удара или вылазки с записью боя.
const blow = played.reports.find((r) => r.at >= struckAt && r.battle);
if (blow?.battle) {
  const file = saveRecord(`${C}-battle`, { kind: 'battle', title: blow.title, rec: blow.battle });
  console.log(`бой у лагеря: npm run replay -- ${file}`);
}
const ended = played.ended;
if (ended?.siege) {
  console.log('');
  console.log(`Итог: ${reportWords(ended)}`);
  const file = saveRecord(C, { kind: 'siege', title: ended.title, rec: ended.siege, report: ended });
  replayHint(file);
  if (watch) await (await import('./open')).openReplay(file);
}
process.exit(0);
