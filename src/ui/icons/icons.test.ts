import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { SRC, allowedColors, auditNames, check, returnedNames } from '../../../scripts/build-icons';
import { ICON_GROUPS, ICON_MANIFEST, daypartOf, groupOf, iconName, moodOf } from './registry';
import { DRAWN_ICONS } from './generated';
import { isDrawn, symbolOf } from './sheet';

const files = readdirSync(SRC)
  .filter((f) => f.endsWith('.svg'))
  .map((f) => f.slice(0, -4))
  .sort();
const returned = returnedNames();
const colors = allowedColors();

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
      for (const id of group.ids) expect(names.has(`${group.prefix}-${id}`)).toBe(true);
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
    // Профессии — вторая очередь. Пока не пришёл ни один файл `job-*`,
    // спрашивать с них нечего, и сборка обязана оставаться зелёной.
    const audit = auditNames(new Set(files), returned);
    expect(audit.openGroups).toContain('job');
    expect(audit.missing.filter((m) => m.group === 'job')).toEqual([]);
  });

  it('первый же файл группы делает её спрос полным', () => {
    const audit = auditNames(new Set([...files, 'job-smith']), returned);
    expect(audit.openGroups).not.toContain('job');
    expect(audit.missing.map((m) => m.name)).toContain('job-priest');
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
    expect(isDrawn('res-wood')).toBe(true);
    // Профессии не заказаны второй очередью, и спрашивать их можно уже сейчас:
    // компонент сам покажет эмодзи, а когда файл приедет — значок, без правок кода.
    expect(isDrawn('job-smith')).toBe(false);
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
