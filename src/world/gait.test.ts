// Режим марша — дверь `world/gait` (ДР-2, docs/siege_v2.md, 25.1). Области правил — и каждая проверяется утверждением в
// самом тесте (правило 11):
// - скорость — множитель скорости полководца в `geo.travelTime`: дороги длиннее пола (`MARCH_MIN_SECONDS`), там, где
//   множитель вообще виден;
// - истощение налегке — только налегке и только за время вне стен (доля > 0 на отрезке больше суток);
// - лагерь с обозом — без подвоза: путь от дома > 0 и пустой амбар, где обычный лагерь тает сильнее;
// - энергия дороги — по пройденному пути: та же дорога стоит ту же энергию в любом режиме.
import { describe, expect, it, vi } from 'vitest';
import { GAIT_LIGHT_WASTE, GAIT_SPEED, GAITS, gaitHaltMs, gaitHaul, gaitSpeed, lightShare, readGait, roadLosses, siegeBlockOf } from './gait';
import { generalSpeed, warWalkMs, fieldWalkFloorMs, fieldReach } from './pvp';
import { CAMP_WASTE, CAMP_WASTE_DAYS, CAMP_WASTE_HUNGRY, SIEGE_PHASE } from './data/siegeroll';
import { wasteOf } from './siegeroll';
import { roadCost } from './energy';
import { travelTimeAt } from './geo';
import { FIGURE_BY_ID } from './data/figures';
import { UNIT_BY_ID } from './data/units';
import { intercept } from './pursuit';
import { MARCH_MIN_SECONDS } from './data/tuning';
import { gameDaysOfMs, gameSecondsOfMs, realMs, worldDays } from '@/game/pace';
import { CELL_COST_MIN } from './geography';

// Точки скорости выведены при ×1; ×3 ложится сверху и проверяется отдельно (`travelTimeAt` с k = 3).
vi.mock('@/world/data/tuning', async (actual) => ({ ...(await actual<object>()), TEST_TRAVEL_SPEED: 1 }));

const A = { x: 100, y: 100 };
const FAR = { x: 160, y: 130 };

describe('режим марша: скорость', () => {
  it('налегке ×1,5, обычный ×1, с обозом вдвое медленнее — у похода между замками и у удара из поля', () => {
    const normal = warWalkMs(A, FAR);
    // Точка внутри области: дорога много длиннее пола, множитель виден целиком.
    expect(normal).toBeGreaterThan(10 * realMs(MARCH_MIN_SECONDS));
    expect(warWalkMs(A, FAR, 'normal'), 'старый поход без поля — обычный').toBe(normal);
    expect(warWalkMs(A, FAR, 'train') / normal).toBeCloseTo(2, 2);
    expect(warWalkMs(A, FAR, 'light') / normal).toBeCloseTo(1 / 1.5, 2);
    expect(fieldWalkFloorMs(A, FAR, 'train') / fieldWalkFloorMs(A, FAR)).toBeCloseTo(2, 2);
    expect(generalSpeed('light')).toBeCloseTo(FIGURE_BY_ID.general.speed * 1.5, 9);
    expect(gaitSpeed(undefined)).toBe(1);
  });

  it('временный ×3 ложится сверху: срок делится после множителя режима', () => {
    const d = 80;
    for (const g of GAITS) {
      const one = travelTimeAt(d, 1, FIGURE_BY_ID.general.speed * GAIT_SPEED[g], 1);
      const three = travelTimeAt(d, 1, FIGURE_BY_ID.general.speed * GAIT_SPEED[g], 3);
      expect(one, `${g}: точка длиннее пола`).toBeGreaterThan(3 * MARCH_MIN_SECONDS);
      expect(three).toBeCloseTo(one / 3, 1);
    }
  });

  it('налегке догоняет уходящий набег сзади, обычный — нет: набег идёт скоростью воина (MAP-9)', () => {
    // Скорость воина — ровно скорость полководца: из структуры мира, на ней держится довод М3.
    expect(UNIT_BY_ID.warrior.speed).toBe(FIGURE_BY_ID.general.speed);
    // Темп — по мерной дороге, как у мира (`LocalWorld.paceOf`): срок одной клетки упирается в пол похода.
    const perMs = (speed: number): number => 1000 / realMs(travelTimeAt(1000, 1, speed, 1));
    const now = 1_000_000;
    // Набег уходит от наших ворот домой; полководец выходит следом с отставанием в две клетки.
    const raid = { from: { x: 0, y: 0 }, to: { x: 40, y: 0 }, departAt: now, arriveAt: now + realMs(travelTimeAt(40, 1, UNIT_BY_ID.warrior.speed, 1)) };
    const chaser = { x: -2, y: 0 };
    expect(intercept(chaser, perMs(generalSpeed('normal')), raid, now), 'обычный не догоняет').toBeNull();
    expect(intercept(chaser, perMs(generalSpeed('train')), raid, now), 'обоз тем более').toBeNull();
    const meet = intercept(chaser, perMs(generalSpeed('light')), raid, now);
    expect(meet, 'налегке догоняет').not.toBeNull();
    expect(meet!.time).toBeLessThan(raid.arriveAt);
  });

  it('дальность за время слепка — в самом быстром режиме: честный налегке не попадает под флаг', () => {
    const ms = worldDays(2);
    const reachOf = (speed: number): number => (gameSecondsOfMs(ms) * 1000) / travelTimeAt(1000, CELL_COST_MIN, speed, 1);
    // Налегке за тот же срок уходит в полтора раза дальше обычного: потолок дальности сервера — не ближе того.
    expect(reachOf(generalSpeed('light'))).toBeGreaterThan(reachOf(generalSpeed('normal')) * 1.4);
    expect(fieldReach(ms)).toBeGreaterThanOrEqual(reachOf(generalSpeed('light')));
  });
});

describe('режим марша: истощение налегке', () => {
  it('выведено из лагеря: голодный лагерь на ходу, доля выжившего — степень дней', () => {
    expect(GAIT_LIGHT_WASTE).toBeCloseTo((CAMP_WASTE * CAMP_WASTE_HUNGRY) / gameDaysOfMs(SIEGE_PHASE), 12);
    const day = worldDays(1);
    expect(lightShare('light', day)).toBeCloseTo(GAIT_LIGHT_WASTE, 12);
    expect(1 - lightShare('light', 10 * day)).toBeCloseTo((1 - GAIT_LIGHT_WASTE) ** 10, 12);
    expect(lightShare('normal', 10 * day), 'обычный не тает').toBe(0);
    expect(lightShare('train', 10 * day), 'обоз не тает').toBe(0);
    expect(lightShare(undefined, 10 * day), 'старый поход — обычный').toBe(0);
  });

  it('уход отрезка не убывает со временем — списать частями в любые минуты то же, что разом', () => {
    const base = { spearman: 137, archer: 41, legionary: 9, knight: 3 };
    const day = worldDays(1);
    let prev: Record<string, number> = {};
    for (let k = 1; k <= 60; k++) {
      const lost = roadLosses(base, 'light', (k * day) / 3, 'seg');
      // Точка внутри области: доля уже уносит людей.
      if (k === 60) expect(Object.values(lost).reduce((a, b) => a + (b ?? 0), 0)).toBeGreaterThan(10);
      for (const id of Object.keys(base)) expect(lost[id as keyof typeof base] ?? 0, `${id} на шаге ${k}`).toBeGreaterThanOrEqual(prev[id] ?? 0);
      prev = { ...lost } as Record<string, number>;
    }
    // В среднем — ровно своя доля: 10 000 бойцов одного вида за 20 дней.
    const many = roadLosses({ spearman: 10_000 }, 'light', 20 * day, 'mean').spearman ?? 0;
    expect(many / 10_000).toBeCloseTo(lightShare('light', 20 * day), 3);
    expect(roadLosses(base, 'train', 20 * day, 'seg'), 'с обозом — никого').toEqual({});
  });
});

describe('режим марша: лагерь с обозом — второй склад', () => {
  it('у обоза путь от дома и пустой амбар выпадают, мор — как у всех', () => {
    const far = CAMP_WASTE_DAYS;
    // Точка внутри области: обычный лагерь здесь тает сильнее базы — и от дали, и от голода.
    expect(wasteOf('calm', far, true)).toBeCloseTo(CAMP_WASTE * 2 * CAMP_WASTE_HUNGRY, 12);
    expect(wasteOf('calm', far, true, true)).toBeCloseTo(CAMP_WASTE, 12);
    expect(wasteOf('calm', 0, false, true)).toBeCloseTo(wasteOf('calm', 0, false), 12);
    expect(wasteOf('plague', far, true, true)).toBeCloseTo(2 * CAMP_WASTE, 12);
    expect(wasteOf('calm', far, true, true)).toBeLessThan(wasteOf('calm', far, false));
  });

  it('налегке лагерь не встаёт, обычный и обоз — встают', () => {
    expect(siegeBlockOf('light')).toContain('Налегке лагерь не ставят');
    expect(siegeBlockOf('normal')).toBeNull();
    expect(siegeBlockOf('train')).toBeNull();
    expect(siegeBlockOf(undefined)).toBeNull();
  });
});

describe('режим марша: энергия и смена', () => {
  it('та же дорога — та же энергия в любом режиме: темп отметки — множитель скорости', () => {
    const costs = GAITS.map((g) => roadCost(warWalkMs(A, FAR, g), gaitSpeed(g)));
    expect(costs[0]).toBeGreaterThan(5);
    for (const c of costs) expect(c).toBeCloseTo(costs[1], 1);
  });

  it('стоянка смены — самый короткий поход; мусор режима — обычный', () => {
    expect(gaitHaltMs()).toBe(Math.round(realMs(MARCH_MIN_SECONDS)));
    expect(readGait('light')).toBe('light');
    expect(readGait('train')).toBe('train');
    expect(readGait('fast')).toBe('normal');
    expect(readGait(undefined)).toBe('normal');
  });
});

describe('режим марша: вывоз добычи (ДР-5)', () => {
  it('выведено из доли обоза: налегке — только на себе, с обозом — второй обоз за вычетом хлеба лагеря', () => {
    const h = 1 / CAMP_WASTE_HUNGRY;
    expect(gaitHaul('light')).toBeCloseTo(1 - h, 12);
    expect(gaitHaul('normal')).toBe(1);
    expect(gaitHaul('train')).toBeCloseTo(1 + h * (1 - h), 12);
    // Ориентиры владельца при нынешних числах лагеря.
    expect(gaitHaul('light')).toBeCloseTo(0.5, 12);
    expect(gaitHaul('train')).toBeCloseTo(1.25, 12);
    // Порядок: чем больше обоза, тем больше вывоз; мусор и нет поля — обычный.
    expect(gaitHaul('light')).toBeLessThan(gaitHaul('normal'));
    expect(gaitHaul('normal')).toBeLessThan(gaitHaul('train'));
    expect(gaitHaul(undefined)).toBe(1);
    expect(gaitHaul('fast' as never)).toBe(1);
  });
});
