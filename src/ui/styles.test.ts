// Анимация появления не сдвигает элемент, который не центрован.
//
// Тост стоит по левому краю в половине экрана и центруется `translateX(-50%)`, поэтому его
// ключевые кадры несут тот же сдвиг: иначе на время анимации тост уехал бы вправо. Тревога
// (`.alert`) брала эти кадры, сама стоя во всю ширину без сдвига, — и первые 0,18 с стояла
// сдвинутой влево на полширины. Свойство поэтому общее, по всем стилям: правило, чья анимация
// двигает `transform`, сдвинуто на полширины ровно тогда, когда сдвинут каждый её кадр.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const FILES = ['src/ui/styles.css', 'src/prologue/prologue.css'];

const SHIFT = /translateX\(-50%\)/;

/** Ключевые кадры: имя → значения `transform` в кадрах (пусто — анимация `transform` не трогает). */
function keyframesOf(css: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const [, name, body] of css.matchAll(/@keyframes\s+([\w-]+)\s*\{((?:[^{}]*\{[^{}]*\})*[^{}]*)\}/g)) {
    out.set(name, [...body.matchAll(/transform:\s*([^;}]+)/g)].map((m) => m[1].trim()));
  }
  return out;
}

/** Правила вне ключевых кадров: селектор, `transform` правила и имена его анимаций. */
function rulesOf(css: string, names: readonly string[]): { sel: string; transform: string; anims: string[] }[] {
  const plain = css.replace(/@keyframes\s+[\w-]+\s*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
  return [...plain.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, sel, body]) => {
    const anim = [...body.matchAll(/animation(?:-name)?:\s*([^;]+)/g)].map((m) => m[1]).join(' ');
    return {
      sel: sel.trim(),
      transform: body.match(/(?:^|[;\s])transform:\s*([^;]+)/)?.[1].trim() ?? '',
      anims: names.filter((n) => new RegExp(`(^|[\\s,])${n}($|[\\s,])`).test(anim)),
    };
  });
}

describe('анимация появления не сдвигает элемент, который не центрован', () => {
  it('сдвиг на полширины у правила и у каждого кадра его анимации — один и тот же', () => {
    const checked: string[] = [];
    const wrong: string[] = [];
    for (const file of FILES) {
      const css = readFileSync(join(ROOT, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      const frames = keyframesOf(css);
      for (const rule of rulesOf(css, [...frames.keys()])) {
        for (const name of rule.anims) {
          const moves = frames.get(name)!;
          if (moves.length === 0) continue; // анимация `transform` не трогает — сдвигать нечего
          checked.push(rule.sel);
          const own = SHIFT.test(rule.transform);
          for (const m of moves) if (SHIFT.test(m) !== own) wrong.push(`${file}: ${rule.sel} — ${name} (${m})`);
        }
      }
    }
    // Область правила: проверены и правило со сдвигом (тост), и без него (тревога) — какими бы
    // кадрами они ни анимировались.
    expect(checked, 'тост со своим сдвигом проверен').toContain('.toast');
    expect(checked, 'тревога проверена').toContain('.alert');
    expect(wrong, 'кадры анимации сдвигают элемент иначе, чем он стоит сам').toEqual([]);
  });
});
