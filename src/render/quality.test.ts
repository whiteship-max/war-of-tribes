// Уровень по устройству и сторож плавности посёлка (docs/graphics_world.md, 9.2).
//
// Строки видеокарт — те, что браузеры отдают через WEBGL_debug_renderer_info: Android —
// настоящее имя, iOS — «Apple GPU», Chrome на Windows — строка ANGLE.
import { describe, expect, it } from 'vitest';
import { QUALITIES, VILLAGE_STEADY, autoQuality, lowerQuality, type DeviceCaps, type Quality } from './quality';
import { Steady } from './steady';

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

  it('высокий на ровных шестидесяти и на 90/120 Гц не опускается', () => {
    expect(run('high', 16.7, 10)).toBe('high');
    // 90 Гц под потолком шестьдесят: кадры 11.1 и 22.2 вперемешку — ровный ход.
    const s = new Steady(QUALITIES, 'high' as Quality, VILLAGE_STEADY);
    for (let i = 0; i < 600; i++) s.feed(i % 2 ? 22.2 : 11.1);
    expect(s.tier).toBe('high');
  });

  it('высокий на тридцати опускается на средний, средний на тридцати — остаётся', () => {
    // Граница области: 33.3 мс — выше порога высокого (26) и ниже порога среднего (36).
    expect(33.3).toBeGreaterThan(VILLAGE_STEADY('high').slowMs);
    expect(33.3).toBeLessThan(VILLAGE_STEADY('medium').slowMs);
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
