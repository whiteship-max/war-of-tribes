// Касание до того, как кусок доехал (ОС-1, docs/siege_v2.md, 23.10): окно «Настройки» стартового экрана и шторка окон едут куском
// нового вида (`ui/next`), и касание может прийти раньше куска. Обещание: окно догружается и открывается — без ошибки и без
// пустоты. DOM в тестах нет, и проверяет его потоковая отрисовка React — та же машина границ ожидания, что у браузера:
// «оболочка» — то, что стоит на экране в миг касания (кусок ещё не приехал), полная отрисовка — то, что встаёт, когда он доехал.
// Рисуются ровно те компоненты, что `App` отдаёт экрану (`StartSettings`, `SheetDoor`), а не их копии.
import { createElement, type ReactElement } from 'react';
import { renderToPipeableStream } from 'react-dom/server';
import { Writable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { SheetDoor, StartSettings } from '@/App';

// Адрес страницы — единственное браузерное, что окно читает при отрисовке (настройки графики берут из него «Авто»). Окна в
// узле нет: двери, которым оно нужно, это знают (`viewport.ts`, `telegram/webapp.tg` — «не в Telegram»).
vi.stubGlobal('location', new URL('https://game.example/'));

interface Painted {
  /** Что на экране в миг касания: оболочка, отданная до куска. */
  shell: string;
  /** Что встало, когда кусок доехал. */
  all: string;
  errors: unknown[];
}

/** Потоковая отрисовка: оболочку снимает первый проход, остальное доливается, пока границы ожидания закрываются. */
function paint(el: ReactElement): Promise<Painted> {
  return new Promise((done, fail) => {
    let html = '';
    let shell: string | null = null;
    const errors: unknown[] = [];
    const sink = new Writable({
      write(chunk: Buffer, _enc, next) {
        html += chunk.toString();
        next();
      },
    });
    sink.on('finish', () => done({ shell: shell ?? '', all: html, errors }));
    const stream = renderToPipeableStream(el, {
      onShellReady() {
        stream.pipe(sink);
        // Оболочка уходит в поток сразу, в том же вызове: это и есть кадр касания.
        shell = html;
      },
      onShellError: fail,
      onError: (e) => void errors.push(e),
    });
  });
}

/** Граница ожидания открыта: кусок ещё едет, а вокруг всё стоит (`<!--$?-->`). */
const WAITING = '<!--$?-->';
/** Граница сдалась браузеру — на сервере была ошибка (`<!--$!-->`). */
const FAILED = '<!--$!-->';

describe('касание до того, как кусок доехал — окно догружается и открывается', () => {
  it('«Настройки» стартового экрана: в миг касания — граница ожидания, кусок доехал — настройки, ошибок нет', async () => {
    const p = await paint(createElement(StartSettings));
    expect(p.shell, 'в миг касания кусок ещё едет: граница ждёт, а не роняет экран').toContain(WAITING);
    expect(p.shell, 'и настроек в ней ещё нет').not.toContain('set-row');
    expect(p.errors, 'без ошибки').toEqual([]);
    expect(p.all, 'без ошибки').not.toContain(FAILED);
    expect(p.all, 'кусок доехал — настройки на месте, не пустота').toContain('set-row');
    expect(p.all).toContain('Звук');
  }, 60_000);

  it('шторка окон: в миг касания — граница ожидания, кусок доехал — шторка открыта с окном внутри', async () => {
    const p = await paint(createElement(SheetDoor, { open: true, onClose: () => undefined, children: createElement('p', null, 'Окно постройки') }));
    expect(p.shell, 'в миг касания кусок ещё едет: граница ждёт').toContain(WAITING);
    expect(p.shell).not.toContain('Окно постройки');
    expect(p.errors, 'без ошибки').toEqual([]);
    expect(p.all).not.toContain(FAILED);
    expect(p.all, 'кусок доехал — шторка открыта').toMatch(/class="sheet[^"]*open/);
    expect(p.all, 'с окном внутри, не пустая').toContain('Окно постройки');
  }, 60_000);
});
