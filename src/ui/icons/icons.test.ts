import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  SRC,
  allowedColors,
  allowedPairs,
  auditNames,
  check,
  findTwins,
  iou,
  maskOf,
  measureTone,
  pairKey,
  paintShare,
  returnedNames,
  toneFaults,
} from '../../../scripts/build-icons';
import { ICON_GROUPS, ICON_MANIFEST, daypartOf, groupOf, iconName, moodOf } from './registry';
import { DRAWN_ICONS } from './generated';
import { isDrawn, symbolOf } from './sheet';

const files = readdirSync(SRC)
  .filter((f) => f.endsWith('.svg'))
  .map((f) => f.slice(0, -4))
  .sort();
const returned = returnedNames();
const colors = allowedColors();

/**
 * Срок для проверок, которые растрируют весь набор (`sharp`, полторы сотни файлов).
 * Одни они идут около секунды, но стандартные пять секунд vitest — срок не на работу, а
 * на процессор: под двумя прогонами разом (или рядом с отчётами во втором worktree)
 * они идут до четырнадцати секунд и падали по сроку, а не по утверждению. Так выглядел
 * плавающий тест, которого не могли назвать: десять прогонов подряд чисты, пять прогонов
 * вдвоём — восемь падений из десяти, всегда эти две проверки и всегда «timed out».
 */
const RASTER_ALL = 60_000;

describe('накладная собрана из данных игры', () => {
  it('в списке нет ни одного имени, написанного руками дважды', () => {
    expect(new Set(ICON_MANIFEST).size).toBe(ICON_MANIFEST.length);
  });

  it('здания, войска, снаряжение и ресурсы попадают в накладную сами', () => {
    // Проверка не переписывает списки: она спрашивает у накладной то же, что игра
    // спрашивает у своих данных. Заведут здание — строка появится здесь без правок.
    const names = new Set(ICON_MANIFEST);
    for (const group of ICON_GROUPS) {
      expect(group.ids.length, `группа ${group.prefix} пуста`).toBeGreaterThan(0);
      // Спрашивается разрешённое имя: часть идентификаторов ведёт ссылкой на уже
      // нарисованное (достижение «первая разведка» — на значок разведчика), и
      // своего файла такие не просят.
      for (const id of group.ids) {
        const name = iconName(group.prefix, id);
        expect(names.has(name), `${group.prefix}-${id} → ${name}`).toBe(true);
      }
    }
  });

  it('каждое имя из накладной относится к известной группе', () => {
    for (const name of ICON_MANIFEST) expect(groupOf(name), name).not.toBeNull();
  });

  it('ссылки ведут на значки, которые в накладной есть', () => {
    // Лето берёт солнце дня, маркер заказа — кузнеца: второй раз это не рисуется.
    const names = new Set(ICON_MANIFEST);
    for (const alias of ['season-summer', 'attn-order', 'alert-food', 'nav-townhall']) {
      const [prefix, ...rest] = alias.split('-');
      const resolved = iconName(prefix, rest.join('-'));
      expect(names.has(resolved), `${alias} → ${resolved}`).toBe(true);
      expect(resolved).not.toBe(alias);
    }
  });
});

describe('генератор', () => {
  it('массив значков собран из имён файлов, а не написан руками', () => {
    const expected = files.filter((n) => !returned.has(n));
    expect([...DRAWN_ICONS].sort()).toEqual(expected);
  });

  it('в массив не попал ни один файл, отданный на переделку', () => {
    for (const name of returned) expect(DRAWN_ICONS).not.toContain(name);
  });

  it('символ в листе зовётся по имени файла', () => {
    const sheet = readFileSync(path.join(SRC, '..', '..', 'public', 'assets', 'icons', 'sprite.svg'), 'utf8');
    for (const name of DRAWN_ICONS) expect(sheet).toContain(`id="i-${name}"`);
    expect(symbolOf('res-wood')).toBe('#i-res-wood');
    // Лист собран заново на этой самой папке: пересобрать его — единственный
    // способ поправить, руками в него не дописывают.
    expect((sheet.match(/<symbol /g) ?? []).length).toBe(DRAWN_ICONS.length);
  });
});

describe('сверка с данными игры', () => {
  it('лишний файл роняет сборку', () => {
    const present = new Set([...files, 'bld-observatory']);
    expect(auditNames(present, returned).extra).toContain('bld-observatory');
  });

  it('недостающий значок в начатой группе роняет сборку', () => {
    const present = new Set(files.filter((n) => n !== 'bld-smithy'));
    const missing = auditNames(present, returned).missing.map((m) => m.name);
    expect(missing).toContain('bld-smithy');
  });

  it('группа, к которой не приступали, ничего не требует', () => {
    // Пока не пришёл ни один файл группы, спрашивать с неё нечего, и сборка
    // обязана оставаться зелёной: так подключается каждая следующая очередь.
    // Группа берётся не «та, которой сейчас нет» — сегодня нет одной, завтра
    // другой, — а вычитается из папки нарочно, чтобы тест не зависел от того,
    // сколько уже нарисовано.
    const audit = auditNames(new Set([...files].filter((n) => !n.startsWith('bld-'))), returned);
    expect(audit.openGroups).toContain('bld');
    expect(audit.missing.filter((m) => m.group === 'bld')).toEqual([]);
  });

  it('первый же файл группы делает её спрос полным', () => {
    const one = new Set([...files].filter((n) => !n.startsWith('bld-')));
    one.add('bld-smithy');
    const audit = auditNames(one, returned);
    expect(audit.openGroups).not.toContain('bld');
    expect(audit.missing.map((m) => m.name)).toContain('bld-farm');
  });

  it('нынешняя папка сходится с игрой: ни лишнего, ни недостающего', () => {
    const audit = auditNames(new Set(files), returned);
    expect(audit.extra).toEqual([]);
    expect(audit.missing).toEqual([]);
  });
});

describe('проверка формата', () => {
  const good = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">' +
    '<polygon points="1,1 31,1 31,31 1,31" fill="#9d6d42"/></svg>';

  it('образцовый файл проходит', () => {
    expect(check('t.svg', good, colors)).toEqual([]);
  });

  it.each([
    ['сетка 24 вместо 32', good.replace('viewBox="0 0 32 32"', 'viewBox="0 0 24 24"'), '3.2 сетка'],
    ['нет width и height', good.replace(' width="32" height="32"', ''), '3.2 размеры'],
    ['обводка', good.replace('fill="#9d6d42"', 'fill="#9d6d42" stroke="#2b2733"'), '3.2 только fill'],
    ['градиент', good.replace('<polygon', '<linearGradient id="g"/><polygon'), '3.2 состав'],
    ['текст', good.replace('<polygon', '<text x="1" y="1">A</text><polygon'), '3.2 состав'],
    ['цвет не из палитры', good.replace('#9d6d42', '#123456'), '2.2 палитра'],
    ['цвет заглавными', good.replace('#9d6d42', '#9D6D42'), '3.2 заливка'],
    ['четыре знака после запятой', good.replace('31,31', '31.0625,31'), '3.2 координаты'],
    ['вылез за поле', good.replace('31,31 1,31', '32,32 0,32'), '3.2 поле'],
    ['не дотянул до поля', good.replace('points="1,1 31,1 31,31 1,31"', 'points="8,8 20,8 20,20 8,20"'), '3.4 поля'],
    ['комментарий редактора', good.replace('<polygon', '<!-- Layer 1 --><polygon'), '3.2 оптимизация'],
    ['анимация', good.replace('</svg>', '<animate/></svg>'), '3.2 анимация'],
  ])('%s — брак', (_name, text, rule) => {
    expect(check('t.svg', text, colors).map((f) => f.rule)).toContain(rule);
  });

  it('вес больше килобайта — брак', () => {
    const fat = good.replace('</svg>', `${'<rect x="1" y="1" width="2" height="2" fill="#9d6d42"/>'.repeat(30)}</svg>`);
    const rules = check('t.svg', fat, colors).map((f) => f.rule);
    expect(rules).toContain('3.3 вес');
    expect(rules).toContain('3.3 заливки');
  });

  it('все принятые файлы проходят проверку прямо сейчас', () => {
    for (const name of DRAWN_ICONS) {
      const text = readFileSync(path.join(SRC, `${name}.svg`), 'utf8').trim();
      expect(check(`${name}.svg`, text, colors), name).toEqual([]);
    }
  });

  it('палитра берётся из проекта, а не переписана в проверку', () => {
    expect(colors.get('#9d6d42')).toBe('палитра wood');
    expect(colors.get('#e0524f')).toBe('переменная стиля --gem');
    expect(colors.get('#a2795a')).toBe('цвет отношений «Варвары»');
  });
});

describe('где значка нет — остаётся эмодзи', () => {
  it('нарисованное отличается от ненарисованного одним вопросом', () => {
    // Спрашивать можно любое имя, в том числе то, чего ещё не нарисовали:
    // компонент сам покажет эмодзи, а когда файл приедет — значок, без единой
    // правки в компонентах. Пример ненарисованного берётся не из списка очередей
    // (сегодня нет одного, завтра другого), а заведомо несуществующим именем.
    for (const name of DRAWN_ICONS) expect(isDrawn(name), name).toBe(true);
    expect(isDrawn('bld-observatory')).toBe(false);
    expect(isDrawn('нет-такого')).toBe(false);
  });

  it('отданный на переделку значок показывается эмодзи, а не пустотой', () => {
    for (const name of returned) expect(isDrawn(name)).toBe(false);
  });
});

describe('пороги состояний живут в одном месте', () => {
  it('мораль выбирает ступень по числу', () => {
    expect(moodOf(90).name).toBe('mood-good');
    expect(moodOf(70).name).toBe('mood-good');
    expect(moodOf(69).name).toBe('mood-mid');
    expect(moodOf(40).name).toBe('mood-mid');
    expect(moodOf(0).name).toBe('mood-bad');
  });

  it('время суток выбирает значок по фазе солнца, и день берёт летнее солнце', () => {
    expect(daypartOf(0).name).toBe('day-morning');
    expect(daypartOf(0.3).name).toBe('season-sun');
    expect(daypartOf(0.5).name).toBe('day-evening');
    expect(daypartOf(0.9).name).toBe('day-night');
  });
});

describe('тон: значок читается и на тёмной панели, и на светлой', () => {
  const svg = (fill: string) =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">` +
    `<polygon points="1,1 31,1 31,31 1,31" fill="${fill}"/></svg>`;

  it('значок целиком из штукатурки — брак: на светлой теме от него ничего не останется', async () => {
    const tone = await measureTone(svg('#e4dac6'));
    expect(tone, 'растеризатор недоступен').not.toBeNull();
    expect(tone!.light).toBeGreaterThan(0.9);
    const { faults } = toneFaults('t.svg', tone!);
    expect(faults.map((f) => f.rule)).toContain('4 тон');
  });

  it('значок целиком из проёма — предупреждение: край обгрызается на тёмной панели', async () => {
    const tone = await measureTone(svg('#2b2733'));
    expect(tone).not.toBeNull();
    const { warnings } = toneFaults('t.svg', tone!);
    expect(warnings.map((f) => f.detail).join(' ')).toContain('тёмного');
  });

  it('средний тон палитры не вызывает ни брака, ни предупреждения', async () => {
    const tone = await measureTone(svg('#9d6d42'));
    expect(tone).not.toBeNull();
    expect(toneFaults('t.svg', tone!)).toEqual({ faults: [], warnings: [] });
  });

  it('ни один принятый значок не уходит целиком в светлое', async () => {
    // Предел в 25% — мерка приблизительная, и на грани значки остаются в игре
    // предупреждением. А вот силуэт, целиком лежащий в светлом, техзадание
    // запрещает прямо — такой в лист не попадает.
    for (const name of DRAWN_ICONS) {
      const tone = await measureTone(readFileSync(path.join(SRC, `${name}.svg`), 'utf8').trim());
      if (tone === null) return;
      expect(toneFaults(`${name}.svg`, tone).faults, name).toEqual([]);
    }
  }, RASTER_ALL);
});

describe('один предмет — два значка', () => {
  const svg = (body: string) =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">${body}</svg>`;
  const square = svg('<polygon points="1,1 31,1 31,31 1,31" fill="#9d6d42"/>');
  const shifted = svg('<polygon points="2,1 31,1 31,31 2,31" fill="#9d6d42"/>');
  const bar = svg('<polygon points="1,14 31,14 31,18 1,18" fill="#9d6d42"/>');

  it('маска и доля общего считаются по растру, а не по тексту файла', async () => {
    const [a, b, c] = await Promise.all([maskOf(square), maskOf(shifted), maskOf(bar)]);
    expect(a, 'растеризатор недоступен').not.toBeNull();
    // Разные байты, почти один силуэт — ровно тот случай, ради которого проверка и заведена.
    expect(square).not.toBe(shifted);
    expect(iou(a!, b!)).toBeGreaterThan(0.9);
    expect(iou(a!, c!)).toBeLessThan(0.3);
  });

  it('краски сравниваются набором, а не порядком', () => {
    expect(paintShare(new Set(['#9d6d42', '#60432a']), new Set(['#60432a', '#9d6d42']))).toBe(1);
    expect(paintShare(new Set(['#9d6d42']), new Set(['#8f8b84']))).toBe(0);
  });

  it('похожесть внутри группы не считается повтором: родня там замысел', async () => {
    const mask = (await maskOf(square))!;
    const paint = new Set(['#9d6d42']);
    const family = [
      { name: 'rel-self', mask, paint },
      { name: 'rel-ally', mask, paint },
    ];
    expect(findTwins(family, new Set())).toEqual([]);
  });

  it('похожесть между группами всплывает парой', async () => {
    const [a, b] = await Promise.all([maskOf(square), maskOf(shifted)]);
    const paint = new Set(['#9d6d42']);
    const pair = [
      { name: 'bld-cache', mask: a!, paint },
      { name: 'ui-crate', mask: b!, paint },
    ];
    const twins = findTwins(pair, new Set());
    expect(twins).toHaveLength(1);
    expect(pairKey(twins[0].a, twins[0].b)).toBe('bld-cache = ui-crate');
  });

  it('разобранная пара из OBJECTS.md больше не всплывает', async () => {
    const [a, b] = await Promise.all([maskOf(square), maskOf(shifted)]);
    const paint = new Set(['#9d6d42']);
    const pair = [
      { name: 'bld-cache', mask: a!, paint },
      { name: 'ui-crate', mask: b!, paint },
    ];
    expect(findTwins(pair, new Set([pairKey('ui-crate', 'bld-cache')]))).toEqual([]);
  });

  it('ключ пары не зависит от порядка', () => {
    expect(pairKey('ui-crate', 'bld-cache')).toBe(pairKey('bld-cache', 'ui-crate'));
  });

  it('OBJECTS.md читается и разбор в нём записан', () => {
    const pairs = allowedPairs();
    // Пары, про которые уже решено; строки лежат в самом разборе, а не отдельным перечнем.
    expect(pairs.has(pairKey('alert-raid', 'hud-army'))).toBe(true);
    expect(pairs.has(pairKey('hud-pop', 'stage-town'))).toBe(true);
  });

  it('нынешний набор не держит неразобранных повторов', async () => {
    const paints = new Map<string, Set<string>>();
    const shots: { name: string; mask: Uint8Array; paint: Set<string> }[] = [];
    for (const name of DRAWN_ICONS) {
      const text = readFileSync(path.join(SRC, `${name}.svg`), 'utf8').trim();
      const mask = await maskOf(text);
      if (mask === null) return;
      const paint = new Set([...text.matchAll(/fill="(#[0-9a-f]{6})"/g)].map((m) => m[1]));
      paints.set(name, paint);
      shots.push({ name, mask, paint });
    }
    expect(findTwins(shots, allowedPairs())).toEqual([]);
  }, RASTER_ALL);
});
