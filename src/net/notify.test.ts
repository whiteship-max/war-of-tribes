import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { NoticeItem, NotifyPut, NotifyState } from '../../netlify/lib/contract';
import { DEFAULT_PREFS } from '../../netlify/lib/contract';
import type { ApiResult } from './api';
import { BEAT_EVERY, LIST_EVERY, NOTIFY_ON, makeNotifier, type NotifyDeps } from './notify';

const SRC = path.join(__dirname, '..');

const walk = (dir: string, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
};

const strip = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('замок клиента', () => {
  /**
   * Пачка 1 держала уведомления на клиенте выключенными. Открыт замок 05.10.2026 вместе с адаптером Telegram и
   * флагом сервера `TRIBE_DELIVER` (решение владельца, docs/NOTIFY.md, раздел 12): отправлять или нет, решает
   * сервер. Прежний тест «выключенный модуль не трогает ни сети, ни страницы» снят вместе с замком: модуль
   * открыт и обязан говорить с сервером.
   */
  it('NOTIFY_ON открыт', () => {
    expect(NOTIFY_ON).toBe(true);
  });

  /**
   * Каждое место вызова стоит за `if (NOTIFY_ON)` той же строкой. Иначе выключенный модуль
   * всё равно считал бы черновики на каждом пульсе и лежал бы в сборке: сборщик выбрасывает
   * ветку под постоянной ложью, а не функцию, которая сама проверяет флаг.
   */
  it('каждый вызов снаружи — за if (NOTIFY_ON) той же строкой', () => {
    const calls: string[] = [];
    for (const f of walk(SRC)) {
      if (f.endsWith(path.join('net', 'notify.ts'))) continue;
      for (const line of strip(readFileSync(f, 'utf8')).split('\n')) {
        if (!/\bnotifyBoot\(|\bnotifyDrafts\(|\.notices\(\)|\bnew NotifyingWorld\(/.test(line)) continue;
        calls.push(path.relative(SRC, f).replace(/\\/g, '/'));
        expect(line, `${f}: вызов без замка`).toMatch(/^\s*if \(NOTIFY_ON\) /);
      }
    }
    // Запуск клиента, мир с черновиками и черновики после пульса.
    expect(calls.sort()).toEqual(['game/store.ts', 'world/store.ts', 'world/store.ts']);
  });
});

// ---------- Включённая логика ----------

const state = (over: Partial<NotifyState> = {}): NotifyState => ({
  now: 0,
  gen: 1,
  items: 0,
  away: null,
  prefs: { ...DEFAULT_PREFS, tz: 'Europe/Moscow' },
  chan: 'unknown',
  ...over,
});

const item = (key: string): NoticeItem => ({
  key,
  kind: 'siege-fall',
  fireAt: 100_000,
  until: 200_000,
  p: { from: 'Логово', fate: 'plunder', about: 200_000 },
});

function rig(over: Partial<NotifyDeps> = {}) {
  let now = 1_000_000;
  let visible = true;
  let leading = true;
  const timers: { at: number; fn: () => void }[] = [];
  const puts: { body: NotifyPut; keepalive: boolean }[] = [];
  let answer: ApiResult<NotifyState> = { ok: true, data: state() };
  const n = makeNotifier({
    put: async (body, keepalive) => {
      puts.push({ body, keepalive });
      return answer;
    },
    now: () => now,
    leading: () => leading,
    visible: () => visible,
    zone: () => 'Europe/Moscow',
    later: (fn, ms) => void timers.push({ at: now + ms, fn }),
    ...over,
  });
  const flushAsync = () => new Promise((r) => setTimeout(r, 0));
  return {
    n,
    puts,
    set: (o: { now?: number; visible?: boolean; leading?: boolean; answer?: ApiResult<NotifyState> }) => {
      if (o.now !== undefined) now = o.now;
      if (o.visible !== undefined) visible = o.visible;
      if (o.leading !== undefined) leading = o.leading;
      if (o.answer !== undefined) answer = o.answer;
    },
    tick: async (to: number) => {
      now = to;
      for (const t of timers.splice(0).filter((x) => x.at <= to)) t.fn();
      await flushAsync();
    },
    flushAsync,
  };
}

describe('клиент уведомлений: когда он говорит с сервером', () => {
  it('запуск — присутствие первым вызовом, и больше ничего', async () => {
    const r = rig();
    r.n.boot();
    await r.flushAsync();
    expect(r.puts).toEqual([{ body: { present: true }, keepalive: false }]);
  });

  it('новый список уходит сразу, тот же — не уходит второй раз', async () => {
    const r = rig();
    r.n.drafts([item('siege-fall:a')], 999_000);
    await r.flushAsync();
    expect(r.puts).toEqual([{ body: { items: [item('siege-fall:a')], computedAt: 999_000 }, keepalive: false }]);
    r.n.drafts([item('siege-fall:a')], 1_001_000);
    await r.flushAsync();
    expect(r.puts.length).toBe(1);
  });

  it('список не чаще раза в пять секунд: изменения за это время уходят одним запросом потом', async () => {
    const r = rig();
    r.n.drafts([item('siege-fall:a')], 0);
    await r.flushAsync();
    r.set({ now: 1_002_000 });
    r.n.drafts([item('siege-fall:b')], 0);
    r.n.drafts([item('siege-fall:c')], 0);
    await r.flushAsync();
    expect(r.puts.length).toBe(1);
    await r.tick(1_002_000 + LIST_EVERY);
    expect(r.puts.length).toBe(2);
    expect(r.puts[1].body.items).toEqual([item('siege-fall:c')]);
  });

  it('скрытие — список и «ушёл» одним запросом с keepalive', async () => {
    const r = rig();
    r.set({ visible: false });
    r.n.drafts([item('siege-fall:a')], 5);
    await r.flushAsync();
    // Пока страница не видна, список ждёт скрытия, а не уходит на каждом пульсе.
    expect(r.puts).toEqual([]);
    r.n.visibility();
    await r.flushAsync();
    expect(r.puts).toEqual([{ body: { present: false, items: [item('siege-fall:a')], computedAt: 5 }, keepalive: true }]);
  });

  it('скрытие через секунду после списка — «ушёл» уходит всё равно, без повторного списка', async () => {
    const r = rig();
    r.n.drafts([item('siege-fall:a')], 0);
    await r.flushAsync();
    r.set({ now: 1_001_000, visible: false });
    r.n.drafts([item('siege-fall:b')], 0);
    r.n.visibility();
    await r.flushAsync();
    expect(r.puts[1]).toEqual({ body: { present: false }, keepalive: true });
  });

  it('возвращение — «здесь»; раз в минуту — «здесь», только пока видна', async () => {
    const r = rig();
    r.n.visibility();
    await r.flushAsync();
    expect(r.puts[r.puts.length - 1]).toEqual({ body: { present: true }, keepalive: false });
    r.set({ now: 1_000_000 + BEAT_EVERY, visible: false });
    r.n.beat();
    await r.flushAsync();
    expect(r.puts.length).toBe(1);
    r.set({ visible: true });
    r.n.beat();
    await r.flushAsync();
    expect(r.puts.length).toBe(2);
  });

  it('не ведущая вкладка не говорит ничего', async () => {
    const r = rig();
    r.set({ leading: false });
    r.n.boot();
    r.n.drafts([item('siege-fall:a')], 0);
    r.n.visibility();
    r.n.beat();
    await r.flushAsync();
    expect(r.puts).toEqual([]);
  });

  it('пояс уходит один раз и только если на сервере другой — остальные настройки не трогаются', async () => {
    const r = rig();
    r.set({ answer: { ok: true, data: state({ prefs: { on: false, tz: '' } }) } });
    r.n.boot();
    await r.flushAsync();
    await r.flushAsync();
    expect(r.puts[1]).toEqual({ body: { prefs: { on: false, tz: 'Europe/Moscow' } }, keepalive: false });
    r.n.beat();
    await r.flushAsync();
    await r.flushAsync();
    expect(r.puts.filter((p) => p.body.prefs).length).toBe(1);
  });
});
