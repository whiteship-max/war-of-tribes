// Состав отряда полководца — одно окно дела (К-2; ДР-6, docs/siege_v2.md, «Решения ДР-6»): раскладки в «Дружине» больше
// нет, и окна игры приказа раскладки мира не зовут вовсе. Статуя и карточка своего замка ведут в «Дружину» строкой.
//
// По исходнику: `setGarrison` мира в интерфейсе не зовёт никто, окно состава показано ровно в окне дела (`map/ArmySend`), а
// оно — ровно в меню дел (`map/ActionMenu`); уход — дело с составом одним приказом (`ErrandOrder.troops`). Вторая копия окна
// разошлась бы с первой так же молча, как расходились два разбора жеста.
//
// По миру: окно даёт шаг по `FigureView.regroup` — признак обязан совпадать с ответом самого приказа в каждой точке,
// где полководец жив, — иначе окно предлагало бы состав там, где мир откажет, или прятало бы его там, где мир согласен.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LocalWorld } from '@/world/local/LocalWorld';
import { seeded } from '@/game/sim/random';
import type { Coord, FigureView, MarchView, PlayerProfile } from '@/world/types';
import { createInitialState } from '@/game/state';
import { defense } from '@/game/derived';
import { troopTotal, type TroopStack } from '@/game/battle/kinds';
import { playerProfile, syncAway } from '@/world/bridge';
import { awayOf, postureOf, weakest } from '@/world/muster';
import { musterDefense } from './Muster';
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

describe('состав отряда: одно окно дела, раскладки нет', () => {
  it('`setGarrison` мира интерфейс не зовёт, окно состава — только в окне дела, окно дела — только в меню дел', () => {
    const all = sources(UI);
    // `.setGarrison` — действие мира; одноимённый сеттер галочки в `CampStrike` к нему отношения не имеет.
    const callers = all.filter((f) => /\.setGarrison\b/.test(code(f))).map(rel);
    expect(callers, 'кто зовёт setGarrison мира').toEqual([]);
    const shown = all.filter((f) => /<Muster\b/.test(code(f))).map(rel).sort();
    expect(shown, 'где показано окно состава').toEqual(['map/ArmySend.tsx']);
    const windows = all.filter((f) => /<ArmySend\b/.test(code(f))).map(rel).sort();
    expect(windows, 'где показано окно дела').toEqual(['map/ActionMenu.tsx']);
    const links = all.filter((f) => /<MusterLink\b/.test(code(f))).map(rel).sort();
    // Строка-вход — в карточке полководца (Ратуша и «Походы», ДР-7) и в карточке своего замка; в Статуе её нет.
    expect(links, 'где строка-вход в «Дружину»').toEqual(['next/WorldNew.tsx', 'parts/AgentCard.tsx']);
    const defined = all.filter((f) => /function Muster\b/.test(code(f))).map(rel);
    expect(defined, 'сколько окон определено').toEqual(['parts/Muster.tsx']);
    const muster = code(path.join(UI, 'parts/Muster.tsx'));
    // Уход — дело с составом одним приказом; шаг — по признаку мира.
    expect(muster, 'состав едет в приказе дела').toMatch(/w\.errand\(want \? \{ \.\.\.order, troops:/);
    expect(muster, 'шаг — по признаку мира').toMatch(/regroup\.instant/);
    expect(muster, 'кнопки «Подтвердить» нет').not.toMatch(/Подтвердить/);
    // «Дружина» — без раскладки: ни окна, ни «Подтвердить», ни «Всех в отряд».
    const army = code(path.join(UI, 'panels/ArmyPanel.tsx'));
    for (const gone of ['<Muster', 'Подтвердить', 'Всех в отряд', 'Всех в гарнизон', 'Гарнизон и отряд']) {
      expect(army, `в «Дружине» нет «${gone}»`).not.toContain(gone);
    }
    // Поход из карточки места и выручка ведут в окно дела, а не шлют дело мимо него.
    expect(code(path.join(UI, 'next/WorldNew.tsx')), 'карточка места — в окно дела').toMatch(/openMenu\('general', \{ x: card\.x, y: card\.y \}, \{ deed, fate \}\)/);
    expect(code(path.join(UI, 'next/WarCard.tsx')), 'выручка — в окно дела').toMatch(/openMenu\('general', \{ x: card\.x, y: card\.y \}, \{ deed: 'relief' \}\)/);
  });

  it('признак окна совпадает с ответом приказа в каждой точке, где полководец жив', async () => {
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
    let city = 0;
    let movingAtHome = 0;
    for (const seed of [4, 17, 29]) {
      let now = START;
      const world = new LocalWorld({ seed, now: () => now, storage: null });
      const home = (await world.info()).home;
      const rnd = seeded(seed * 104_729);
      const general = async (): Promise<FigureView> =>
        (await world.sync(profile)).figures.find((f) => f.id === 'general') as FigureView;
      for (let step = 0; step < 90; step++) {
        const roll = rnd();
        if (roll < 0.25) {
          await world.moveFigure('general', { x: home.x + Math.floor(rnd() * 3) - 1, y: home.y + Math.floor(rnd() * 3) - 1 });
        } else if (roll < 0.42) {
          await world.moveFigure('general', { x: home.x + 3 + Math.floor(rnd() * 4), y: home.y - 2 + Math.floor(rnd() * 4) } as Coord);
        } else if (roll < 0.52) {
          // Домой — к своим воротам: только оттуда входят в город.
          await world.recallFigure('general');
        } else if (roll < 0.66) {
          await world.shelter('general', rnd() < 0.7);
        } else {
          now += Math.round(rnd() * 1.5 * GAME_DAY);
        }
        const f = await general();
        // Область правила: полководец на месте и в строю. Выбывший — не «дома» и не «в поле».
        expect(f.phase, `сид ${seed}, шаг ${step}: полководец выбыл — точка вне области`).not.toBe('down');
        expect(f.gone, `сид ${seed}, шаг ${step}: место пустует — точка вне области`).toBeNull();
        const where = `сид ${seed}, шаг ${step}: фаза ${f.phase}, место ${f.place}, у дома ${f.atHome}`;
        // Приказ, ничего не меняющий, отвечает ровно той проверкой, что стоит перед любым составом.
        const answer = await world.setGarrison(f.troops);
        expect(f.regroup?.block ?? null, `признак окна и ответ приказа — ${where}`).toBe(answer);
        if (answer === null) yes++;
        else no++;
        if (f.place === 'city') {
          city++;
          expect(answer, `укрывшись в городе, раскладку меняют — ${where}`).toBeNull();
        }
        if (f.phase === 'moving' && f.atHome) movingAtHome++;
      }
    }
    // Прогон не пустой: побывали и дома, и в поле, и в городе, и в пути, ещё не отойдя от дома.
    expect(yes).toBeGreaterThan(20);
    expect(no).toBeGreaterThan(20);
    expect(city, 'точки «укрылся в городе» — прежде там был отказ').toBeGreaterThan(3);
    expect(movingAtHome, 'точки «вышел, но ещё у дома» — там признак и ломается').toBeGreaterThan(3);
  });

  // Область правила: сбор уносит виды разной мощи — только там оборона «по числу» и «по
  // составу» расходится. Сбор остался там, где перевод не мгновенный (docs/retinue.md, раздел 7): в поле у своих
  // ворот и в осаде; мерка — поле у ворот. Две точки: сбор из пустых рук и пересбор отряда, стоящего у ворот; в
  // каждой — во время сбора и после. Что точка внутри, проверяется утверждением.
  it('панель сбора называет ту оборону, которую посчитает игра во время сбора и после — в поле у ворот', async () => {
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
    // В поле вплотную к своему городу (дойти туда нельзя — придя к воротам, он дома; стоять там — можно, правило мира
    // это место знает, `regroupBlock`): ставим прямо.
    const save = (world as unknown as { save: { home: Coord; figures: { general: object } } }).save;
    const at = { x: save.home.x + 1, y: save.home.y };
    Object.assign(save.figures.general, { phase: 'field', from: { ...at }, to: { ...at }, departAt: now, arriveAt: now });
    await pulse();
    expect(general().phase, 'точка внутри области: в поле у своих ворот').toBe('field');
    expect(general().regroup?.instant, 'точка внутри области: перевод не мгновенный').toBe(false);
    const steps: TroopStack[] = [
      { legionary: 8, clubman: 2 },
      { legionary: 3, clubman: 12 },
    ];
    for (const [i, want] of steps.entries()) {
      const before = general();
      const plan = musterDefense(s, { ...before.troops }, want, postureOf(before), before.phase === 'home');
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
      expect(postureOf(general()), `шаг ${i}: точка внутри области — собран, в поле у ворот`).toBe('engaged');
      expect(plan.after, `шаг ${i}: после сбора панель и игра`).toBeCloseTo(defense(s), 9);
    }
  });
});
