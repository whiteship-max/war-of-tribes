// Летопись: сколько записей копится за партию и во что это обходится сохранению.
//
// Нужен затем же, зачем `pop:report` нужен населению: обрезка летописи — это
// компромисс между «игрок видит историю» и «сохранение остаётся небольшим»,
// и на глаз его не подобрать. Меняешь LOG_MAX_DAYS или LOG_MAX в sim/log.ts —
// смотри отчёт.
//
//   npm run log:report
//   HOURS=4 npm run log:report
import type { GameState } from '@/game/types';
import { createInitialState } from '@/game/state';
import { startForge } from '@/game/sim/smithy';
import { startRecruit } from '@/game/sim/army';
import { buyGoods } from '@/game/sim/market';
import { seeded, setRandom } from '@/game/sim/random';
import { serialize } from '@/game/save';
import { LOG_MAX, LOG_MAX_DAYS } from '@/game/sim/log';
import { dayOf, marketLeft, marketOffer, storageCap } from '@/game/derived';
import { DAY_LENGTH, EVENT_INTERVAL_MAX, EVENT_INTERVAL_MIN, MAX_OFFLINE_SECONDS } from '@/game/constants';
import { away, pilot, player } from './autopilot';
import { tick } from '@/game/sim/tick';
import { EVENT_TTL, SILENCE_PREFIX, eventId, mailStep, resolveEvent } from '@/game/sim/mail';
import { EVENT_BY_ID } from '@/game/data/events';
import { LETTER_DECISIONS } from '@/world/letters';

const HOURS = Number(process.env.HOURS ?? 3);
const STEP = Number(process.env.STEP ?? 15);
/** Мир партии — тихий (набегов нет): летопись меряется у хозяйства, а веру деревне мир называет, как в игре. */
const WORLD = 7;

/** Предел тела запроса к серверу хранения — см. MAX_BODY_BYTES в netlify/lib/http.ts. */
const BODY_LIMIT = 512 * 1024;

/**
 * Размер строки в байтах UTF-8 (столько уедет по сети и столько займёт файл) и
 * в кодовых единицах UTF-16 (столько считает localStorage). Для кириллицы это
 * вдвое разные числа, и путать их нельзя.
 */
const bytes = (s: string): number => Buffer.byteLength(s, 'utf8');
const kb = (n: number): string => `${(n / 1024).toFixed(1)} КБ`;

function report(title: string, s: GameState): void {
  const whole = serialize(s);
  const logJson = JSON.stringify(s.log);
  const day = dayOf(s.time);
  const oldest = s.log.reduce((m, e) => Math.min(m, dayOf(e.at)), day);
  const perEntry = s.log.length ? bytes(logJson) / s.log.length : 0;

  console.log(`\n${title}`);
  console.log(`  день партии            ${day}`);
  console.log(`  записей в летописи     ${s.log.length}`);
  console.log(`  самая старая запись    день ${oldest} (возраст ${day - oldest} дн.)`);
  console.log(`  одна запись            ${perEntry.toFixed(0)} байт utf-8`);
  console.log(`  летопись               ${kb(bytes(logJson))} utf-8 · ${logJson.length} символов`);
  console.log(`  всё сохранение         ${kb(bytes(whole))} utf-8 · ${whole.length} символов`);
  console.log(`  доля летописи          ${((logJson.length / whole.length) * 100).toFixed(0)}%`);
  console.log(`  доля предела сервера   ${((bytes(whole) / BODY_LIMIT) * 100).toFixed(1)}% от ${kb(BODY_LIMIT)}`);
  // Во что обойдётся запасной предел, если в него упрутся. Считается от
  // измеренного размера записи этой же партии, а не от числа на глаз.
  if (perEntry > 0) {
    const worst = perEntry * LOG_MAX;
    const worstChars = (logJson.length / s.log.length) * LOG_MAX;
    console.log(
      `  предел ${LOG_MAX} записей     ${kb(worst)} utf-8 · ${Math.round(worstChars)} символов · ` +
        `${((bytes(whole) - bytes(logJson) + worst) / BODY_LIMIT * 100).toFixed(1)}% предела сервера`,
    );
  }
  console.log(`  записей в игровой день ${perDay(s).toFixed(1)}, в самый плотный день ${peakDay(s)}`);
  // Предел по количеству обязан не срабатывать: сработал — значит ступень
  // «за месяц» показала меньше месяца, и обещание нарушено молча.
  if (s.log.length >= LOG_MAX) {
    console.log('  ВНИМАНИЕ: упёрлись в запасной предел — «за месяц» покажет меньше месяца.');
  }
}

/**
 * Партия, которая не только строит, но и живёт: кузница всё время под нарядом,
 * казармы набирают, события поднимаются и разрешаются. Без этого отчёт мерил
 * тишину — а летопись раздувают именно ковка и наём, по строке на предмет и на
 * бойца, и именно они решают, каким должен быть предел.
 *
 * `trade` — торговое племя: рынок пишет по строке на заказ и по строке на
 * возвращение каравана, а кнопка покупки берёт по единице за раз. Долгое время
 * отчёт этого писаря не видел вовсе — прилавка в прогоне не было, — и месячная
 * ступень летописи ломалась молча. Кто чаще всех пишет, тот и должен быть в
 * отчёте.
 */
async function play(hours: number, trade = false): Promise<GameState> {
  setRandom(seeded(7));
  // Сид партии закреплён тем же числом: без него партия бралась от `freshSeed`, и имя
  // полководца, а с ним длина сохранения, плавали от прогона к прогону на знак-другой.
  const s = createInitialState(7);
  s.tutorialDone = true;
  let nextHire = 0;
  let tradeDay = -1;
  // Общий автопилот: живая игра при игроке — события поднимаются и игрок их разбирает (иначе
  // одно повисшее событие затыкает все следующие), люди расставлены, посёлок строится. Своё у
  // отчёта — только то, что пишет в летопись: кузница под заказом, наём и торговля.
  const scribe = (s: GameState): void => {
    if (trade && dayOf(s.time) !== tradeDay) {
      tradeDay = dayOf(s.time);
      // Казна пополняется извне: считаем строки летописи, а не золото. У живого
      // игрока её пополняют налог и взятые замки.
      s.gold = Math.max(s.gold, 200_000);
      for (const g of marketOffer(s)) {
        // В полный склад не покупаем. Это не поблажка отчёту, а поведение
        // игрока: за товар, который испарится на пороге, платят золотом, и
        // второй раз так никто не делает. Бот, месяц заказывающий камень в
        // полный амбар, мерил бы не летопись, а собственную глупость.
        const room = g.resource ? storageCap(s) - s.resources[g.resource] : Infinity;
        for (let i = 0; i < Math.min(marketLeft(s, g), 8, room); i++) buyGoods(s, g.id, 1);
      }
    }
    // Кузница под непрерывным заказом: очередь пустеет — игрок ставит новый.
    // Строка в летописи выходит одна на заказ, а не на предмет, — это и есть
    // то, что отчёт должен померить.
    if (s.forge.length === 0) startForge(s, 'spear', 10);
    if (s.recruits.length === 0 && s.time >= nextHire) {
      startRecruit(s, 'spearman', 5);
      nextHire = s.time + 10 * DAY_LENGTH;
    }
  };
  await pilot({
    g: s,
    seconds: hours * 3600,
    player: player(null, { also: scribe }),
    world: { seed: WORLD, pulse: STEP, raids: false },
    economy: 'live',
    tick: STEP,
    decide: STEP,
  });
  return s;
}

/** Записей в игровой день внутри окна хранения — темп, а не остаток. */
function perDay(s: GameState): number {
  const day = dayOf(s.time);
  const oldest = s.log.reduce((m, e) => Math.min(m, dayOf(e.at)), day);
  return s.log.length / Math.max(1, day - oldest + 1);
}

/** Кто наполняет летопись: без этого не понять, что резать. */
function sources(s: GameState): [string, number][] {
  const by = new Map<string, number>();
  for (const e of s.log) {
    const k = e.text.replace(/\d+([.,]\d+)?/g, 'N').slice(0, 44);
    by.set(k, (by.get(k) ?? 0) + 1);
  }
  return [...by.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
}

/** Самый плотный игровой день окна — пик, который обязан выдержать предел. */
function peakDay(s: GameState): number {
  const n = new Map<number, number>();
  for (const e of s.log) n.set(dayOf(e.at), (n.get(dayOf(e.at)) ?? 0) + 1);
  return [...n.values()].reduce((m, x) => Math.max(m, x), 0);
}

async function main(): Promise<void> {
  console.log(`Летопись: прогон ${HOURS} ч игрового времени (${Math.round((HOURS * 3600) / DAY_LENGTH)} игровых дней).`);
  console.log(`Один игровой день = ${DAY_LENGTH} с реального времени.`);
  console.log(`Правило обрезки: старше ${LOG_MAX_DAYS} игровых дней выбрасывается, запасной предел ${LOG_MAX} записей.`);

  console.log(`Общий автопилот в тихом мире ${WORLD}: живая игра при игроке, ответы на события, вера мира, стройка.`);
  const s = await play(HOURS);
  report(`Активная игра, ${HOURS} ч подряд:`, s);
  console.log('\n  Кто наполняет летопись:');
  for (const [text, n] of sources(s)) console.log(`  ${String(n).padStart(4)} × ${text}`);

  // Возвращение из офлайна: догон съедает MAX_OFFLINE_SECONDS одним куском и
  // пишет в летопись за все пропущенные дни разом. Это худший случай для обрезки
  // по возрасту — проверять надо именно его.
  const offlineDays = Math.round(MAX_OFFLINE_SECONDS / DAY_LENGTH);
  const o = await play(HOURS);
  away(o, MAX_OFFLINE_SECONDS, 2);
  report(`После офлайн-догона на ${MAX_OFFLINE_SECONDS / 3600} ч (${offlineDays} игровых дней):`, o);

  // Партия подлиннее: докуда доходит счётчик, если играть не отрываясь.
  const long = await play(HOURS * 3);
  report(`Активная игра, ${HOURS * 3} ч подряд:`, long);
  console.log('\n  Кто наполняет летопись:');
  for (const [text, n] of sources(long)) console.log(`  ${String(n).padStart(4)} × ${text}`);

  // Торговое племя — самый плотный писарь из всех, и до сих пор его в отчёте не
  // было вовсе: прилавка в прогоне не существовало, а предел 250 записей мерили
  // по партии, которая ничего не покупает. Отсюда и брались «3.8 записи в день».
  //
  // Этот прогон обязан кричать, и крик его — не ложная тревога. Заказ и приход
  // каравана склеиваются по товару за сутки (как ковка и наём), поэтому дюжина
  // заказов одного товара стоит теперь двух строк вместо двадцати четырёх. Но на
  // рынке высокого уровня товаров на прилавке дюжина, и племя, каждый день
  // берущее всё, пишет ~13 строк в день — на месяц надо ~400, а предел 250.
  // Выбор между «поднять предел» (сохранение растёт на ~28 КБ, а оно уезжает на
  // сервер раз в минуту) и «рынок должен писать короче» —
  // решение владельца баланса, а не обрезки: и то, и другое здесь видно числами.
  const trader = await play(HOURS * 3, true);
  report(`Торговое племя, ${HOURS * 3} ч подряд (заказы каждый день):`, trader);
  console.log('\n  Кто наполняет летопись:');
  for (const [text, n] of sources(trader)) console.log(`  ${String(n).padStart(4)} × ${text}`);
}


// Почта державы: сколько донесений-событий игрок видит за сутки и сколько решается
// без него (docs/realm.md, раздел 8). События поднимаются только при игроке, раз в
// EVENT_INTERVAL_MIN…MAX игровых секунд; стол держит LETTER_DECISIONS, срок — сутки
// настоящими часами. Настоящее время здесь своё: заход идёт часами игры один к
// одному, между заходами часы идут, а игра догоняет не больше MAX_OFFLINE_SECONDS.
// Замер — модель игрока, а не игрок: заходы ровные, длина задана. Посёлок — тот, что
// вырос за час общего автопилота; события выпадают по его весам.
interface MailDay {
  raised: number;
  answered: number;
  crowded: number;
  expired: number;
}

const MAIL_DAYS = 3;

function mailDay(base: GameState, visits: number, minutes: number, reads: boolean): MailDay & { left: number } {
  const s = structuredClone(base);
  s.inbox = [];
  s.nextEventAt = s.time;
  const all: MailDay = { raised: 0, answered: 0, crowded: 0, expired: 0 };
  let last: MailDay = { ...all };
  const seen = new Set<string>();
  const silent = (): number => s.log.filter((l) => l.text.includes(SILENCE_PREFIX)).length;
  const answerAll = (): void => {
    if (!reads) return;
    for (const ev of [...s.inbox]) {
      const def = EVENT_BY_ID[ev.defId];
      const i = def.options.findIndex((o) => !o.cost);
      if (resolveEvent(s, Math.max(0, i), eventId(ev)).error === null) all.answered++;
    }
  };
  const gap = (24 * 3600) / visits;
  let now = 1_900_000_000_000;
  for (let d = 0; d < MAIL_DAYS; d++) {
    // Считаются последние сутки: к ним стол уже живёт, а не начинается пустым.
    if (d === MAIL_DAYS - 1) last = { ...all, raised: seen.size };
    for (let v = 0; v < visits; v++) {
      // Заход: читающий игрок заглядывает в почту раз в минуту — счётчик на гербе
      // зовёт, — и ещё раз перед уходом.
      for (let t = 0; t < minutes * 60; t++) {
        if (t % 60 === 0) answerAll();
        let n = silent();
        tick(s, 1);
        all.crowded += silent() - n;
        for (const ev of s.inbox) seen.add(eventId(ev));
        now += 1000;
        n = silent();
        mailStep(s, now);
        all.expired += silent() - n;
      }
      answerAll();
      // Отлучка: часы идут, игра догоняет не больше MAX_OFFLINE_SECONDS, событий офлайн
      // нет. Шаг догона крупный: он двигает только посёлок, по чьим весам выпадают события.
      const off = gap - minutes * 60;
      away(s, Math.min(off, MAX_OFFLINE_SECONDS), 30);
      now += off * 1000;
      const n = silent();
      mailStep(s, now);
      all.expired += silent() - n;
    }
  }
  return {
    raised: seen.size - last.raised,
    answered: all.answered - last.answered,
    crowded: all.crowded - last.crowded,
    expired: all.expired - last.expired,
    left: s.inbox.length,
  };
}

async function mailSection(): Promise<void> {
  console.log('\n=== ПОЧТА: сколько донесений в сутки и сколько решается без игрока ===');
  console.log(`Стол — ${LETTER_DECISIONS} событий (как у писем мира), срок — ${EVENT_TTL / 3600000} ч настоящих;`);
  console.log(`событие приходит раз в ${EVENT_INTERVAL_MIN}–${EVENT_INTERVAL_MAX} с игры и только при игроке. Счёт — ${MAIL_DAYS}-и сутки из ${MAIL_DAYS}.`);
  const base = await play(1);
  console.log('');
  console.log('  заходов × минут   игрок              пришло   ответил   согнано столом   истекло   на столе к концу');
  for (const [visits, minutes] of [
    [3, 5],
    [6, 5],
    [2, 20],
  ] as const) {
    for (const reads of [true, false]) {
      const r = mailDay(base, visits, minutes, reads);
      console.log(
        `  ${String(visits).padStart(6)} × ${String(minutes).padEnd(7)}  ${(reads ? 'разбирает почту' : 'не открывает').padEnd(17)}  ${String(r.raised).padStart(6)}   ${String(r.answered).padStart(7)}   ${String(r.crowded).padStart(14)}   ${String(r.expired).padStart(7)}   ${String(r.left).padStart(16)}`,
      );
    }
  }
}

await main();
await mailSection();
