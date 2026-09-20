// Автопилот один, и держится это двумя половинами.
//
// **По исходникам.** Всё, что в `scripts/` гоняет племя во времени или кладёт в него пульс мира, идёт
// через `scripts/autopilot.ts`. Кто нарушает, тест находит сам — по импортам шагов, а не по списку
// отчётов: список ловит только те файлы, о которых подумали, а шестой автопилот заводится как раз в
// новом файле. Шаги — время племени (`tick`, `catchUp`), пульс и его части (`tribePulse`, `syncAway`,
// `syncSiege`, `syncFaith`, `setAway`) и последствие в племя (`applyEffects`, `applyExpedition`).
// Той же меркой проверяется игра: `world/store` пульсует через `tribePulse` и частей пульса не зовёт.
//
// **Прогоном.** Дверь не пустая: игрок в ней отвечает на события и берёт веру, которую называет мир, —
// ровно то, чего не делали прежние копии.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createInitialState } from '@/game/state';
import { MUTINY_EVENT } from '@/game/data/order';
import { faithAt } from '@/world/faith';
import { eventId } from '@/game/sim/mail';
import { setTimeScale, timeScale } from '@/game/pace';
import { pilot, player, type Inside } from './autopilot';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPTS = path.join(ROOT, 'scripts');
const DOOR = path.join(SCRIPTS, 'autopilot.ts');

/** Шаги, которые идут только через дверь: модуль (по хвосту пути) → имена. */
const STEPS: [string, string[]][] = [
  ['game/sim/tick', ['tick', 'catchUp', 'liveStep', 'absence']],
  ['world/bridge', ['tribePulse', 'syncAway', 'syncSiege', 'applyEffects']],
  ['game/sim/faith', ['syncFaith']],
  ['game/sim/expedition', ['applyExpedition', 'setAway']],
];

const code = (abs: string): string =>
  readFileSync(abs, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const abs = path.join(dir, name);
    if (statSync(abs).isDirectory()) out.push(...sources(abs));
    else if (/\.(ts|mts|mjs|js)$/.test(name) && !/\.test\.(ts|mts|mjs|js)$/.test(name)) out.push(abs);
  }
  return out;
}

/** Что файл берёт из модулей шагов: имена статических импортов, целый модуль (`* as`, `import()`) — как `*`. */
function stepsTaken(src: string): string[] {
  const taken: string[] = [];
  const modOf = (spec: string): [string, string[]] | null => STEPS.find(([m]) => spec.replace(/\.(ts|js)$/, '').endsWith(m)) ?? null;
  for (const m of src.matchAll(/import\s+(type\s+)?([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g)) {
    if (m[1]) continue;
    const step = modOf(m[3]);
    if (!step) continue;
    const clause = m[2];
    if (/\*\s+as\s+/.test(clause)) {
      taken.push(`${step[0]}:*`);
      continue;
    }
    const names = (clause.match(/\{([\s\S]*)\}/)?.[1] ?? '')
      .split(',')
      .map((x) => x.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0])
      .filter(Boolean);
    for (const n of names) if (step[1].includes(n)) taken.push(`${step[0]}:${n}`);
  }
  for (const m of src.matchAll(/import\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    const step = modOf(m[1]);
    if (step) taken.push(`${step[0]}:*`);
  }
  return taken;
}

describe('автопилот один: по исходникам', () => {
  it('в scripts/ время племени и пульс мира идут только через scripts/autopilot.ts', () => {
    const files = sources(SCRIPTS).filter((f) => f !== DOOR);
    // Точка внутри области: скрипты найдены, и среди них есть те, кто гоняет мир.
    expect(files.length, 'скрипты найдены').toBeGreaterThan(10);
    const bypass = files
      .map((f) => ({ file: path.relative(ROOT, f).split(path.sep).join('/'), steps: stepsTaken(code(f)) }))
      .filter((x) => x.steps.length > 0)
      .map((x) => `${x.file}: ${x.steps.join(', ')}`);
    expect(bypass, 'скрипты, которые шагают племя или пульсуют мир мимо автопилота').toEqual([]);
  });

  it('дверь живая: шаги в ней, и отчёты её зовут', () => {
    const door = stepsTaken(code(DOOR));
    // Сама проверка импортов обязана видеть шаги там, где они есть, — иначе пустой список выше даром.
    expect(door, 'дверь берёт время и пульс').toEqual(expect.arrayContaining(['game/sim/tick:tick', 'game/sim/tick:catchUp', 'world/bridge:tribePulse', 'world/bridge:applyEffects']));
    const users = sources(SCRIPTS).filter((f) => f !== DOOR && /from\s+['"]\.\/autopilot['"]/.test(code(f)) && /\b(pilot|openSky|stand|away|playedFor)\s*\(/.test(code(f)));
    expect(users.length, 'отчётов, идущих через дверь').toBeGreaterThan(5);
  });

  it('игра пульсует той же дверью: world/store зовёт tribePulse и частей пульса не берёт', () => {
    const store = code(path.join(ROOT, 'src/world/store.ts'));
    expect(store, 'store зовёт tribePulse').toMatch(/\btribePulse\s*\(/);
    expect(stepsTaken(store).filter((s) => !s.endsWith(':tribePulse')), 'части пульса в сторе').toEqual([]);
  });
});

describe('автопилот один: прогоном', () => {
  afterEach(() => setTimeScale());

  // Область правила: шкала отлична от единицы (при единице перевод неотличим от его отсутствия),
  // и пульс короче шага племени в игровых секундах — остаток обязан перейти следующему пульсу.
  // Срок прогона — игровое время: племя проживает ровно его, а мир за это время бьётся пульсом по
  // настоящим секундам — в шкалу раз чаще, чем прожито игровых.
  it('пульс мира — настоящие секунды, срок прогона — игровые: перевод у двери времени', async () => {
    setTimeScale(30);
    expect(timeScale(), 'точка внутри области: шкала отлична от единицы').not.toBe(1);
    const g = createInitialState(7);
    g.tutorialDone = true;
    g.nextEventAt = Infinity;
    const t0 = g.time;
    const flown = await pilot({
      g,
      seconds: 20,
      player: player(null, { staff: false, build: false }),
      world: { seed: 7, pulse: 60, raids: false },
      economy: 'live',
      tick: 3,
      decide: 15,
    });
    expect(60 / 30, 'точка внутри области: пульс короче шага племени').toBeLessThan(3);
    // Пульс — две игровые секунды, шаг — три: остаток переходит следующему пульсу, и за десять пульсов
    // племя делает шесть шагов, а не ноль и не десять.
    expect(g.time - t0, 'двадцать игровых секунд срока — шесть шагов по три').toBe(18);
    expect(flown.cost.ticks, 'шагов племени — по игровым секундам, а не по настоящим').toBe(6);
    // Десять настоящих минут мира при пульсе в минуту — десять пульсов и первый, открывающий мир.
    expect(flown.cost.pulses, 'пульсов мира — по настоящим секундам').toBe((20 * 30) / 60 + 1);
  });

  // Область правила: новая партия, у которой веры ещё нет, и прогон, в котором весть приходит
  // (сутки настоящего времени против сетки в восемь часов). Обе точки проверяются утверждением: без них «вера пришла» и «событие
  // разобрано» проходили бы даром.
  it('игрок отвечает на события и берёт веру, которую называет мир', async () => {
    const g = createInitialState(7);
    g.tutorialDone = true;
    expect(g.faith.id, 'точка внутри области: у новой партии веры ещё нет').toBeNull();
    const raised = new Set<string>();
    let open = 0;
    const flown = await pilot({
      g,
      // Вести приходят по сетке настоящих часов (шаг 8 ч): сутки прогона — три прихода.
      seconds: 24 * 3600,
      player: player(null),
      world: { seed: 7, pulse: 30, raids: false },
      economy: 'live',
      tick: 30,
      decide: 30,
      watch: {
        after: ({ g: x }) => {
          for (const e of x.inbox) if (e.defId !== MUTINY_EVENT) raised.add(eventId(e));
        },
        decided: (x) => {
          open += x.inbox.filter((e) => e.defId !== MUTINY_EVENT).length;
        },
      },
    });
    expect(raised.size, 'точка внутри области: события поднимались').toBeGreaterThan(0);
    expect(open, 'событие висит после решения игрока').toBe(0);
    // Пришедшее после последнего решения ещё ждёт на столе — его разберут следующим решением.
    const waiting = g.inbox.filter((e) => e.defId !== MUTINY_EVENT).length;
    expect(flown.ledger.answered + waiting, 'игрок разобрал поднявшиеся события').toBeGreaterThanOrEqual(raised.size);
    const home = (flown.world as Inside).save.home;
    expect(g.faith.id, 'вера пришла пульсом — та, что под замком').toBe(faithAt(home.x, home.y));
  });
});
