/**
 * Волки.
 *
 * Проверяются здесь обещания, которые пальцем на телефоне не поймать, — все
 * они про то, **когда волк может убить**, а не про то, как он бегает:
 *
 *   1. есть ли стая и сколько в ней волков — чистая функция от времени и ни от
 *      чего больше;
 *   2. у горящего костра волков нет: ни стоять в круге, ни кусать через него;
 *   3. смерть от волков не наступает раньше, чем игрок мог их заметить, — и
 *      проверяется это не рассуждением, а переигрыванием **того самого
 *      правила**, по которому ходит стая в сцене (`wolfRushes`,
 *      `stalkAfterBite`), в худшем для игрока случае;
 *   4. ни одна из этих величин не движется от кадрового времени — чтением
 *      исходника.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WOLF_BITES, bite, causeOfDeath, newBody, type Body } from './body';
import type { Hearth } from './fire';
import { FIRE, GLADE_R, REACH, TREES, WALK_SPEED, WARM_R, WOLF_R, nearest } from './glade';
import { DAY_SHARE, SKY_MS, isNight } from './sky';
import {
  EARLIEST_BITE_MS,
  EARLIEST_DEATH_MS,
  HOWL_LEAD_MS,
  WOLF_BITE_R,
  WOLF_DAYS,
  WOLF_DAY_PACK,
  WOLF_EDGE,
  WOLF_FIRE_R,
  WOLF_GAP_MS,
  WOLF_NIGHTS,
  WOLF_NIGHT_PACK,
  WOLF_RUSH,
  WOLF_SPOTS,
  WOLF_STALK_MS,
  WOLF_STALK_R,
  WOLF_STOP,
  packAt,
  stalkAfterBite,
  wolfCanBite,
  wolfKeepsOut,
  wolfRushes,
  wolfSpot,
} from './wolves';

const H = 3_600_000;
const LIT: Hearth = { fuel: 8, at: 0 };

/** Середина дня и середина ночи круга `c` — две минуты, в которые спрашиваем стаю. */
const dayOf = (c: number): number => c * SKY_MS + (DAY_SHARE * SKY_MS) / 2;
const nightOf = (c: number): number => c * SKY_MS + DAY_SHARE * SKY_MS + ((1 - DAY_SHARE) * SKY_MS) / 2;

/**
 * Круги, на которых спрашивать: и от нуля, и от нынешней эпохи. Хеш от номера
 * круга обязан вести себя одинаково и на малых числах, и на семи миллионах —
 * столько кругов прошло от начала отсчёта до нашего времени.
 */
const EPOCHS = [0, 7_400_000];

describe('есть ли волки — чистая функция от времени', () => {
  it('ответ не зависит от того, сколько раз и в каком порядке спросили', () => {
    const at = Array.from({ length: 300 }, (_, i) => i * 53_000);
    const forth = at.map((t) => packAt(t, 0));
    const back = [...at].reverse().map((t) => packAt(t, 0)).reverse();
    expect(back).toEqual(forth);
  });

  it('днём — одиночка, ночью — пара, и ночью волков больше', () => {
    for (const e of EPOCHS) {
      let days = 0;
      let nights = 0;
      const n = 3000;
      for (let c = e; c < e + n; c++) {
        const d = packAt(dayOf(c), 0);
        const q = packAt(nightOf(c), 0);
        expect([0, WOLF_DAY_PACK], `день ${c}`).toContain(d);
        expect([0, WOLF_NIGHT_PACK], `ночь ${c}`).toContain(q);
        days += d;
        nights += q;
      }
      // Доли — те, что объявлены, с запасом на то, что это хеш, а не деление.
      expect(days / n / WOLF_DAY_PACK, `эпоха ${e}`).toBeGreaterThan(WOLF_DAYS - 0.07);
      expect(days / n / WOLF_DAY_PACK, `эпоха ${e}`).toBeLessThan(WOLF_DAYS + 0.07);
      expect(nights / n / WOLF_NIGHT_PACK, `эпоха ${e}`).toBeGreaterThan(WOLF_NIGHTS - 0.07);
      expect(nights / n / WOLF_NIGHT_PACK, `эпоха ${e}`).toBeLessThan(WOLF_NIGHTS + 0.07);
      expect(nights, `эпоха ${e}`).toBeGreaterThan(days * 2);
    }
  });

  it('одна ночь — одна стая на всём её протяжении', () => {
    // Стая, которая то есть, то нет посреди ночи, читалась бы сбоем, а не зверем.
    for (let c = 0; c < 200; c++) {
      const from = c * SKY_MS + DAY_SHARE * SKY_MS + 500;
      const to = (c + 1) * SKY_MS - 500;
      const first = packAt(from, 0);
      for (let t = from; t <= to; t += 7_000) expect(packAt(t, 0), `круг ${c}`).toBe(first);
    }
  });

  it('отбитая стая не возвращается три часа, а потом возвращается как ни в чём не бывало', () => {
    let night = 0;
    for (let c = 0; c < 400 && !night; c++) if (packAt(nightOf(c), 0) > 0) night = nightOf(c);
    expect(night).toBeGreaterThan(0);
    expect(packAt(night, night)).toBe(0);
    expect(packAt(night + WOLF_GAP_MS - 1, night)).toBe(0);
    const later = night + WOLF_GAP_MS + 1000;
    expect(packAt(later, night)).toBe(packAt(later, 0));
  });

  it('часы, переведённые назад, тишины не дарят', () => {
    // Запись из будущего — это у того, у кого сбилась дата. Продлить ему тишину
    // значило бы наградить за сбитые часы; поэтому такая запись не значит ничего.
    let night = 0;
    for (let c = 0; c < 400 && !night; c++) if (packAt(nightOf(c), 0) > 0) night = nightOf(c);
    expect(packAt(night, night + H)).toBe(packAt(night, 0));
  });

  it('стая выходит из леса, а не из-под руки, и двое не выходят из одной точки', () => {
    for (const p of WOLF_SPOTS) {
      const r = Math.hypot(p.x, p.z);
      expect(r, 'выход ближе круга кружения').toBeGreaterThan(WOLF_STALK_R);
      expect(r, 'выход за кромкой поляны').toBeLessThanOrEqual(WOLF_EDGE);
    }
    for (let c = 0; c < 500; c++) {
      const t = nightOf(c);
      const a = wolfSpot(t, 0);
      const b = wolfSpot(t, 1);
      expect(WOLF_SPOTS).toContain(a);
      expect(a, `круг ${c}`).not.toBe(b);
      // И подходят они с разных сторон, а не соседями по опушке.
      const angle = Math.abs(Math.atan2(a.z, a.x) - Math.atan2(b.z, b.x));
      expect(Math.min(angle, Math.PI * 2 - angle), `круг ${c}`).toBeGreaterThan(Math.PI / 2);
    }
  });
});

describe('у горящего костра волков нет', () => {
  it('в круге у горящего огня волк не стоит, а у погасшего — может', () => {
    for (let x = -GLADE_R; x <= GLADE_R; x += 0.5) {
      for (let z = -GLADE_R; z <= GLADE_R; z += 0.5) {
        const inside = Math.hypot(x - FIRE.x, z - FIRE.z) < WOLF_FIRE_R;
        expect(wolfKeepsOut(x, z, true), `${x},${z}`).toBe(inside);
        expect(wolfKeepsOut(x, z, false), `${x},${z}`).toBe(false);
      }
    }
  });

  it('человека у горящего огня не кусают ни с какой стороны', () => {
    // Правило сказано со стороны укуса отдельно — иначе волк, топчущийся на
    // границе круга, доставал бы человека, стоящего за ней вплотную.
    for (let px = -6; px <= 6; px += 0.75) {
      for (let pz = -6; pz <= 6; pz += 0.75) {
        if (!wolfKeepsOut(px, pz, true)) continue;
        for (let a = 0; a < Math.PI * 2; a += 0.4) {
          const wx = px + Math.cos(a) * WOLF_BITE_R * 0.8;
          const wz = pz + Math.sin(a) * WOLF_BITE_R * 0.8;
          expect(wolfCanBite(wx, wz, px, pz, true), `${px},${pz}`).toBe(false);
        }
      }
    }
    // А у погасшего — кусают: огонь защищает, пока горит, а не пока стоит очаг.
    expect(wolfCanBite(1, 0, 0.2, 0, false)).toBe(true);
  });

  it('все деревья — за кругом: за дровами ночью ходить страшно', () => {
    // Это не совпадение чисел, а сам замысел: иначе волки не значили бы ничего.
    for (const t of TREES) {
      expect(Math.hypot(t.x - FIRE.x, t.z - FIRE.z), `${t.x},${t.z}`).toBeGreaterThan(WOLF_FIRE_R);
    }
    // И у огня безопасно дальше, чем тепло: волка гонит свет, а не жар.
    expect(WOLF_FIRE_R).toBeGreaterThan(WARM_R);
  });
});

/**
 * Худший для игрока случай, переигранный по правилу сцены.
 *
 * Человек стоит вне круга, когда `outside(t)` говорит «да», и **каждый волк
 * стаи всегда у него в зубах**, как только правило разрешает бросок, — то есть
 * медлить стае не на что. Время кадровое: так же, как в сцене, отсчёт стаи
 * приходит числом, а часов тут никто не спрашивает.
 */
function worst(pack: number, outside: (t: number) => boolean, until: number): { bites: number[]; dead: number; from: number } {
  let stalkFrom = 0;
  // Вне круга у огня — как и в сцене: отметку «грелся» там снимает `scene.warmth`.
  let body: Body = { ...newBody(0), warm: false };
  const bites: number[] = [];
  let dead = -1;
  let from = -1;
  for (let t = 1; t <= until; t += 5) {
    if (!outside(t)) {
      stalkFrom = 0;
      continue;
    }
    if (!stalkFrom) {
      stalkFrom = t;
      from = t;
    }
    for (let i = 0; i < pack; i++) {
      // Спрашивается на каждом волке заново — ровно как в сцене.
      if (!wolfRushes(stalkFrom, t)) continue;
      stalkFrom = stalkAfterBite(t);
      body = bite(body, LIT, t);
      bites.push(t);
      if (dead < 0 && causeOfDeath(body, LIT, t) === 'wolf') dead = t;
    }
  }
  return { bites, dead, from };
}

describe('смерть от волков не раньше, чем их можно заметить', () => {
  it('первый укус — не раньше семи секунд, смерть — ровно на двадцать второй, для любой стаи', () => {
    /*
     * ГЛАВНЫЙ ТЕСТ ВОЛКОВ.
     *
     * Первым прогоном он упал, и по делу: пока у каждого волка был свой отсчёт,
     * ночная пара кусала разом на седьмой секунде и добивала на десятой. Срок
     * оставался правдой для одиночки и враньём для пары. Лечится это правилом
     * стаи — бросается один, отскакивают все, — и тест держит его для одиночки,
     * пары и тройки, которой в игре нет. Укусов до смерти теперь шесть, а не три:
     * семь секунд кружения и пять отскоков по три — двадцать две.
     */
    for (const pack of [1, 2, 3]) {
      const { bites, dead, from } = worst(pack, (t) => t >= 1000, 40_000);
      expect(EARLIEST_DEATH_MS).toBe(22_000);
      expect(bites.length, `стая ${pack}`).toBeGreaterThanOrEqual(WOLF_BITES);
      expect(bites[0] - from, `стая ${pack}`).toBeGreaterThanOrEqual(EARLIEST_BITE_MS);
      expect(dead - from, `стая ${pack}`).toBeGreaterThanOrEqual(EARLIEST_DEATH_MS);
      // Не просто «не раньше», а ровно: число в `wolves.ts` — это срок, а не
      // перестраховка, и игроку надо обещать его, а не что-то около.
      expect(dead - from, `стая ${pack}`).toBeLessThan(EARLIEST_DEATH_MS + 10);
      for (let i = 1; i < bites.length; i++) {
        expect(bites[i] - bites[i - 1], `стая ${pack}, укус ${i}`).toBeGreaterThanOrEqual(3000);
      }
    }
  });

  it('вернулся к огню — отсчёт начинается заново, а не продолжается', () => {
    // Окно «увидел и решил» игрок получает каждый раз, выходя из круга, а не
    // однажды за ночь. Вышел на четыре секунды, вернулся, вышел снова.
    const outside = (t: number): boolean => (t >= 1000 && t < 5000) || t >= 9000;
    const { bites } = worst(2, outside, 30_000);
    expect(bites[0]).toBeGreaterThanOrEqual(9000 + EARLIEST_BITE_MS);
  });

  it('у огня не загрызут никогда, сколько ни стой', () => {
    const { bites, dead } = worst(2, () => false, 60_000);
    expect(bites).toEqual([]);
    expect(dead).toBe(-1);
  });

  it('вой приходит раньше зубов', () => {
    expect(HOWL_LEAD_MS).toBeLessThan(EARLIEST_BITE_MS);
  });

  it('до огня можно дойти, пока стая кружит, — но не убежать, когда бросилась', () => {
    // С самого края поляны до круга у костра — два с половиной метра в секунду
    // на шесть с половиной метров. Это меньше, чем стая кружит: уйти вовремя
    // можно всегда.
    expect(((GLADE_R - WOLF_FIRE_R) / WALK_SPEED) * 1000).toBeLessThan(WOLF_STALK_MS);
    // А вот убежать от броска нельзя: волк быстрее, и в этом вся опасность.
    expect(WOLF_RUSH).toBeGreaterThan(WALK_SPEED);
  });

  it('волка, который достаёт зубами, достаёт и топор', () => {
    // Иначе топор был бы ответом, до которого не дотянуться: волк кусал бы с
    // расстояния, с которого его не ударить. Спрашивается у той же `nearest`,
    // что решает всякий тап, — второй досягаемости у волка нет.
    const px = 0;
    const pz = 10;
    const w = { x: px, z: pz + WOLF_BITE_R };
    const state = { felled: TREES.map(() => 0), arrows: [], carcass: null, tent: false, house: false, wolves: [w] };
    expect(nearest(px, pz, state, 0)?.kind).toBe('wolf');
    expect(WOLF_BITE_R).toBeLessThan(REACH + WOLF_R);
    // И встаёт бросившийся ближе, чем кусает: иначе он замирал бы в шаге от
    // человека и не кусал вовсе — или въезжал бы в камеру, если метр убрать.
    expect(WOLF_STOP).toBeLessThan(WOLF_BITE_R);
    expect(WOLF_STOP).toBeGreaterThan(WOLF_R * 1.5);
  });

  it('ночь — время волков: днём стая меньше, чем может загрызть', () => {
    // Днём приходит одиночка — это «видел, что они есть». Загрызть он может так
    // же, как пара, но реже приходит и один на опушке: день учит, ночь пугает.
    expect(WOLF_DAY_PACK).toBeLessThan(WOLF_NIGHT_PACK);
    expect(isNight(nightOf(3))).toBe(true);
    expect(isNight(dayOf(3))).toBe(false);
  });
});

// ---------- Обещания, которые проверяются только чтением исходников ----------

describe('ни стая, ни её выход не движутся от кадрового времени', () => {
  const src = readFileSync(join(__dirname, 'wolves.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('ни тика, ни таймера, ни кадра, ни часов, ни броска', () => {
    // Время кадров сюда приходит только числом — в отсчёт стаи. Читать часы
    // самому модулю незачем: всё, что переживает выход, он получает от сцены
    // как «сейчас» по `serverNow()`.
    for (const word of [
      'setInterval',
      'setTimeout',
      'requestAnimationFrame',
      'performance.now',
      'Date',
      'Math.random',
      'serverNow',
    ]) {
      expect(src, `волки начали тикать: ${word}`).not.toContain(word);
    }
  });
});
