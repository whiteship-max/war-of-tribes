// Расселение живых игроков: где сервер ставит замок и что он обязан обещать.
//
// Проверяется здесь ровно то, чего нельзя увидеть глазами в отчёте: что правило
// **не может** посадить игрока в воду, на остров или под бок соседу, сколько бы
// игроков ни завелось. Числа и минуты похода — в `npm run settle:report`; здесь
// только обещания.
import { describe, expect, it } from 'vitest';
import { fitToSettle, placeCastle, settleRandom, type Spot } from './settle';
import { isDesertAt, landmasses, settleable, waterShare } from './land';
import { MAINLAND_MIN, SETTLE_GAP, SETTLE_REACH, SETTLE_WATER_MAX, WORLD_ORIGIN, WORLD_SIZE } from './data/tuning';
import { HOME_SIGHT } from './data/tuning';

const dist = (a: Spot, b: Spot): number => Math.hypot(a.x - b.x, a.y - b.y);

/** Мир из `n` игроков, посаженных подряд, — ровно так это делает сервер. */
function world(n: number, salt = 'w'): Spot[] {
  const spots: Spot[] = [];
  for (let i = 0; i < n; i++) spots.push(placeCastle(settleRandom(`${salt}:${i}`), spots));
  return spots;
}

describe('замок встаёт на проходимой земле', () => {
  it('первый игрок садится на материк, а не на скалу посреди океана', () => {
    const land = landmasses();
    const biggest = Math.max(...land.sizes);
    for (const salt of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
      const at = placeCastle(settleRandom(salt), []);
      expect([salt, settleable(at.x, at.y)]).toEqual([salt, true]);
      expect([salt, isDesertAt(at.x, at.y)]).toEqual([salt, false]);
      const id = land.at(at.x, at.y);
      expect(id).toBeGreaterThanOrEqual(0);
      // Не просто «большой кусок», а самый большой: на настоящей карте материк
      // 365 926 клеток, следующая земля — Британия, 5 695.
      expect([salt, land.sizeOf(id)]).toEqual([salt, biggest]);
    }
  });

  it('клетка внутри сетки: за краем мира замков не бывает', () => {
    for (const n of [1, 5, 20]) {
      for (const at of world(n, `bounds${n}`)) {
        expect(at.x).toBeGreaterThanOrEqual(WORLD_ORIGIN.x);
        expect(at.y).toBeGreaterThanOrEqual(WORLD_ORIGIN.y);
        expect(at.x).toBeLessThan(WORLD_ORIGIN.x + WORLD_SIZE);
        expect(at.y).toBeLessThan(WORLD_ORIGIN.y + WORLD_SIZE);
      }
    }
  });

  it('каждый следующий садится на ту же сушу, что и все до него', () => {
    const land = landmasses();
    for (const n of [2, 5, 20]) {
      const ids = new Set(world(n, `land${n}`).map((s) => land.at(s.x, s.y)));
      expect([n, ids.size]).toEqual([n, 1]);
      const [only] = [...ids];
      expect(land.sizeOf(only)).toBeGreaterThanOrEqual(MAINLAND_MIN);
    }
  });
});

describe('сосед досягаем, но не под боком', () => {
  it('никто не садится ближе ближней границы ни к одному замку', () => {
    for (const n of [2, 5, 20, 40]) {
      const spots = world(n, `gap${n}`);
      for (let i = 0; i < spots.length; i++) {
        for (let j = i + 1; j < spots.length; j++) {
          expect([n, i, j, dist(spots[i], spots[j]) >= SETTLE_GAP]).toEqual([n, i, j, true]);
        }
      }
    }
  });

  /**
   * Ближняя граница больше круга живого обзора деревни, и это не запас, а
   * условие: сосед, попавший в чужой круг при рождении, отдал бы даром всё,
   * ради чего в игре есть лазутчик и разведчик.
   */
  it('ближняя граница шире круга обзора деревни', () => {
    expect(SETTLE_GAP).toBeGreaterThan(HOME_SIGHT);
  });

  it('у каждого, кроме первого, есть сосед в пределах дальней границы', () => {
    for (const n of [2, 5, 20, 40]) {
      const spots = world(n, `reach${n}`);
      for (let i = 1; i < spots.length; i++) {
        const others = spots.filter((_, j) => j !== i);
        const near = Math.min(...others.map((o) => dist(spots[i], o)));
        expect([n, i, near <= SETTLE_REACH]).toEqual([n, i, true]);
      }
    }
  });

  /**
   * Проверяется **каждая** пара в пределах дальней границы, а не только своя
   * ближняя. Ближайший сосед меняется: пришедший позже становится чьим-то
   * ближним, и правило, смотревшее только на свою пару, оставляло бы старожила
   * с соседом за проливом. Ровно на этом тест и поймал первую редакцию.
   */
  it('до любого соседа в пределах досягаемости идут посуху, а не через залив', () => {
    for (const n of [5, 20]) {
      const spots = world(n, `water${n}`);
      for (let i = 0; i < spots.length; i++) {
        for (let j = i + 1; j < spots.length; j++) {
          if (dist(spots[i], spots[j]) > SETTLE_REACH) continue;
          expect([n, i, j, waterShare(spots[i], spots[j]) <= SETTLE_WATER_MAX]).toEqual([n, i, j, true]);
        }
      }
    }
  });
});

describe('ответ повторяем', () => {
  /**
   * Регистрация может прийти дважды: сеть моргнула, клиент повторил. Сервер
   * ищет место теми же бросками — иначе повтор двигал бы уже поставленный замок.
   */
  it('тот же игрок при том же реестре получает ту же клетку', () => {
    const taken = world(6, 'repeat');
    const first = placeCastle(settleRandom('игрок-7'), taken);
    const again = placeCastle(settleRandom('игрок-7'), taken);
    expect(again).toEqual(first);
  });

  it('порядок в реестре на ответ не влияет: мерки в нём — расстояния', () => {
    const taken = world(6, 'order');
    const straight = placeCastle(settleRandom('игрок-8'), taken);
    const reversed = placeCastle(settleRandom('игрок-8'), [...taken].reverse());
    expect(reversed).toEqual(straight);
  });

  it('разные игроки при том же реестре встают по-разному', () => {
    const taken = world(4, 'differ');
    const a = placeCastle(settleRandom('игрок-A'), taken);
    const b = placeCastle(settleRandom('игрок-B'), taken);
    expect(a).not.toEqual(b);
  });
});

describe('пригодность клетки — одна функция на все ступени', () => {
  it('вода, русло, хребет и пустыня не годятся', () => {
    const land = landmasses();
    let water = 0;
    let desert = 0;
    let ok = 0;
    for (let y = WORLD_ORIGIN.y; y < WORLD_ORIGIN.y + WORLD_SIZE; y += 37) {
      for (let x = WORLD_ORIGIN.x; x < WORLD_ORIGIN.x + WORLD_SIZE; x += 37) {
        const fit = fitToSettle({ x, y });
        if (fit) {
          ok++;
          expect([x, y, settleable(x, y)]).toEqual([x, y, true]);
          expect([x, y, isDesertAt(x, y)]).toEqual([x, y, false]);
          expect(land.sizeOf(land.at(x, y))).toBeGreaterThanOrEqual(MAINLAND_MIN);
        }
        if (!settleable(x, y)) water++;
        if (isDesertAt(x, y)) desert++;
      }
    }
    // Проба должна быть содержательной: если бы всё оказалось непригодным, тест
    // проходил бы, ничего не проверив.
    expect(ok).toBeGreaterThan(50);
    expect(water).toBeGreaterThan(50);
    expect(desert).toBeGreaterThan(0);
  });
});
