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
import { describe, expect, it } from 'vitest';
import { createInitialState } from '@/game/state';
import { MUTINY_EVENT } from '@/game/data/order';
import { faithAt } from '@/world/faith';
import { pilot, player, type Inside } from './autopilot';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPTS = path.join(ROOT, 'scripts');
const DOOR = path.join(SCRIPTS, 'autopilot.ts');

/** Шаги, которые идут только через дверь: модуль (по хвосту пути) → имена. */
const STEPS: [string, string[]][] = [
  ['game/sim/tick', ['tick', 'catchUp']],
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
  // Область правила: новая партия, у которой веры ещё нет, и прогон, в котором событие поднимается
  // (`nextEventAt` в начале). Обе точки проверяются утверждением: без них «вера пришла» и «событие
  // разобрано» проходили бы даром.
  it('игрок отвечает на события и берёт веру, которую называет мир', async () => {
    const g = createInitialState(7);
    g.tutorialDone = true;
    g.nextEventAt = 30;
    expect(g.faith.id, 'точка внутри области: у новой партии веры ещё нет').toBeNull();
    let raised = 0;
    let open = 0;
    const flown = await pilot({
      g,
      seconds: 15 * 60,
      player: player(null),
      world: { seed: 7, pulse: 30, raids: false },
      economy: 'live',
      tick: 1,
      decide: 30,
      watch: {
        after: ({ g: x }) => {
          if (x.activeEvent && x.activeEvent.defId !== MUTINY_EVENT) raised++;
        },
        decided: (x) => {
          if (x.activeEvent && x.activeEvent.defId !== MUTINY_EVENT) open++;
        },
      },
    });
    expect(raised, 'точка внутри области: события поднимались').toBeGreaterThan(0);
    expect(open, 'событие висит после решения игрока').toBe(0);
    expect(flown.ledger.answered, 'игрок разобрал поднявшиеся события').toBeGreaterThanOrEqual(raised);
    const home = (flown.world as Inside).save.home;
    expect(g.faith.id, 'вера пришла пульсом — та, что под замком').toBe(faithAt(home.x, home.y));
  });
});
