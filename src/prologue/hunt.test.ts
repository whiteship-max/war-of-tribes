/**
 * Охота: олень, туша и стрелы.
 *
 * Проверяются здесь три обещания, и ни одно из них не про арифметику:
 *
 *   1. **граница детерминизма проведена там, где сказано.** Есть ли зверь на
 *      поляне и где он вышел — считается на чтении и повторяется у всех
 *      одинаково; как он ходит — время сцены, и сюда не попадает вовсе.
 *      `Math.random` в предыстории нет ни одного, и это проверяется чтением
 *      всей папки;
 *   2. **стрела не размножается и не пропадает.** Сумма «в колчане плюс на
 *      земле» меняется ровно на одну и ровно в те три мгновения, когда должна;
 *   3. **зверя не достать рукой.** Досягаемость тапа и расстояние, на котором
 *      олень срывается, разведены нарочно и с запасом: смешай их — и лук
 *      перестанет быть нужен.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ARROWS_START,
  ARROW_RANGE,
  CARCASS_MS,
  DEER_ALERT,
  DEER_FLEE,
  DEER_SLEEP_FLEE,
  DEER_GAP_MS,
  DEER_MEAT,
  DEER_RUN,
  arrowHits,
  arrowLanding,
  arrowsAll,
  carcassLeft,
  carcassLeftMs,
  deerHome,
  deerInMs,
  deerLive,
  deerSleeps,
  fleeRange,
  landArrow,
  liveCarcass,
  newHunt,
  nockArrow,
  pickArrow,
  type Hunt,
} from './hunt';
import { EYE, GLADE_R, REACH, WALK_SPEED } from './glade';
import { freshPrologue, revive } from './save';
import { DAY_SHARE, SKY_MS, isNight } from './sky';
import { WOLF_GAP_MS, packAt } from './wolves';

const H = 3_600_000;

describe('олень: есть ли он — считается на чтении', () => {
  it('на новой поляне зверь уже ходит', () => {
    // Иначе новому игроку нечему учиться: лук есть, стрелять не в кого.
    expect(deerLive(newHunt(), 0)).toBe(true);
    expect(deerInMs(newHunt(), 0)).toBe(0);
  });

  it('убитый уходит на три часа, потом приходит следующий', () => {
    const hunt: Hunt = { killedAt: 1000, carcass: null };
    expect(deerLive(hunt, 1000)).toBe(false);
    expect(deerLive(hunt, 1000 + DEER_GAP_MS - 1)).toBe(false);
    expect(deerLive(hunt, 1000 + DEER_GAP_MS)).toBe(true);
    expect(deerInMs(hunt, 1000 + H)).toBe(DEER_GAP_MS - H);
  });

  it('ответ не зависит от того, сколько раз спросили', () => {
    // Тик, которого не случилось, теряется; формула отдаёт одно и то же.
    const hunt: Hunt = { killedAt: 5 * H, carcass: null };
    const once = deerLive(hunt, 9 * H);
    for (let i = 0; i < 100; i++) deerLive(hunt, i * H);
    expect(deerLive(hunt, 9 * H)).toBe(once);
    expect(hunt).toEqual({ killedAt: 5 * H, carcass: null });
  });

  it('место выхода — из отметки времени, а не из броска', () => {
    // Одна и та же история — одна и та же поляна: это и значит «детерминизм».
    const hunt: Hunt = { killedAt: 7 * H, carcass: null };
    expect(deerHome(hunt)).toEqual(deerHome({ ...hunt }));
    // И зверь выходит не туда, где стоял прошлый: мест несколько, и разные
    // отметки времени попадают в разные.
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const p = deerHome({ killedAt: i * 37 * 60_000, carcass: null });
      seen.add(`${p.x}|${p.z}`);
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it('выходит он дальше, чем срывается: под руку зверь не встаёт', () => {
    for (let i = 0; i < 20; i++) {
      const p = deerHome({ killedAt: i * 91 * 60_000, carcass: null });
      expect(Math.hypot(p.x, p.z)).toBeGreaterThan(DEER_FLEE);
      expect(Math.hypot(p.x, p.z)).toBeLessThan(GLADE_R);
    }
  });
});

describe('ночью зверь спит', () => {
  it('спит ровно тогда, когда на поляне ночь, — и считается это на чтении', () => {
    // Одна дверь на сцену и на тест: `deerSleeps` смотрит на то же небо, что и
    // свет, и второго «ночь ли сейчас» у зверя быть не должно.
    for (let t = 0; t < SKY_MS * 3; t += 3_700) {
      expect(deerSleeps(t), `${t}`).toBe(isNight(t));
      expect(fleeRange(t), `${t}`).toBe(isNight(t) ? DEER_SLEEP_FLEE : DEER_FLEE);
    }
    expect(deerSleeps(DAY_SHARE * SKY_MS * 0.5)).toBe(false);
    expect(deerSleeps(DAY_SHARE * SKY_MS + 1000)).toBe(true);
  });

  it('спящий подпускает ближе, но рукой его всё равно не взять', () => {
    /*
     * НОЧЬЮ ОХОТА ЛЕГЧЕ — И НИ НА ШАГ ЛЕГЧЕ, ЧЕМ ЭТО ДОПУСТИМО.
     *
     * Спящий зверь срывается вдвое ближе: это вторая половина ночи, та, ради
     * которой её стоит играть. Но тап достаёт на 2.1 м, и между ним и
     * четырьмя метрами обязан остаться запас — иначе спящего оленя брали бы
     * рукой, лук перестал бы быть нужен, а тап начал бы целиться.
     */
    expect(DEER_SLEEP_FLEE).toBeLessThan(DEER_FLEE);
    expect(DEER_SLEEP_FLEE).toBeGreaterThan(REACH * 1.8);
  });
});

describe('зверя рукой не достать — на этом стоит лук', () => {
  it('срывается он вчетверо дальше, чем дотягивается тап', () => {
    expect(DEER_FLEE).toBeGreaterThan(REACH * 3);
    expect(DEER_ALERT).toBeGreaterThan(DEER_FLEE);
  });

  it('и убегает быстрее, чем человек ходит', () => {
    expect(DEER_RUN).toBeGreaterThan(WALK_SPEED * 2);
  });

  it('а стрела достаёт куда угодно на поляне', () => {
    // Не короче поперечника поляны: с любого её края достаёт до любого
    // другого. Промах должен быть промахом, а не «не долетела»: это разные
    // ошибки, и вторую игрок читает как поломку.
    expect(ARROW_RANGE).toBeGreaterThanOrEqual(GLADE_R * 2);
  });
});

describe('стрела летит туда, куда смотрят', () => {
  const dir = (x: number, y: number, z: number) => {
    const l = Math.hypot(x, y, z);
    return { x: x / l, y: y / l, z: z / l };
  };

  it('по прямой и не дальше поляны', () => {
    const p = arrowLanding(0, 0, dir(0, 0, -1), EYE);
    expect(p.x).toBeCloseTo(0, 9);
    expect(Math.hypot(p.x, p.z)).toBeLessThanOrEqual(GLADE_R);
  });

  it('опущенный взгляд роняет её ближе, задранный — на предел', () => {
    const down = arrowLanding(0, 0, dir(0, -0.5, -1), EYE);
    const flat = arrowLanding(0, 0, dir(0, 0, -1), EYE);
    expect(Math.hypot(down.x, down.z)).toBeLessThan(Math.hypot(flat.x, flat.z));
    // Вверх — до предела дальности, а потом всё равно на поляну.
    const up = arrowLanding(0, 0, dir(0, 0.3, -1), EYE);
    expect(Math.hypot(up.x, up.z)).toBeLessThanOrEqual(GLADE_R);
  });

  it('строго под ноги — значит под ноги, а не в бесконечность', () => {
    const p = arrowLanding(3, 4, dir(0, -1, 0), EYE);
    expect(Number.isFinite(p.x) && Number.isFinite(p.z)).toBe(true);
    expect(Math.hypot(p.x - 3, p.z - 4)).toBeLessThan(0.001);
  });

  it('попадание меряется по телу зверя, а не по точке', () => {
    const deer = { x: 0, z: -10 };
    expect(arrowHits(0, 1.02, -10, deer)).toBe(true);
    // Мимо вбок и мимо по высоте — оба промах.
    expect(arrowHits(1.2, 1.02, -10, deer)).toBe(false);
    expect(arrowHits(0, 2.6, -10, deer)).toBe(false);
  });
});

describe('стрела не размножается и не пропадает', () => {
  it('выстрел, приземление и подбор двигают сумму ровно на одну', () => {
    let a = { quiver: ARROWS_START, arrows: [] as { x: number; z: number }[] };
    expect(arrowsAll(a)).toBe(ARROWS_START);
    // Ушла в полёт: ни в колчане, ни на земле — она летит.
    a = nockArrow(a) as typeof a;
    expect(arrowsAll(a)).toBe(ARROWS_START - 1);
    // Воткнулась: снова на поляне.
    a = landArrow(a, { x: 1, z: 2 }) as typeof a;
    expect(arrowsAll(a)).toBe(ARROWS_START);
    // Подобрали: сумма та же, только лежит она теперь в колчане.
    a = pickArrow(a, 0) as typeof a;
    expect(arrowsAll(a)).toBe(ARROWS_START);
    expect(a.quiver).toBe(ARROWS_START);
    expect(a.arrows.length).toBe(0);
  });

  it('пустой колчан стрелы не рождает, а чужой номер её не удваивает', () => {
    const empty = { quiver: 0, arrows: [] };
    expect(nockArrow(empty)).toBe(empty);
    const one = { quiver: 1, arrows: [{ x: 0, z: 0 }] };
    expect(pickArrow(one, 5)).toBe(one);
    expect(pickArrow(one, -1)).toBe(one);
  });

  it('любая цепочка действий сохраняет сумму', () => {
    // Стреляем, пока есть чем, потом подбираем — и так пятьдесят раз. Сумма
    // обязана стоять на месте на каждом шаге, а не только в конце.
    let a = { quiver: ARROWS_START, arrows: [] as { x: number; z: number }[] };
    for (let i = 0; i < 50; i++) {
      a = (a.quiver > 0 ? landArrow(nockArrow(a), { x: i % 5, z: i % 7 }) : pickArrow(a, 0)) as typeof a;
      expect(arrowsAll(a), `шаг ${i}`).toBe(ARROWS_START);
    }
  });

  it('новое утро собирает с поляны все до одной', () => {
    const s = freshPrologue(0);
    s.quiver = 1;
    s.arrows = [
      { x: 1, z: 1 },
      { x: 2, z: 2 },
    ];
    const next = revive(s, 0);
    expect(next.quiver).toBe(3);
    expect(next.arrows).toEqual([]);
  });

  it('новое утро начинается тихим: волки уходят, как после отбитой стаи', () => {
    // Иначе загрызенный открывал бы глаза в двух шагах от той же пары зубов —
    // это и есть замкнутая петля смертей, которой в режиме быть не должно.
    // Ищем ночь, в которую стая есть, и умираем в ней.
    let night = 0;
    for (let t = 0; t < 400 * SKY_MS; t += 5000) {
      if (packAt(t, 0) > 0 && isNight(t)) {
        night = t;
        break;
      }
    }
    expect(packAt(night, 0)).toBeGreaterThan(0);
    const next = revive(freshPrologue(0), night);
    expect(next.wolvesBeatenAt).toBe(night);
    expect(packAt(night, next.wolvesBeatenAt)).toBe(0);
    expect(packAt(night + WOLF_GAP_MS - 1, next.wolvesBeatenAt)).toBe(0);
  });
});

describe('туша: мясо забирается не разом и лежит не вечно', () => {
  it('кусок за куском, и всего их шесть', () => {
    const hunt: Hunt = { killedAt: 0, carcass: { x: 1, z: 1, taken: 0 } };
    expect(carcassLeft(hunt, 0)).toBe(DEER_MEAT);
    hunt.carcass!.taken = DEER_MEAT - 1;
    expect(carcassLeft(hunt, 0)).toBe(1);
    hunt.carcass!.taken = DEER_MEAT;
    expect(liveCarcass(hunt, 0)).toBe(null);
    expect(carcassLeft(hunt, 0)).toBe(0);
  });

  it('пролежав своё, пропадает вместе с недобранным мясом', () => {
    const hunt: Hunt = { killedAt: 0, carcass: { x: 1, z: 1, taken: 2 } };
    expect(liveCarcass(hunt, CARCASS_MS - 1)).not.toBe(null);
    expect(liveCarcass(hunt, CARCASS_MS)).toBe(null);
    expect(carcassLeftMs(hunt, 0)).toBe(CARCASS_MS);
    expect(carcassLeftMs(hunt, CARCASS_MS)).toBe(0);
  });

  it('туша пропадает раньше, чем приходит следующий зверь', () => {
    // Иначе на поляне разом лежала бы одна туша и ходил другой олень, и «один
    // зверь за раз» перестало бы быть правдой.
    expect(CARCASS_MS).toBeLessThan(DEER_GAP_MS);
  });
});

// ---------- Обещания, которые проверяются только чтением исходников ----------

const DIR = __dirname;

const sources = (): string[] => {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
    }
  };
  walk(DIR);
  return out;
};

const strip = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('случайности в предыстории нет ни одной', () => {
  it('`Math.random` не встречается во всей папке', () => {
    // Всё, что выглядит случайным, — хеш от числа: место оленя, разброс леса,
    // поворот стрелы в траве. Один вызов `Math.random` означал бы, что поляна у
    // двух игроков с одинаковой историей разная, — а тогда и записывать её
    // историю незачем.
    for (const f of sources()) {
      const name = f.slice(DIR.length + 1);
      expect(strip(readFileSync(f, 'utf8')), `${name}: бросает кости`).not.toContain('Math.random');
    }
  });

  it('разброс считает один хеш на всю папку, а не свой у каждого', () => {
    // Две «случайности» с разными хвостами дают два разных мира из одного числа.
    for (const f of sources()) {
      const name = f.slice(DIR.length + 1);
      if (name === 'glade.ts') continue;
      expect(strip(readFileSync(f, 'utf8')), `${name}: завёл свой хеш`).not.toContain('43758');
    }
  });
});
