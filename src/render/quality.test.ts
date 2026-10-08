// Уровень по устройству и сторож плавности посёлка (docs/graphics_world.md, 9.2).
//
// Строки видеокарт — те, что браузеры отдают через WEBGL_debug_renderer_info: Android —
// настоящее имя, iOS — «Apple GPU», Chrome на Windows — строка ANGLE.
import { describe, expect, it } from 'vitest';
import { QUALITIES, QUALITY, VILLAGE_STEADY, autoQuality, lowerQuality, tgClassOf, type DeviceCaps, type Quality } from './quality';
import { Steady } from './steady';
import { pace } from './loop';

const phone = (gpu: string | null, memory: number | null = 8, cores: number | null = 8): DeviceCaps => ({ coarse: true, memory, cores, gpu });
const desk = (gpu: string | null): DeviceCaps => ({ coarse: false, memory: 8, cores: 8, gpu });

describe('уровень по устройству', () => {
  it('телефон никогда не получает высокий сам — даже с сильной видеокартой', () => {
    for (const gpu of ['Adreno (TM) 740', 'ANGLE (Qualcomm, Adreno (TM) 730, OpenGL ES 3.2)', 'Mali-G715-Immortalis MC11', 'Samsung Xclipse 920', 'Apple GPU']) {
      expect(autoQuality(phone(gpu)), gpu).toBe('medium');
    }
  });

  it('телефон среднего класса — средний, слабый — низкий', () => {
    expect(autoQuality(phone('Adreno (TM) 618'))).toBe('medium');
    expect(autoQuality(phone('Mali-G57 MC2'))).toBe('medium');
    expect(autoQuality(phone('Mali-G72 MP3'))).toBe('medium');
    expect(autoQuality(phone('Mali-G52 MC2'))).toBe('low');
    expect(autoQuality(phone('PowerVR Rogue GE8320'))).toBe('low');
    expect(autoQuality(phone('Adreno (TM) 506'))).toBe('low');
  });

  it('Adreno ниже цели среднего (618): 605–613 дешёвых телефонов — низкий, 618 и выше — средний', () => {
    for (const gpu of ['Adreno (TM) 610', 'Adreno (TM) 612', 'ANGLE (Qualcomm, Adreno (TM) 613, OpenGL ES 3.2)', 'Adreno (TM) 605', 'Adreno (TM) 512']) {
      expect(autoQuality(phone(gpu)), gpu).toBe('low');
    }
    for (const gpu of ['Adreno (TM) 618', 'Adreno (TM) 619', 'Adreno (TM) 620', 'Adreno (TM) 642L', 'Adreno (TM) 660']) {
      expect(autoQuality(phone(gpu)), gpu).toBe('medium');
    }
  });

  it('класс Телеграма: LOW — низкий с первого входа, даже когда видеокарта и память молчат; AVERAGE и HIGH уровня не поднимают', () => {
    const ua = (cls: string): string =>
      `Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36 Telegram-Android/11.7.3 (Samsung SM-A750F; Android 10; SDK 29; ${cls})`;
    expect(tgClassOf(ua('LOW'))).toBe('LOW');
    expect(tgClassOf(ua('AVERAGE'))).toBe('AVERAGE');
    expect(tgClassOf(ua('HIGH'))).toBe('HIGH');
    expect(tgClassOf('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148')).toBeNull();
    expect(tgClassOf('Mozilla/5.0 (Linux; Android 10; K) Chrome/129.0.0.0 Mobile Safari/537.36')).toBeNull();
    expect(tgClassOf(null)).toBeNull();
    expect(autoQuality({ coarse: true, memory: null, cores: null, gpu: null, tg: 'LOW' })).toBe('low');
    expect(autoQuality({ ...phone('Adreno (TM) 618'), tg: 'LOW' })).toBe('low');
    expect(autoQuality({ ...phone('Adreno (TM) 618'), tg: 'AVERAGE' })).toBe('medium');
    expect(autoQuality({ ...phone('Adreno (TM) 740'), tg: 'HIGH' })).toBe('medium');
    expect(autoQuality({ ...phone('Mali-G52 MC2'), tg: 'HIGH' })).toBe('low');
  });

  it('память: Chromium на три гигабайта говорит «2» — низкий; четыре гигабайта и четыре ядра — низкий', () => {
    expect(autoQuality(phone('Adreno (TM) 618', 2, 8))).toBe('low');
    expect(autoQuality(phone('Adreno (TM) 618', 4, 4))).toBe('low');
    expect(autoQuality(phone('Adreno (TM) 618', 4, 8))).toBe('medium');
  });

  it('iPhone — средний: памяти WebKit не называет, а ядра занижает нарочно', () => {
    expect(autoQuality({ coarse: true, memory: null, cores: 4, gpu: 'Apple GPU' })).toBe('medium');
    expect(autoQuality({ coarse: true, memory: null, cores: 2, gpu: 'Apple GPU' })).toBe('medium');
    expect(autoQuality({ coarse: true, memory: null, cores: null, gpu: null })).toBe('medium');
  });

  it('настольный — высокий; встроенная Intel HD/UHD — средний; без видеокарты — низкий', () => {
    expect(autoQuality(desk('ANGLE (NVIDIA, NVIDIA GeForce GTX 1060 6GB Direct3D11 vs_5_0 ps_5_0, D3D11)'))).toBe('high');
    expect(autoQuality(desk('Apple M1'))).toBe('high');
    expect(autoQuality(desk('ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)'))).toBe('high');
    expect(autoQuality(desk('ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)'))).toBe('medium');
    expect(autoQuality(desk('ANGLE (Intel, Intel(R) HD Graphics 4000 Direct3D11 vs_5_0 ps_5_0, D3D11)'))).toBe('medium');
    expect(autoQuality(desk('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)'))).toBe('low');
    expect(autoQuality(desk('llvmpipe (LLVM 15.0.7, 256 bits)'))).toBe('low');
    expect(autoQuality(desk(null))).toBe('high');
  });

  it('низкий не дороже среднего ни одной ручкой; средний и высокий — прежние числа (docs/perf.md)', () => {
    expect(QUALITY.high).toEqual({ dpr: 2, shadowSoft: true, mapDpr: 2, shadowEvery: 2, mapStepFps: 20 });
    expect(QUALITY.medium).toEqual({ dpr: 1.5, shadowSoft: true, mapDpr: 2, shadowEvery: 2, mapStepFps: 15 });
    const low = QUALITY.low;
    expect(low.dpr).toBeLessThanOrEqual(QUALITY.medium.dpr);
    expect(low.mapDpr).toBeLessThan(QUALITY.medium.mapDpr);
    // Плотность карты ниже единицы — мыло, а не экономия (правило двери кадра).
    expect(low.mapDpr).toBeGreaterThanOrEqual(1);
    expect(low.shadowEvery).toBeGreaterThan(QUALITY.medium.shadowEvery);
    // Шаг живого стоящей карты (docs/perf.md, решение 9): ниже — реже, и не реже десяти — метки мигают, отряды идут.
    expect(QUALITY.medium.mapStepFps).toBeLessThanOrEqual(QUALITY.high.mapStepFps);
    expect(low.mapStepFps).toBeLessThan(QUALITY.medium.mapStepFps);
    expect(low.mapStepFps).toBeGreaterThanOrEqual(10);
  });

  it('ниже низкого — нет', () => {
    expect(lowerQuality('high')).toBe('medium');
    expect(lowerQuality('medium')).toBe('low');
    expect(lowerQuality('low')).toBeNull();
  });
});

describe('сторож плавности посёлка', () => {
  /** Прогнать сторожа кадрами одной длительности, `seconds` секунд; куда он опустил уровень. */
  function run(from: Quality, ms: number, seconds: number): Quality {
    const s = new Steady(QUALITIES, from, VILLAGE_STEADY);
    for (let t = 0; t < seconds * 1000; t += ms) s.feed(ms);
    return s.tier;
  }

  /**
   * Экран в `hz` и настоящая дверь кадра (`loop.pace`, потолок шестьдесят); кадр стоит
   * `cost` мс — пока он рисуется, интервалы экрана проходят мимо. Сторож кормится
   * промежутками между нарисованными кадрами, как в сцене.
   */
  function screen(hz: number, cost: number, seconds: number, from: Quality = 'high'): Quality {
    const s = new Steady(QUALITIES, from, VILLAGE_STEADY);
    const vsync = 1000 / hz;
    let next = -Infinity;
    let last = -1;
    let busy = 0;
    for (let now = 0; now < seconds * 1000; now += vsync) {
      if (now < busy) continue;
      const p = pace(next, now, false);
      next = p.next;
      if (!p.draw) continue;
      if (last >= 0) s.feed(now - last);
      last = now;
      busy = now + cost;
    }
    return s.tier;
  }

  it('высокий на ровных шестидесяти не опускается на экранах от 50 до 165 Гц — и на 72 и 75 тоже', () => {
    // 72 и 75 Гц — дверь кадра кладёт кадры через один и два интервала экрана: каждый
    // четвёртый-пятый промежуток за 26 мс при ровном ходе. Прежний порог одного кадра
    // читал это провалом (разбор ночи 1).
    for (const hz of [50, 60, 72, 75, 85, 90, 100, 120, 144, 165]) expect(screen(hz, 4, 30), `${hz} Гц`).toBe('high');
  });

  it('высокий, который не держит шестидесяти, опускается на средний; средний на тридцати — остаётся', () => {
    // Кадр 22 мс на 60 Гц — рисуется через два интервала: тридцать кадров.
    expect(screen(60, 22, 10)).toBe('medium');
    // Кадр 18 мс на 120 Гц — через три интервала: сорок кадров.
    expect(screen(120, 18, 10)).toBe('medium');
    expect(screen(60, 22, 30, 'medium')).toBe('medium');
    expect(run('high', 33.3, 5)).toBe('medium');
    expect(run('medium', 33.3, 30)).toBe('medium');
  });

  it('на двадцати кадрах опускается до низкого — по шагу за окно, и ниже не идёт', () => {
    // Прогрев 45 кадров по 50 мс — 2.25 с, окно — 2 с: первый шаг вниз через 4.25 с.
    expect(run('high', 50, 4)).toBe('high');
    expect(run('high', 50, 5)).toBe('medium');
    expect(run('high', 50, 30)).toBe('low');
  });

  it('паузы — не кадры: фон и сборка мусора уровня не опускают', () => {
    expect(run('high', 400, 60)).toBe('high');
  });
});
