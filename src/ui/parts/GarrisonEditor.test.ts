// Состав дружины — один компонент, показанный в двух местах: карточка своего замка и
// Статуя. Две проверки.
//
// По исходнику: `setGarrison` мира в интерфейсе зовёт ровно этот компонент, а показан он
// ровно в двух местах. Вторая копия редактора разошлась бы с первой так же молча, как
// расходились два разбора жеста.
//
// По миру: Статуя показывает редактор по признаку `atGates`, а карточка — по тому, стоит
// ли полководец в `figuresHere` своей деревни. Признак обязан совпадать с миром в каждой
// точке, где полководец жив, — иначе в Статуе редактор висел бы там, где мир откажет
// «только у своей деревни», или пропадал бы там, где мир согласен.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LocalWorld } from '@/world/local/LocalWorld';
import { atGates } from '@/world/store';
import { seeded } from '@/game/sim/random';
import type { Coord, FigureView, MarchView, PlayerProfile } from '@/world/types';
import { createInitialState } from '@/game/state';
import { defense } from '@/game/derived';
import { troopTotal, type TroopStack } from '@/game/battle/kinds';
import { playerProfile, syncAway } from '@/world/bridge';
import { awayOf, postureOf, weakest } from '@/world/muster';
import { musterDefense } from './GarrisonEditor';
import { DAY_LENGTH, realMs } from '@/game/pace';
/**
 * Игровой день в часах мира. Горизонт здесь — про ход по карте, а он идёт игровым
 * временем (`geo.travelTime`, решение владельца, docs/time.md, раздел 19): написанный
 * настоящими минутами, он был верен ровно пока игровой день длился минуту.
 */
const GAME_DAY = realMs(DAY_LENGTH);

const UI = path.join(process.cwd(), 'src/ui');

const code = (abs: string): string =>
  readFileSync(abs, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const abs = path.join(dir, name);
    if (statSync(abs).isDirectory()) out.push(...sources(abs));
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(abs);
  }
  return out;
}

const rel = (abs: string): string => path.relative(UI, abs).split(path.sep).join('/');

describe('состав дружины: один редактор, два места', () => {
  it('`setGarrison` мира зовёт ровно редактор, а редактор показан в карточке замка и в Статуе', () => {
    const all = sources(UI);
    // `.setGarrison` — действие мира; одноимённый сеттер галочки в `CampStrike` к нему отношения не имеет.
    const callers = all.filter((f) => /\.setGarrison\b/.test(code(f))).map(rel);
    expect(callers, 'кто зовёт setGarrison мира').toEqual(['parts/GarrisonEditor.tsx']);
    const shown = all.filter((f) => /<GarrisonEditor\b/.test(code(f))).map(rel).sort();
    expect(shown, 'где показан редактор').toEqual(['next/WorldNew.tsx', 'parts/Statue.tsx']);
    const defined = all.filter((f) => /function GarrisonEditor\b/.test(code(f))).map(rel);
    expect(defined, 'сколько редакторов определено').toEqual(['parts/GarrisonEditor.tsx']);
    // Отказы — словами мира: ошибка уходит игроку как есть.
    expect(code(path.join(UI, 'parts/GarrisonEditor.tsx')), 'отказ мира уходит как есть').toMatch(/showToast\(err \?\?/);
    expect(code(path.join(UI, 'parts/Statue.tsx')), 'Статуя показывает редактор по признаку ворот').toMatch(/atGates\(general\)/);
  });

  it('признак «у своих ворот» совпадает с миром в каждой точке, где полководец жив', async () => {
    const START = 1_700_000_000_000;
    const profile: PlayerProfile = {
      name: 'Тест',
      pop: 120,
      defense: 30,
      units: { warrior: 10, scout: 4 },
      army: { spearman: 12 },
      stock: { food: 120, wood: 80 },
      stash: 0,
    };
    let yes = 0;
    let no = 0;
    let movingAtHome = 0;
    for (const seed of [4, 17]) {
      let now = START;
      const world = new LocalWorld({ seed, now: () => now, storage: null });
      const home = (await world.info()).home;
      const rnd = seeded(seed * 104_729);
      const general = async (): Promise<FigureView> =>
        (await world.sync(profile)).figures.find((f) => f.id === 'general') as FigureView;
      for (let step = 0; step < 90; step++) {
        const roll = rnd();
        if (roll < 0.3) {
          await world.moveFigure('general', { x: home.x + Math.floor(rnd() * 3) - 1, y: home.y + Math.floor(rnd() * 3) - 1 });
        } else if (roll < 0.5) {
          await world.moveFigure('general', { x: home.x + 3 + Math.floor(rnd() * 4), y: home.y - 2 + Math.floor(rnd() * 4) } as Coord);
        } else if (roll < 0.62) {
          await world.shelter('general', rnd() < 0.5);
        } else {
          now += Math.round(rnd() * 1.5 * GAME_DAY);
        }
        const f = await general();
        // Область правила: полководец на месте и в строю. Выбывший — не «у ворот» и не «в поле».
        expect(f.phase, `сид ${seed}, шаг ${step}: полководец выбыл — точка вне области`).not.toBe('down');
        expect(f.gone, `сид ${seed}, шаг ${step}: место пустует — точка вне области`).toBeNull();
        const card = await world.settlement('home');
        const inWorld = card?.figuresHere.includes('general') ?? false;
        const where = `сид ${seed}, шаг ${step}: фаза ${f.phase}, место ${f.place}, у дома ${f.atHome}`;
        expect(atGates(f), `признак Статуи и карточка своего замка — ${where}`).toBe(inWorld);
        if (inWorld) yes++;
        else no++;
        if (f.phase === 'moving' && f.atHome) movingAtHome++;
      }
    }
    // Прогон не пустой: побывали и у ворот, и не у них, и в пути, ещё не отойдя от дома.
    expect(yes).toBeGreaterThan(20);
    expect(no).toBeGreaterThan(20);
    expect(movingAtHome, 'точки «вышел, но ещё у дома» — там признак и ломается').toBeGreaterThan(3);
  });

  // Область правила: сбор уносит виды разной мощи — только там оборона «по числу» и «по
  // составу» расходится. Две точки: сбор из пустых рук и пересбор дружины, стоящей дома;
  // в каждой — во время сбора и после. Что точка внутри, проверяется утверждением.
  it('панель сбора называет ту оборону, которую посчитает игра во время сбора и после', async () => {
    const START = 1_700_000_000_000;
    let now = START;
    const world = new LocalWorld({ seed: 7, now: () => now, storage: null });
    const s = createInitialState(7);
    s.army.clubman = 40;
    s.army.legionary = 12;
    let last: { marches: MarchView[]; figures: FigureView[] } = { marches: [], figures: [] };
    const pulse = async (): Promise<void> => {
      const p = await world.sync(playerProfile(s, awayOf(last.marches, last.figures)));
      syncAway(s, p.marches, p.figures);
      last = { marches: p.marches, figures: p.figures };
    };
    const general = (): FigureView => last.figures.find((f) => f.id === 'general') as FigureView;
    await pulse();
    const steps: TroopStack[] = [
      { legionary: 8, clubman: 2 },
      { legionary: 3, clubman: 12 },
    ];
    for (const [i, want] of steps.entries()) {
      const before = general();
      const plan = musterDefense(s, { ...before.troops }, want, postureOf(before));
      expect(postureOf(before), `шаг ${i}: точка внутри области — сбора ещё нет`).not.toBe('gathering');
      expect(await world.setGarrison(want)).toBeNull();
      await pulse();
      const during = general();
      expect(postureOf(during), `шаг ${i}: точка внутри области — идёт сбор`).toBe('gathering');
      const byNumber = defense({ ...s, away: weakest(s.army, troopTotal(s.away)) });
      expect(Math.abs(byNumber - defense(s)), `шаг ${i}: точка внутри области — числом вышло бы другое`).toBeGreaterThan(1);
      expect(plan.during, `шаг ${i}: во время сбора панель и игра`).toBeCloseTo(defense(s), 9);
      now = during.readyAt;
      await pulse();
      await pulse();
      expect(postureOf(general()), `шаг ${i}: точка внутри области — собрана и дома`).toBe('stands');
      expect(plan.after, `шаг ${i}: после сбора панель и игра`).toBeCloseTo(defense(s), 9);
    }
  });
});
