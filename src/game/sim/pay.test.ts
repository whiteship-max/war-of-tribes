import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createInitialState } from '../state';
import { storageCap } from '../derived';
import { SURVEY_STEPS } from '../data/survey';
import { cancelSurvey, startSurvey } from './survey';

const SRC = join(__dirname, '..', '..');
const strip = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

/** Все исходники игры, которые едут игроку: без тестов. */
function sources(): { file: string; code: string }[] {
  const out: { file: string; code: string }[] = [];
  const walk = (dir: string): void => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
        out.push({ file: relative(SRC, p).split(sep).join('/'), code: strip(readFileSync(p, 'utf8')) });
      }
    }
  };
  walk(SRC);
  return out;
}

/** Тело функции `name` в исходнике: от объявления до закрывающей скобки в начале строки. */
function body(code: string, name: string): string {
  const at = code.search(new RegExp(`export function ${name}\\(`));
  if (at < 0) return '';
  const end = code.indexOf('\n}\n', at);
  return code.slice(at, end < 0 ? undefined : end);
}

describe('плата и возврат цены — одна дверь', () => {
  it('возврат цены зовут ровно четыре отмены, и своего возврата ни у одной нет', () => {
    // Вызовы `refund` по всему `src`, кроме самой двери, — поимённо.
    const calls: string[] = [];
    for (const { file, code } of sources()) {
      if (file === 'game/sim/pay.ts') continue;
      const n = (code.match(/\brefund\(/g) ?? []).length;
      if (n > 0) calls.push(`${file} ×${n}`);
    }
    expect(calls.sort()).toEqual(
      ['game/sim/actions.ts ×1', 'game/sim/army.ts ×1', 'game/sim/smithy.ts ×1', 'game/sim/survey.ts ×1'].sort(),
    );

    // Каждая отмена возвращает через дверь и не пишет в склад сама: пятая копия
    // «вернуть часть цены» заводится именно так — циклом по ресурсам в теле отмены.
    const cancels: [string, string][] = [
      ['game/sim/actions.ts', 'cancelUpgrade'],
      ['game/sim/army.ts', 'cancelRecruit'],
      ['game/sim/smithy.ts', 'cancelForge'],
      ['game/sim/survey.ts', 'cancelSurvey'],
    ];
    const all = new Map(sources().map((x) => [x.file, x.code]));
    for (const [file, name] of cancels) {
      const b = body(all.get(file) ?? '', name);
      expect(b, `${file}: ${name} найдена`).not.toBe('');
      expect(b, `${file}: ${name} возвращает через pay.refund`).toMatch(/\brefund\(/);
      expect(b, `${file}: ${name} сама пишет в склад`).not.toMatch(/s\.resources\[/);
    }
  });

  it('траты профиля засчитывает только дверь платы', () => {
    const writers = sources()
      .filter(({ file, code }) => file !== 'profile/stats.ts' && /\brecordSpent\(/.test(code))
      .map((x) => x.file);
    expect(writers).toEqual(['game/sim/pay.ts']);
  });

  it('отменённые разъезды не кладут на полный склад сверх вместимости', () => {
    const s = createInitialState();
    const step = SURVEY_STEPS[0];
    const cap = storageCap(s);
    const paid = Object.keys(step.cost) as (keyof typeof step.cost)[];
    expect(startSurvey(s)).toBeNull();
    // Пока разъезды в поле, склад пополнился до потолка: возврат ложится на полный склад.
    for (const r of paid) s.resources[r] = cap;
    for (const r of paid) {
      // Точка внутри области правила: возврат не пустой, без потолка склад ушёл бы выше вместимости.
      expect(Math.floor((step.cost[r] ?? 0) / 2), `${r}: возвращать есть что`).toBeGreaterThan(0);
    }
    expect(cancelSurvey(s)).toBeNull();
    for (const r of paid) expect(s.resources[r], `${r}: на складе не больше вместимости`).toBe(cap);
  });
});
