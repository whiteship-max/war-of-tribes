/**
 * Костёр и граница времени.
 *
 * Проверяется здесь не арифметика — она на три строки, — а **обещание**: всё,
 * что переживает выход из игры, считается чистой функцией от времени, без
 * тиков, без накопления и без фоновой работы. Обещание такого рода поведением
 * одним не проверишь: «тик появился» выглядит как обычная правка и ничем себя
 * не выдаёт. Поэтому половина этого файла читает исходники.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BURN_FULL_MS, HEARTH_CAP, LOG_MS, burnLeftMs, burnWords, burning, feed, fuelAt, hearthFill, logsTaken, newHearth } from './fire';
import { BURN_MEAN, RAIN_BURN, RING_MS, burnedMs } from './sky';

const H = 3_600_000;

/**
 * Погожий отрезок кольца — то, чем здесь меряют «двое суток».
 *
 * Ставка горения стала ставочной функцией от времени (дождь жжёт втрое), и
 * «полено = шесть часов» верно только в погожую погоду. Значит правило надо
 * проверять там, где погода заведомо ясная, а прогноз — отдельно и по-другому.
 * Спеллы 0 и 1 кольца погожие, то есть первые четыре минуты мира — ясные.
 */
const CLEAR = { at: 0, until: 240_000 };

describe('костёр горит по формуле, а не по тику', () => {
  it('полный костёр прогорает за двое суток погожего времени', () => {
    // ПРАВИЛО ОСТАЛОСЬ ПРЕЖНИМ, и это важно: «двое суток на полном очаге и
    // полном животе» — то, что игрок запоминает с одного раза, и погода его не
    // тронула. Тронула она прогноз, а не правило.
    expect(BURN_FULL_MS).toBe(48 * H);
    const full = { fuel: HEARTH_CAP, at: CLEAR.at };
    expect(fuelAt(full, CLEAR.at)).toBe(HEARTH_CAP);
    // В погожее время полено — ровно шесть часов, минута — ровно 1/360 полена.
    const span = CLEAR.until - CLEAR.at;
    expect(fuelAt(full, CLEAR.until)).toBeCloseTo(HEARTH_CAP - span / LOG_MS, 12);
    // А прогореть он обязан не позже правила: ставка нигде не меньше единицы.
    expect(fuelAt(full, 48 * H)).toBe(0);
    expect(burning({ fuel: 1, at: 0 }, 6 * H)).toBe(false);
  });

  it('дождь жжёт очаг втрое быстрее, и полоса об этом знает заранее', () => {
    /*
     * ЭТО И ЕСТЬ ВЕСЬ ВЫБОР «ГАСИТЬ ИЛИ ЖЕЧЬ», СКАЗАННЫЙ ЧИСЛАМИ.
     *
     * Гашение отобрало бы обещанное задним числом: полоса сказала «двое суток»,
     * а очаг встал в минуту, о которой она не знала. Ускоренное прогорание
     * ничего не отбирает — оно **входит в обещание**: `burnLeftMs` идёт по тому
     * же кольцу погод и называет срок вместе с дождём, который в него попадёт.
     */
    const rain = { at: 240_000, until: 331_200 };
    const clear = { at: CLEAR.at, until: CLEAR.at + (rain.until - rain.at) };
    expect(burnedMs(rain.at, rain.until) / burnedMs(clear.at, clear.until)).toBeCloseTo(RAIN_BURN, 9);
    // Обещание сходится с тем, что случится: полоса называет минуту, в которую
    // очаг вправду встанет, и называет её в любую минуту до неё.
    for (let t0 = 0; t0 < RING_MS; t0 += 97_000) {
      const h = { fuel: 3, at: t0 };
      const out = t0 + burnLeftMs(h, t0);
      expect(fuelAt(h, out - 60_000), `${t0}`).toBeGreaterThan(0);
      expect(fuelAt(h, out + 60_000), `${t0}`).toBe(0);
    }
  });

  it('настоящий срок полного очага — между шестнадцатью часами и сорока восемью', () => {
    // Борта — это и есть цена погоды, названная вслух: льёт не переставая —
    // шестнадцать часов, ясно всё время — сорок восемь, а по кольцу выходит
    // тридцать четыре. Дальше этих бортов правило уезжать не должно.
    expect(BURN_MEAN).toBeGreaterThan(1);
    expect(BURN_MEAN).toBeLessThan(RAIN_BURN);
    let lo = Infinity;
    let hi = 0;
    for (let t0 = 0; t0 < RING_MS; t0 += 20_000) {
      const left = burnLeftMs({ fuel: HEARTH_CAP, at: t0 }, t0) / H;
      lo = Math.min(lo, left);
      hi = Math.max(hi, left);
    }
    expect(lo).toBeGreaterThan((48 / RAIN_BURN) * 0.99);
    expect(hi).toBeLessThan(48);
    // Разброс по фазе почти нулевой: за тридцать часов проходит больше кольца, и
    // средняя ставка съедает разницу. Это не недосмотр — это то, почему офлайн
    // считается формулой, а не догоном.
    expect(hi - lo).toBeLessThan(1);
    expect((lo + hi) / 2).toBeCloseTo(48 / BURN_MEAN, 1);
  });

  it('ответ не зависит от того, сколько раз спросили', () => {
    // Это и есть отличие чтения от тика: тик, которого не случилось, теряется;
    // формула отдаёт одно и то же, сколько бы кадров ни пропустили.
    const h = { fuel: 6, at: 1000 };
    const once = fuelAt(h, 1000 + 10 * H);
    for (let i = 0; i < 100; i++) fuelAt(h, 1000 + i * H);
    expect(fuelAt(h, 1000 + 10 * H)).toBe(once);
    // И само состояние при чтении не меняется — читать нечего, кроме пары чисел.
    expect(h).toEqual({ fuel: 6, at: 1000 });
  });

  it('час игры и час без игры стоят костру одинаково', () => {
    const h = newHearth(0);
    // «Играли» — спрашивали каждую секунду; «не играли» — не спрашивали вовсе.
    for (let t = 0; t <= H; t += 1000) fuelAt(h, t);
    expect(fuelAt(h, H)).toBeCloseTo(fuelAt({ ...h }, H), 12);
  });

  it('горючее время добавочно: по частям столько же, сколько целиком', () => {
    // НА ЭТОМ СТОИТ ПРАВО ЗАКРЫВАТЬ ОТРЕЗОК ОЧАГА В ЛЮБУЮ МИНУТУ, то есть вся
    // запись на диск. Без добавочности «подложил дров» в разную минуту давало бы
    // разный остаток при одинаковой игре.
    const a = 12_345;
    const c = 9_999_999;
    for (const b of [777_777, 240_000, RING_MS, RING_MS * 3 + 1]) {
      expect(burnedMs(a, c)).toBeCloseTo(burnedMs(a, b) + burnedMs(b, c), 6);
    }
  });

  it('прогоревший костёр — ноль, а не долг', () => {
    expect(fuelAt({ fuel: 1, at: 0 }, 100 * H)).toBe(0);
    expect(burnLeftMs({ fuel: 1, at: 0 }, 100 * H)).toBe(0);
    expect(hearthFill({ fuel: 1, at: 0 }, 100 * H)).toBe(0);
  });

  it('погода не даёт очагу гореть дольше правила и не гасит его раньше времени', () => {
    // Ставка горения нигде не меньше единицы и нигде не больше `RAIN_BURN`:
    // значит полный очаг не переживёт сорока восьми часов ни при какой погоде и
    // не прогорит раньше шестнадцати. Проверяется по всему кольцу, а не на глаз.
    for (let t0 = 0; t0 < RING_MS; t0 += 11_000) {
      const rate = burnedMs(t0, t0 + 1000) / 1000;
      expect(rate, `${t0}`).toBeGreaterThanOrEqual(1);
      expect(rate, `${t0}`).toBeLessThanOrEqual(RAIN_BURN);
    }
  });

  it('часы, переведённые назад, дров не прибавляют', () => {
    // Запись из будущего бывает у того, у кого сбилась дата на телефоне.
    // Выдать ему полный костёр было бы наградой за сбитые часы.
    const h = { fuel: 3, at: 10 * H };
    expect(fuelAt(h, 0)).toBe(3);
    expect(fuelAt(h, 5 * H)).toBe(3);
  });
});

describe('подкладывание дров', () => {
  it('возвращает новый очаг, а не правит старый', () => {
    const h = { fuel: 2, at: 0 };
    const at = CLEAR.until;
    const next = feed(h, at, 3);
    expect(h).toEqual({ fuel: 2, at: 0 });
    expect(next.at).toBe(at);
    // За погожие четыре минуты от двух полен сгорело 4/360; плюс три.
    expect(next.fuel).toBeCloseTo(2 - at / LOG_MS + 3, 9);
  });

  it('сверх вместимости не влезает, и лишнее остаётся в руках', () => {
    const h = { fuel: HEARTH_CAP - 1, at: 0 };
    expect(logsTaken(h, 0, 5)).toBe(1);
    expect(feed(h, 0, 5).fuel).toBe(HEARTH_CAP);
    expect(logsTaken({ fuel: HEARTH_CAP, at: 0 }, 0, 3)).toBe(0);
  });

  it('отрицательных дров не бывает', () => {
    expect(logsTaken({ fuel: 2, at: 0 }, 0, -5)).toBe(0);
    expect(feed({ fuel: 2, at: 0 }, 0, -5).fuel).toBe(2);
  });
});

describe('сколько ещё гореть — словами', () => {
  it('срок называется тем, чем игрок его меряет — и с поправкой на погоду', () => {
    // Слова остались те же, а числа под ними стали честнее: полный очаг — уже
    // не «двое суток», а «сутки», потому что впереди дожди. Врать в эту сторону
    // безопасно (`spanWords` отбрасывает сутки), а в другую — нельзя вовсе.
    expect(burnWords({ fuel: HEARTH_CAP, at: 0 }, 0)).toBe('сутки');
    expect(burnWords({ fuel: 2, at: 0 }, 0)).toBe('8 ч');
    // Секунда спустя всё те же восемь: часы округляются, а не отбрасываются.
    expect(burnWords({ fuel: 2, at: 0 }, 1000)).toBe('8 ч');
    expect(burnWords({ fuel: 0, at: 0 }, 0)).toBe('погас');
    // Десятая полена — это тридцать шесть погожих минут, а сказано «25»: через
    // четыре минуты начнётся дождь, и полоса считает его вперёд. Ровно это и
    // значит «обещание не врёт»: оно короче правила, а не длиннее.
    expect(burnWords({ fuel: 0.1, at: 0 }, 0)).toBe('25 мин');
    // А то, что кончится раньше дождя, называется по правилу: 0.008 полена —
    // это две минуты пятьдесят три секунды погожего огня.
    expect(burnWords({ fuel: 0.008, at: 0 }, 0)).toBe('3 мин');
  });

  it('«0 мин» не говорится никогда', () => {
    // Ноль минут — это «погас», и говорить его иначе значит врать дважды.
    for (let f = 0.0001; f < 0.05; f += 0.0007) {
      const s = burnWords({ fuel: f, at: 0 }, 0);
      expect(s === 'погас' || /^[1-9]/.test(s), s).toBe(true);
    }
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

/** Исходник без комментариев: объяснения не должны проходить за код. */
const strip = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('граница между временем сцены и нашим счётом', () => {
  // Что часы здесь спрашивают в одну дверь (`net/clock`), стережёт не этот файл,
  // а `net/clock.test.ts`: `src/prologue` дописан в его список зон. Второй такой
  // же проверки тут нарочно нет — две правды об одном правиле расходятся ровно
  // в тот день, когда правят одну из них.

  it('`performance.now()` живёт только в сцене и в разборе жеста', () => {
    // Время кадров — законное время, но ему нельзя попадать в сохранение.
    // Стеречь это надо по файлам: сцена его считает, сохранение — нет.
    const allowed = new Set(['scene.ts']);
    for (const f of sources()) {
      const name = f.slice(DIR.length + 1);
      if (allowed.has(name)) continue;
      expect(strip(readFileSync(f, 'utf8')), `${name}: считает кадровое время`).not.toContain('performance.now');
    }
  });

  it('у костра нет ни тика, ни таймера, ни догона', () => {
    // Костёр — это формула. Появившийся здесь `setInterval` означал бы, что
    // кто-то начал копить то, что и так считается, и две правды разойдутся у
    // первого же игрока, свернувшего аппку.
    const src = strip(readFileSync(join(DIR, 'fire.ts'), 'utf8'));
    for (const word of ['setInterval', 'setTimeout', 'requestAnimationFrame', 'Date', 'catchUp']) {
      expect(src, `костёр начал тикать: ${word}`).not.toContain(word);
    }
  });

  it('сохранение везёт отметку времени, а не остаток', () => {
    // Пара «сколько было и когда» — единственная форма, при которой офлайн не
    // надо ни ловить, ни досчитывать. Поле вроде `left` или `secondsLeft`
    // означало бы, что кто-то записал результат вместо исходных данных.
    const src = strip(readFileSync(join(DIR, 'save.ts'), 'utf8'));
    expect(src).toContain('hearth');
    for (const word of ['left', 'remaining', 'lastTick', 'elapsed']) {
      expect(src, `в сохранении записан результат, а не исходные данные: ${word}`).not.toContain(word);
    }
  });

  it('предыстория не трогает ни сохранение партии, ни сервер', () => {
    // Связи с основной игрой в этом куске нет вовсе, и заводить её нельзя.
    for (const f of sources()) {
      const src = strip(readFileSync(f, 'utf8'));
      const name = f.slice(DIR.length + 1);
      // `gold` — в том же списке: премиальную валюту стережёт общий замок, а
      // золото деревни нет, и завести его здесь было бы связью с партией.
      for (const word of ['saveGame', 'loadGame', 'useGame', 'SAVE_VERSION', 'apiGet', 'apiPut', '/api/', 'worldApi', 'gold']) {
        expect(src, `${name}: предыстория лезет в игру: ${word}`).not.toContain(word);
      }
    }
  });

  // Что алмазов здесь нет ни в каком виде, стережёт не этот файл, а
  // `game/sim/gems.test.ts`: замок стоит на всём `src`, и `src/prologue` попал
  // под него сам, без единой строки. Своя такая же проверка тут не только
  // лишняя — она себя же и ловит: слово `creditGems`, написанное в списке
  // запретов, для замка неотличимо от вызова. Так и вышло при первом прогоне.
});
