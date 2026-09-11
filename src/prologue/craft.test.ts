/**
 * Ремесло: дом, одежда, стрелы.
 *
 * Здесь собраны обещания, ради которых ремесло заводилось, — все про числа, и
 * пальцем их не поймать:
 *
 *   1. дом растёт ровно на потраченное дерево и не строится из воздуха;
 *   2. сорок два бревна — три-четыре захода, и это расчёт из чисел поляны;
 *   3. одежда уменьшает холод ровно на `COAT_CHILL` — в любую погоду и ни на
 *      волос больше; крыша снимает небо, но не греет, и одежда не греет тоже;
 *   4. в достроенный дом волк не входит и через порог не кусает;
 *   5. кнопка ремесла, которая не сработает, гаснет и говорит причину;
 *   6. дом и одежда переживают выход и смерть, шкура в руках — нет;
 *   7. ни одна величина ремесла не движется от кадрового времени.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ROAST_COST, offer, reach } from './act';
import {
  CHILL_MS,
  COAT_CHILL,
  WARM_MS,
  camp,
  causeOfDeath,
  coldAt,
  coldDeadAt,
  coldLeftMs,
  newBody,
  setRoof,
  wearCoat,
  type Body,
} from './body';
import {
  ARROWS_PER_LOG,
  COAT_HIDES,
  HOUSE_LOGS,
  HOUSE_PER_STAGE,
  HOUSE_STAGES,
  QUIVER_MAX,
  buildTake,
  carveRoom,
  houseDone,
  houseStage,
} from './craft';
import { HEARTH_CAP, LOG_MS, type Hearth } from './fire';
import {
  AXE_STUMP,
  FIRE,
  HOUSE,
  HOUSE_SHELTER_R,
  REACH,
  START,
  TENT,
  TREES,
  TREE_LOGS,
  byHouse,
  nearest,
  type Spot,
} from './glade';
import { ARROWS_START, DEER_MEAT, arrowsAll, carveArrows, type Hunt } from './hunt';
import { freshPrologue, loadPrologue, revive, savePrologue, type PrologueSave } from './save';
import { BURN_MEAN, RING_MS, chilledMs } from './sky';
import { WOLF_BITE_R, WOLF_FIRE_R, WOLF_SPOTS, wolfCanBite, wolfKeepsOut } from './wolves';

const H = 3_600_000;

/*
 * Отрезки кольца с заведомо одной погодой и одним небом — те же, что в
 * `body.test.ts`, и проверены они там же (`sky.test.ts`). Длина у всех одна.
 */
const CLEAR_DAY = { at: 0, until: 91_200 };
const CLEAR_NIGHT = { at: 148_800, until: 240_000 };
const SNOW_DAY = { at: 1_200_000, until: 1_291_200 };
const RAIN_DAY = { at: 240_000, until: 331_200 };

const OUT: Hearth = { fuel: 0, at: 0 };

/** Человек вдали от огня. */
const away = (at: number, over: Partial<Body> = {}): Body => ({ ...newBody(at), warm: false, ...over });

describe('дом растёт ровно на потраченное дерево', () => {
  it('брёвна переходят из рук в стену, и сумма не меняется', () => {
    for (let house = 0; house <= HOUSE_LOGS; house++) {
      for (let carried = 0; carried <= 30; carried++) {
        const take = buildTake(house, carried);
        expect(take, `${house}/${carried}`).toBeGreaterThanOrEqual(0);
        expect(take, `${house}/${carried}`).toBeLessThanOrEqual(carried);
        expect(house + take, `${house}/${carried}`).toBeLessThanOrEqual(HOUSE_LOGS);
        expect(Number.isInteger(take)).toBe(true);
        // Всё, что влезает, — одним тапом: либо руки пустые, либо дом полный.
        expect(carried - take === 0 || house + take === HOUSE_LOGS, `${house}/${carried}`).toBe(true);
      }
    }
  });

  it('из воздуха не строится ни бревна', () => {
    for (let house = 0; house <= HOUSE_LOGS; house++) {
      expect(buildTake(house, 0)).toBe(0);
      expect(buildTake(house, -5)).toBe(0);
    }
    expect(buildTake(HOUSE_LOGS, 10)).toBe(0);
  });

  it('любая цепочка заходов доводит дом ровно до сорока двух, и ни бревном больше', () => {
    let house = 0;
    let spent = 0;
    for (const carried of [5, 12, 3, 20, 9, 14, 7, 11]) {
      const take = buildTake(house, carried);
      house += take;
      spent += take;
      expect(house, `после ${carried}`).toBe(spent);
    }
    expect(house).toBe(HOUSE_LOGS);
    expect(houseDone(house)).toBe(true);
  });

  it('ступени идут вместе с брёвнами: от разметки до крыши', () => {
    expect(HOUSE_PER_STAGE * HOUSE_STAGES).toBe(HOUSE_LOGS);
    expect(Number.isInteger(HOUSE_PER_STAGE)).toBe(true);
    expect(houseStage(0)).toBe(0);
    expect(houseStage(HOUSE_PER_STAGE - 1)).toBe(0);
    expect(houseStage(HOUSE_PER_STAGE)).toBe(1);
    expect(houseStage(HOUSE_LOGS - 1)).toBe(HOUSE_STAGES - 1);
    expect(houseStage(HOUSE_LOGS)).toBe(HOUSE_STAGES);
    for (let l = 1; l <= HOUSE_LOGS; l++) expect(houseStage(l)).toBeGreaterThanOrEqual(houseStage(l - 1));
    // Укрытие даёт только достроенный: крыша без стен не крыша.
    expect(houseDone(HOUSE_LOGS - 1)).toBe(false);
  });
});

describe('сорок два бревна — три-четыре захода', () => {
  it('расчёт из чисел поляны, а не на глаз', () => {
    // За заход при отросшем лесе валят всю поляну. Из этих полен уходит то, что
    // и так надо: очаг на сутки отсутствия с поправкой на дождь и жарка оленя.
    const perVisit = TREES.length * TREE_LOGS;
    const hearthDay = Math.ceil((24 * H * BURN_MEAN) / LOG_MS);
    const roast = DEER_MEAT * ROAST_COST;
    const toHouse = perVisit - hearthDay - roast;
    const visits = HOUSE_LOGS / toHouse;
    expect(visits, `${perVisit} − ${hearthDay} − ${roast} = ${toHouse} за заход`).toBeGreaterThanOrEqual(3);
    expect(visits).toBeLessThanOrEqual(4);
    // И в один заход дом не встаёт ни при какой щедрости.
    expect(perVisit).toBeLessThan(HOUSE_LOGS);
  });
});

describe('одежда: холод давит ровно на COAT_CHILL слабее', () => {
  it('в любую погоду одетый набирает ровно COAT_CHILL от раздетого', () => {
    for (const [name, s] of Object.entries({ день: CLEAR_DAY, ночь: CLEAR_NIGHT, снег: SNOW_DAY, дождь: RAIN_DAY })) {
      const naked = coldAt(away(s.at), OUT, s.until);
      const dressed = coldAt(away(s.at, { coat: true }), OUT, s.until);
      expect(naked, name).toBeGreaterThan(0);
      expect(dressed / naked, name).toBeCloseTo(COAT_CHILL, 12);
    }
  });

  it('срок без огня одетому длиннее ровно настолько же — по холодовым часам', () => {
    for (let t0 = 0; t0 < RING_MS; t0 += 61_000) {
      const h: Hearth = { fuel: 0, at: t0 };
      expect(chilledMs(t0, coldDeadAt(away(t0), h))).toBeCloseTo(CHILL_MS, 3);
      expect(chilledMs(t0, coldDeadAt(away(t0, { coat: true }), h)) * COAT_CHILL).toBeCloseTo(CHILL_MS, 3);
    }
  });

  it('без огня: в доме — восемь часов, в доме одетым — тринадцать с третью, одетым под небом — девять с лишним', () => {
    let sum = 0;
    let n = 0;
    for (let t0 = 0; t0 < RING_MS; t0 += 97_000) {
      const h: Hearth = { fuel: 0, at: t0 };
      expect(coldDeadAt(away(t0, { roof: true }), h) - t0).toBeCloseTo(CHILL_MS, 3);
      expect(coldDeadAt(away(t0, { roof: true, coat: true }), h) - t0).toBeCloseTo(CHILL_MS / COAT_CHILL, 3);
      const sky = coldDeadAt(away(t0, { coat: true }), h) - t0;
      expect(sky / H).toBeGreaterThan(8.5);
      sum += sky;
      n++;
    }
    expect(sum / n / H).toBeGreaterThan(9);
    expect(sum / n / H).toBeLessThan(10);
  });

  it('крыша снимает небо: ночь и снег под ней студят как погожий день', () => {
    const gain = (s: { at: number; until: number }): number => coldAt(away(s.at, { roof: true }), OUT, s.until);
    const day = gain(CLEAR_DAY);
    expect(day).toBeCloseTo((CLEAR_DAY.until - CLEAR_DAY.at) / CHILL_MS, 12);
    expect(gain(CLEAR_NIGHT)).toBeCloseTo(day, 12);
    expect(gain(SNOW_DAY)).toBeCloseTo(day, 12);
  });

  it('ни одежда, ни крыша не греют: отогрев у огня один', () => {
    const thaw = (over: Partial<Body>): number =>
      1 - coldAt({ ...newBody(0), cold: 1 - 1e-9, ...over }, { fuel: HEARTH_CAP, at: 0 }, WARM_MS / 2);
    const base = thaw({});
    expect(thaw({ coat: true })).toBeCloseTo(base, 12);
    expect(thaw({ roof: true })).toBeCloseTo(base, 12);
    expect(thaw({ coat: true, roof: true })).toBeCloseTo(base, 12);
  });

  it('сшитая одежда не переписывает прошлое: до минуты шитья стыл раздетым', () => {
    const mid = CLEAR_DAY.at + 40_000;
    const dressed = wearCoat(away(CLEAR_DAY.at), OUT, mid);
    expect(dressed).toMatchObject({ at: mid, coat: true });
    expect(dressed.cold).toBeCloseTo(40_000 / CHILL_MS, 12);
    const rest = coldAt(dressed, OUT, CLEAR_DAY.until) - dressed.cold;
    expect(rest).toBeCloseTo(((CLEAR_DAY.until - mid) * COAT_CHILL) / CHILL_MS, 12);
  });

  it('крыша закрывает отрезок так же, как круг у огня', () => {
    const inside = setRoof(away(0), OUT, 60_000, true);
    expect(inside).toMatchObject({ roof: true, at: 60_000 });
    expect(setRoof(inside, OUT, 90_000, true)).toBe(inside);
  });

  it('полоса обещает то, что случится, и в одежде, и под крышей', () => {
    for (const over of [{ coat: true }, { roof: true }, { coat: true, roof: true }]) {
      for (let t0 = 0; t0 < RING_MS; t0 += 131_000) {
        const h: Hearth = { fuel: 2, at: t0 };
        const b: Body = { ...newBody(t0), ...over };
        const dead = coldDeadAt(b, h);
        expect(causeOfDeath(b, h, dead - 60_000), JSON.stringify(over)).toBe(null);
        expect(causeOfDeath(b, h, dead + 60_000), JSON.stringify(over)).toBe('cold');
        expect(coldLeftMs(b, h, t0) + t0).toBeCloseTo(dead, 6);
      }
    }
  });

  it('стоянка в достроенном доме — ночлег под крышей', () => {
    expect(camp(away(0), OUT, 0).roof).toBe(false);
    expect(camp(away(0), OUT, 0, true).roof).toBe(true);
  });
});

describe('в достроенный дом волк не входит', () => {
  it('круг дома держит волка при любом огне, а недостроенный — нет', () => {
    for (let x = -9; x <= 1; x += 0.5) {
      for (let z = -1; z <= 8; z += 0.5) {
        const inside = byHouse(x, z);
        expect(wolfKeepsOut(x, z, false, true), `${x},${z}`).toBe(inside);
        expect(wolfKeepsOut(x, z, false, false), `${x},${z}`).toBe(false);
        if (inside) expect(wolfKeepsOut(x, z, true, true), `${x},${z}`).toBe(true);
      }
    }
  });

  it('человека в доме не кусают ни с какой стороны, даже у погасшего огня', () => {
    let checked = 0;
    for (let px = HOUSE.x - HOUSE_SHELTER_R; px <= HOUSE.x + HOUSE_SHELTER_R; px += 0.5) {
      for (let pz = HOUSE.z - HOUSE_SHELTER_R; pz <= HOUSE.z + HOUSE_SHELTER_R; pz += 0.5) {
        if (!byHouse(px, pz)) continue;
        for (let a = 0; a < Math.PI * 2; a += 0.4) {
          const wx = px + Math.cos(a) * WOLF_BITE_R * 0.8;
          const wz = pz + Math.sin(a) * WOLF_BITE_R * 0.8;
          expect(wolfCanBite(wx, wz, px, pz, false, true), `${px},${pz}`).toBe(false);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(100);
    // Вдали от дома и огня кусают как прежде: дом укрывает место, а не человека.
    expect(wolfCanBite(6.8, -6, 6, -6, false, true)).toBe(true);
  });

  it('стая выходит из леса не в доме, а сам дом стоит там, где у огня и так спокойно', () => {
    for (const p of WOLF_SPOTS) expect(byHouse(p.x, p.z), `${p.x},${p.z}`).toBe(false);
    expect(Math.hypot(HOUSE.x - FIRE.x, HOUSE.z - FIRE.z)).toBeLessThan(WOLF_FIRE_R);
  });
});

describe('дом на поляне', () => {
  it('с места входа до стройки не дотянуться, а дверь смотрит на огонь', () => {
    expect(Math.hypot(START.x - HOUSE.x, START.z - HOUSE.z) - HOUSE.r).toBeGreaterThan(REACH);
    expect(HOUSE.rot).toBeCloseTo(Math.atan2(FIRE.x - HOUSE.x, FIRE.z - HOUSE.z), 12);
  });

  it('под крышей — ровно там, откуда кладут бревно', () => {
    expect(HOUSE_SHELTER_R).toBe(HOUSE.r + REACH);
    // Идём от дома прочь от огня: там ни костра, ни палатки в досягаемости, а
    // деревья повалены — проверяется граница дома, а не соседство.
    const dx = HOUSE.x - FIRE.x;
    const dz = HOUSE.z - FIRE.z;
    const d = Math.hypot(dx, dz);
    const at = (k: number): { x: number; z: number } => ({ x: HOUSE.x + (dx / d) * k, z: HOUSE.z + (dz / d) * k });
    const glade = { felled: TREES.map(() => 1), arrows: [], carcass: null, tent: false, house: true, wolves: [] };
    const inner = at(HOUSE_SHELTER_R - 0.05);
    expect(byHouse(inner.x, inner.z)).toBe(true);
    expect(nearest(inner.x, inner.z, glade, 1)?.kind).toBe('house');
    const outer = at(HOUSE_SHELTER_R + 0.05);
    expect(byHouse(outer.x, outer.z)).toBe(false);
    expect(nearest(outer.x, outer.z, glade, 1)).toBe(null);
  });
});

describe('кнопка ремесла гаснет и говорит причину', () => {
  const S = (over: Partial<PrologueSave> = {}): PrologueSave => ({ ...freshPrologue(0), ...over });
  const dressed = (s: PrologueSave): PrologueSave => ({ ...s, body: { ...s.body, coat: true } });
  const AT_HOUSE: Spot = { kind: 'house', x: HOUSE.x, z: HOUSE.z, index: -1 };
  const AT_TENT: Spot = { kind: 'tent', x: TENT.x, z: TENT.z, index: -1 };
  const AT_AXE: Spot = { kind: 'axe', x: AXE_STUMP.x, z: AXE_STUMP.z, index: -1 };
  const AT_CARCASS: Spot = { kind: 'carcass', x: 3, z: 3, index: -1 };
  const hunt = (taken: number, skinned = false): Hunt => ({ killedAt: 0, carcass: { x: 3, z: 3, taken, skinned } });

  it('дом: без топора и без дров — своя причина, а достроенный открывает род', () => {
    expect(offer(S({ logs: 5 }), AT_HOUSE, 0)).toMatchObject({ deed: 'build', can: false, why: 'Нужен топор' });
    const bare = offer(S({ axe: true }), AT_HOUSE, 0);
    expect(bare).toMatchObject({ deed: 'build', can: false });
    expect(bare.why.length).toBeGreaterThan(0);
    expect(offer(S({ axe: true, logs: 3, house: 14 }), AT_HOUSE, 0)).toMatchObject({
      deed: 'build',
      can: true,
      label: `Ставить дом (14/${HOUSE_LOGS})`,
    });
    // Строить больше нечего, но у дома есть дело: в нём записан род (`kin.ts`).
    // Бревно в достроенный дом по-прежнему не ложится — рук тап не трогает.
    expect(offer(S({ axe: true, logs: 3, house: HOUSE_LOGS }), AT_HOUSE, 0)).toMatchObject({
      deed: 'kin',
      can: true,
      label: 'Родословная',
    });
  });

  it('шкура снимается с разделанной туши и только пока нужна', () => {
    expect(offer(S({ hunt: hunt(2) }), AT_CARCASS, 0).deed).toBe('butcher');
    expect(offer(S({ hunt: hunt(DEER_MEAT) }), AT_CARCASS, 0)).toMatchObject({ deed: 'skin', can: true });
    expect(offer(dressed(S({ hunt: hunt(DEER_MEAT) })), AT_CARCASS, 0)).toMatchObject({ can: false, why: 'Одежда уже сшита' });
    expect(offer(S({ hunt: hunt(DEER_MEAT), hides: COAT_HIDES }), AT_CARCASS, 0).can).toBe(false);
    expect(offer(S({ hunt: hunt(DEER_MEAT, true) }), AT_CARCASS, 0)).toMatchObject({ can: false, why: 'Туша пуста' });
  });

  it('одежду шьют у палатки из шкуры, и один раз', () => {
    expect(offer(S({ kit: true, hides: COAT_HIDES }), AT_TENT, 0)).toMatchObject({ deed: 'sew', can: true });
    expect(offer(S({ kit: true }), AT_TENT, 0)).toMatchObject({ deed: 'sew', can: false, why: 'Нужна шкура оленя' });
    expect(offer(dressed(S({ kit: true, hides: COAT_HIDES })), AT_TENT, 0)).toMatchObject({ can: false, why: 'Одежда уже сшита' });
    // Пожитки у палатки по-прежнему первое её дело.
    expect(offer(S({ hides: COAT_HIDES }), AT_TENT, 0).deed).toBe('take-kit');
  });

  it('стрелы строгают у колоды из полена, пока влезают', () => {
    const ready = S({ axe: true, kit: true, logs: 1, quiver: ARROWS_START });
    expect(offer(ready, AT_AXE, 0)).toMatchObject({ deed: 'carve', can: true, label: `Строгать стрелы (+${ARROWS_PER_LOG})` });
    expect(offer({ ...ready, logs: 0 }, AT_AXE, 0)).toMatchObject({ deed: 'carve', can: false, why: 'Нужно полено' });
    expect(offer({ ...ready, quiver: QUIVER_MAX }, AT_AXE, 0)).toMatchObject({ deed: 'carve', can: false, why: 'Колчан полон' });
    expect(offer({ ...ready, kit: false }, AT_AXE, 0).can).toBe(false);
    // Топор на колоде — по-прежнему первое её дело.
    expect(offer(S({ logs: 1 }), AT_AXE, 0).deed).toBe('take-axe');
  });

  it('палатка — цель тапа, только когда у неё есть дело, а у дома дело есть всегда', () => {
    expect(reach(S(), 0).tent).toBe(true);
    expect(reach(S({ kit: true }), 0).tent).toBe(false);
    expect(reach(S({ kit: true, hides: COAT_HIDES }), 0).tent).toBe(true);
    expect(reach(dressed(S({ kit: true, hides: COAT_HIDES })), 0).tent).toBe(false);
    // Строится — стройка; достроен — родословная. Пустым тапом дом не бывает.
    expect(reach(S({ house: HOUSE_LOGS - 1 }), 0).house).toBe(true);
    expect(reach(S({ house: HOUSE_LOGS }), 0).house).toBe(true);
  });
});

describe('стрелы', () => {
  it('полено даёт две стрелы, и прибавляется ровно столько', () => {
    const before = { quiver: ARROWS_START, arrows: [{ x: 1, z: 1 }] };
    const after = carveArrows(before, ARROWS_PER_LOG);
    expect(arrowsAll(after) - arrowsAll(before)).toBe(ARROWS_PER_LOG);
    expect(after.arrows).toBe(before.arrows);
    expect(carveArrows(before, 0)).toBe(before);
    expect(carveArrows(before, -3)).toBe(before);
  });

  it('колчан не бездонный, и потолок выше начального запаса', () => {
    expect(carveRoom(QUIVER_MAX - ARROWS_PER_LOG)).toBe(true);
    expect(carveRoom(QUIVER_MAX - ARROWS_PER_LOG + 1)).toBe(false);
    expect(QUIVER_MAX).toBeGreaterThan(ARROWS_START);
    expect(COAT_HIDES).toBe(1);
  });
});

describe('дом и одежда переживают выход и смерть, шкура в руках — нет', () => {
  const KEY = 'tribe.prologue.v1';
  const store = new Map<string, string>();
  const host = globalThis as unknown as { localStorage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> };

  beforeEach(() => {
    store.clear();
    host.localStorage = {
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => void store.set(k, String(v)),
      removeItem: (k) => void store.delete(k),
    };
  });
  afterEach(() => {
    delete host.localStorage;
  });

  it('дом, шкура и одежда ложатся на диск и читаются обратно', () => {
    const s = freshPrologue(0);
    s.house = 20;
    s.hides = 1;
    s.body = { ...s.body, coat: true };
    savePrologue(s, 1000);
    const back = loadPrologue(2000);
    expect(back).toMatchObject({ house: 20, hides: 1 });
    expect(back.body).toMatchObject({ coat: true, roof: false });
  });

  it('достроенный дом — ночлег: с диска человек читается под крышей', () => {
    const s = freshPrologue(0);
    s.house = HOUSE_LOGS;
    savePrologue(s, 1000);
    expect(JSON.parse(store.get(KEY) ?? '{}').body.roof).toBe(true);
    expect(loadPrologue(2000).body.roof).toBe(true);
  });

  it('старая запись читается с умолчаниями, а лишнего дом не берёт', () => {
    store.set(KEY, JSON.stringify({ v: 1, hunt: { killedAt: 5, carcass: { x: 1, z: 1, taken: 6 } }, house: 999, hides: 2.7 }));
    const s = loadPrologue(10);
    expect(s).toMatchObject({ house: HOUSE_LOGS, hides: 2 });
    expect(s.body.coat).toBe(false);
    expect(s.hunt.carcass?.skinned).toBe(false);
  });

  it('смерть забирает шкуру в руках, а дом и одежду оставляет', () => {
    const s = freshPrologue(0);
    s.house = 30;
    s.hides = 1;
    s.body = { ...s.body, coat: true };
    const next = revive(s, 5000);
    expect(next).toMatchObject({ house: 30, hides: 0 });
    expect(next.body.coat).toBe(true);
  });
});

describe('ремесло не движется от кадрового времени', () => {
  it('ни тика, ни таймера, ни кадра, ни часов, ни броска', () => {
    const src = readFileSync(join(__dirname, 'craft.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    for (const word of ['setInterval', 'setTimeout', 'requestAnimationFrame', 'performance.now', 'Date', 'Math.random', 'serverNow']) {
      expect(src, `ремесло начало тикать: ${word}`).not.toContain(word);
    }
  });
});
