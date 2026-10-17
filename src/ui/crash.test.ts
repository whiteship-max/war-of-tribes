// Сбой окна — словами и кнопкой, а не пустым экраном (docs/bughunt.md, «Пустой экран после сбоя окна»).
//
// Ловушку сбоя в React держит класс с `getDerivedStateFromError`: её поведение проверяется вызовом самого класса —
// DOM в тестах нет, а серверная отрисовка ловушек не знает. Что ловушка стоит над игрой и над каждым окном, которое
// едет по нажатию, проверяется чтением исходника: это обещание о том, где она стоит, а не о том, что она делает.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Crash, chunkLost, crashNote, crashWords } from './Crash';

const SRC = join(__dirname, '..');

/** Исходник без комментариев: объяснения не должны проходить за код. */
const read = (file: string): string =>
  readFileSync(join(SRC, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

/** Отказы загрузки куска, как их пишут браузеры телефонов: Chrome и вебвью Android, Safari и WKWebView, Firefox. */
const LOST = [
  new TypeError('Failed to fetch dynamically imported module: https://game.example.ru/assets/RealmMenu-Bx81kq2a.js'),
  new TypeError('Importing a module script failed.'),
  new TypeError('error loading dynamically imported module: https://game.example.ru/assets/Minigame-Ab12Cd34.js'),
  new Error('Unable to preload CSS for /assets/Prologue-Zz99Yy88.css'),
];

describe('выкладка посреди игры — «Игра обновилась», а не пустота', () => {
  it('отказ загрузки куска узнаётся во всех браузерах телефонов', () => {
    for (const e of LOST) expect(chunkLost(e), e.message).toBe(true);
  });

  it('обычная ошибка кода — не выкладка', () => {
    expect(chunkLost(new TypeError("Cannot read properties of undefined (reading 'level')"))).toBe(false);
    expect(chunkLost(new RangeError('Invalid array length'))).toBe(false);
    expect(chunkLost('строка')).toBe(false);
  });

  it('слова: выкладка зовёт перезапустить, сбой кода — перезапустить и прислать запись', () => {
    expect(crashWords(LOST[0]).title).toBe('Игра обновилась');
    expect(crashWords(new TypeError('x')).title).toBe('Окно не открылось');
    for (const e of [LOST[1], new Error('x')]) expect(crashWords(e).why).toMatch(/перезапусти игру/i);
  });

  it('запись мастерам — имя, текст и начало стека, не длиннее полутора тысяч знаков', () => {
    const e = new TypeError('boom');
    const note = crashNote(e, 'держава');
    expect(note).toContain('держава');
    expect(note).toContain('TypeError: boom');
    expect(crashNote(new Error('я'.repeat(5000)), 'x').length).toBeLessThanOrEqual(1500);
  });
});

describe('ловушка: сбой — экран со словами и кнопкой, без сбоя — само окно', () => {
  it('сбой при рисовании ловится, и ловушка помнит его', () => {
    const e = new TypeError('boom');
    expect(Crash.getDerivedStateFromError(e)).toEqual({ error: e });
    // Брошенное «ничто» не прячется: экран сбоя всё равно встаёт.
    expect(Crash.getDerivedStateFromError(undefined).error).toBeInstanceOf(Error);
  });

  it('без сбоя ловушка отдаёт само окно', () => {
    const c = new Crash({ where: 'шторка', children: createElement('b', null, 'окно') });
    expect(renderToStaticMarkup(createElement('div', null, c.render()))).toBe('<div><b>окно</b></div>');
  });

  it('после сбоя — слова, «Перезапустить игру» и запись мастерам; у окна — ещё и «Закрыть окно»', () => {
    const top = new Crash({ where: 'игра', children: null });
    top.state = { error: new TypeError('boom'), sent: 'idle' };
    const html = renderToStaticMarkup(createElement('div', null, top.render()));
    expect(html).toContain('Окно не открылось');
    expect(html).toContain('Перезапустить игру');
    expect(html).toContain('Отправить запись мастерам');
    expect(html).not.toContain('Закрыть окно');

    const sheet = new Crash({ where: 'шторка', children: null, onClose: () => {}, inline: true });
    sheet.state = { error: LOST[0], sent: 'idle' };
    const inSheet = renderToStaticMarkup(createElement('div', null, sheet.render()));
    expect(inSheet).toContain('Игра обновилась');
    expect(inSheet).toContain('Закрыть окно');
    expect(inSheet).toContain('crash-inline');
    // Выкладку лечит только перезапуск: запись о ней мастерам ничего не даст.
    expect(inSheet).not.toContain('Отправить запись мастерам');
  });
});

describe('где стоит ловушка', () => {
  it('над всей игрой — в main.tsx', () => {
    expect(read('main.tsx')).toMatch(/<Crash[^>]*>\s*<App \/>\s*<\/Crash>/);
  });

  /** Стоит ли `<Имя` внутри открытой `<Crash` — ближайшая открывающая ловушка позже ближайшей закрывающей. */
  const guarded = (src: string, tag: string): boolean => {
    const at = src.indexOf(`<${tag}`);
    if (at < 0) return false;
    const before = src.slice(0, at);
    return before.lastIndexOf('<Crash') > before.lastIndexOf('</Crash>');
  };

  it('над каждым окном, которое едет по нажатию, над шторкой и над картой — в App.tsx', () => {
    const app = read('App.tsx');
    // Все куски, что `App` берёт через `lazy`, кроме частей, приезжающих при входе (строка, низ, подсказки), и окон шторки
    // куска нового вида — карточки клетки, «Походов», «Дружины» (UI-4, docs/ui_v2.md, 5.3) и «Жителей» (UI-5, 5.4): их держит
    // ловушка над `SheetContent`, она проверяется ниже.
    const lazies = [...app.matchAll(/const (\w+) = lazy\(/g)].map((m) => m[1]);
    // С UI-7 (5.6) — и окна осады, вылазки и лагеря.
    // С UI-8 (5.7) — и «Мораль» с «Порядком». С П-7 (docs/polish.md) — значки тревог войны: приезжают при входе, как ряд тревог.
    const atEntry = new Set(['Hud', 'Alerts', 'WarSigns', 'Nav', 'TipLayer', 'Hints', 'CityNaming', 'WorldNew', 'MarchesNew', 'ArmyPanel', 'PeoplePanel', 'SiegePanel', 'SortiePanel', 'CampPanel', 'MoralePanel', 'OrderPanel', 'BuildingPanel']);
    const onTap = lazies.filter((n) => !atEntry.has(n));
    expect(onTap.sort()).toEqual(['BugReport', 'Minigame', 'Prologue', 'RealmMenu', 'Trades', 'Treasury']);
    for (const name of [...onTap, 'SheetContent', 'WorldMap']) expect(guarded(app, name), name).toBe(true);
  });
});
