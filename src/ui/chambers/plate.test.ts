// Плашка реплики в покоях (docs/city_v3.md, Г-9): «Раз просишь — останусь.» висела наутро после ночи. Последняя реплика
// гаснет в свой срок от мига показа, сколько бы раз ни перерисовался слой; ночь гасит её сразу; каждый разговор слуги,
// служанки и супруги кончается репликой со сроком — залипших нет.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { freshMemory, household, opening, reply, type Daypart, type TalkCtx, type TalkTurn, type Temper } from './talk';
import { lingerMs, Plate } from './plate';
import type { Who, Why } from '@/render/chambers/life';

const DAYS: Daypart[] = ['morning', 'day', 'evening', 'night'];
const TEMPERS: Temper[] = ['meek', 'merry', 'stern', 'pious', 'proud'];
// Разговоры дома; гонец и советник говорят своими плашками (`CourtWindow`), без дерева ответов.
const WHY: Record<Exclude<Who, 'herald' | 'advisor'>, Why[]> = { servant: ['arrive', 'cat', 'uncat', 'come'], maid: ['arrive', 'poured', 'come'], wife: ['arrive', 'come'] };

function ctx(over: Partial<TalkCtx>): TalkCtx {
  const h = household('Бертран', 3, 'catholic');
  return {
    who: 'servant',
    why: 'arrive',
    daypart: 'day',
    morale: 60,
    besieged: false,
    campaign: false,
    cat: false,
    wine: 0,
    adult: true,
    ruler: 'Бертран',
    faith: 'catholic',
    wife: h.wife,
    maid: h.maid,
    servant: h.servant,
    heir: 'Гуго',
    mem: freshMemory(h.house),
    roll: 0.3,
    ...over,
  };
}

/** Все реплики разговора до `depth` ходов от начала: что видит плашка. */
function turns(c: TalkCtx, depth: number): TalkTurn[] {
  const out: TalkTurn[] = [];
  const walk = (t: TalkTurn, mem: TalkCtx['mem'], d: number): void => {
    out.push(t);
    if (t.end || d >= depth) return;
    for (const o of t.options) {
      const r = reply({ ...c, mem }, o.id);
      walk(r, r.mem, d + 1);
    }
  };
  const first = opening(c);
  walk(first, first.mem, 0);
  return out;
}

describe('покои: плашка реплики (Г-9)', () => {
  it('последняя реплика гаснет в свой срок от мига показа, сколько бы раз слой ни перерисовался', () => {
    const p = new Plate();
    const end = { line: 'Раз просишь — останусь.', end: true };
    const due = lingerMs(end.line);
    p.show(end, 1000);
    // Граница области — до срока плашка стоит, после — погасла; перерисовки (частые вопросы) срока не двигают.
    for (let t = 1000; t < 1000 + due; t += 50) {
      expect(p.gone(t, false), `${t - 1000} мс: ещё стоит`).toBe(false);
      expect(p.left(t), 'срок не отодвигается перерисовкой').toBeCloseTo(1000 + due - t, 6);
    }
    expect(p.gone(1000 + due, false), 'срок вышел — погасла').toBe(true);
    // Реплика с ответами срока не имеет: разговор ждёт слова.
    p.show({ line: 'Звал, Бертран?', end: false }, 5000);
    expect(p.left(9e9)).toBeNull();
    expect(p.gone(9e9, false)).toBe(false);
  });

  it('ночь гасит плашку сразу, и с репликой со сроком, и без', () => {
    const p = new Plate();
    p.show({ line: 'Как скажешь… Только свечу задуй.', end: true }, 0);
    expect(p.gone(1, true)).toBe(true);
    p.show({ line: 'Как живёшь?', end: false }, 0);
    expect(p.gone(1, true)).toBe(true);
  });

  it('каждый разговор слуги, служанки и супруги кончается репликой со сроком, а не висит', () => {
    // Граница области — все, кто говорит, все «зачем», четыре часа, пять нравов, мир и осада, кот и вино; до пяти ходов.
    let ends = 0;
    let all = 0;
    for (const who of ['servant', 'maid', 'wife'] as const)
      for (const why of WHY[who])
        for (const daypart of DAYS)
          for (const temper of TEMPERS)
            for (const besieged of [false, true])
              for (const cat of [false, true]) {
                const c = ctx({ who, why, daypart, besieged, cat, wine: cat ? 0.5 : 0, wife: { name: 'Бланка', temper } });
                for (const t of turns(c, 5)) {
                  all++;
                  const p = new Plate();
                  p.show(t, 0);
                  if (t.end) {
                    ends++;
                    expect(p.left(0), `${who} ${why} ${daypart}: «${t.line}» — срок`).not.toBeNull();
                    expect(p.left(0)!, 'не дольше шести секунд').toBeLessThanOrEqual(6000);
                    expect(p.gone(6000, false), `«${t.line}» погасла`).toBe(true);
                  } else {
                    // Реплика с ответами — не тупик: среди них всегда есть проститься (плашка уйдёт вместе с человеком).
                    expect(t.options.map((o) => o.id), `«${t.line}» — есть как проститься`).toEqual(expect.arrayContaining([who === 'servant' ? 'dismiss' : 'leave']));
                  }
                }
              }
    expect(ends, 'конец разговора есть в обходе').toBeGreaterThan(100);
    expect(all).toBeGreaterThan(ends);
  });

  it('окно разговора: срок конца — от плашки, а не от перерисовки; ночь и новый подход — своим правилом', () => {
    const src = (f: string): string => readFileSync(join(__dirname, f), 'utf8');
    const talk = src('TalkWindow.tsx');
    // Таймер конца заводится от реплики (`[turn]`), `onDone` — по ссылке: новая функция каждой перерисовки его не сбрасывает.
    expect(talk).toMatch(/plate\.current\.left\(performance\.now\(\)\)[\s\S]*?finish\.current\(\)[\s\S]*?\}, \[turn\]\);/);
    expect(talk).not.toMatch(/\[turn, onDone\]/);
    // У плашки — крестик всегда, и у последней реплики.
    expect(talk).not.toMatch(/\{!turn\.end && \(\s*<button className="ch-talk-x"/);
    const ch = src('Chambers.tsx');
    expect(ch, 'в ночь окна разговора нет').toMatch(/\{talk && live && !night && !courtTalk && \(/);
    // Гонец и советник (Г-10) — свои плашки, и в ночь их нет тоже.
    expect(ch).toMatch(/\{talk && live && !night && talk\.who === 'herald' && <HeraldPlate/);
    expect(ch).toMatch(/\{talk && live && !night && talk\.who === 'advisor' && <AdvisorPlate/);
    expect(ch, 'ночь снимает разговор').toMatch(/if \(night\) setTalk\(null\)/);
  });
});
