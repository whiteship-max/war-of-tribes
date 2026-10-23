// Вести покоев (docs/city_v3.md, ПК-1): одна дверь — журнал «Вестей». Партия настоящая (`createInitialState`, вести на
// стол — `sim/mail.raiseEvent`, летопись — `sim/log.log`), слова — в минуту рассказа, ключ и заголовок — те же, что у почты
// (`realm/dispatch`). Мир — минимальными видами (настоящий мир — в `court.test.ts`).
import { describe, expect, it } from 'vitest';
import { createInitialState } from '@/game/state';
import { raiseEvent, resolveEvent } from '@/game/sim/mail';
import { log } from '@/game/sim/log';
import { REVOLT_EVENT } from '@/game/data/stability';
import { eventDispatch } from '@/ui/realm/dispatch';
import { hungerLeft } from '@/ui/parts/hunger';
import type { GameState } from '@/game/types';
import type { Report, SiegeView } from '@/world/types';
import { byWeight, HERALD_KINDS, says, tell, tidingsOf, WEIGHT, type CourtSource, type Tiding } from './tidings';

const W = 9_000_000;
const src = (s: GameState, over: Partial<CourtSource> = {}): CourtSource => ({ s, letters: [], siege: null, reports: [], marching: [], world: W, ready: true, ...over });
const dated = (list: ReturnType<typeof tidingsOf>): Tiding[] => list.map((t) => ({ ...t, at: t.at ?? 0 }));
const siege = (since: number): SiegeView => ({ byId: 's1', byName: 'Волчье логово', since, starvesAt: W + 3_600_000, garrison: 10, foodAtStart: 100 }) as SiegeView;
const report = (id: string, at: number, extra: Partial<Report> = {}): Report => ({ id, at, kind: 'defense', title: 'Набег отбит у ворот', won: true, enemyPower: 40, battle: null, ...extra }) as Report;

describe('вести покоев: одна дверь (ПК-1)', () => {
  it('весть стола — тот же ключ и тот же заголовок, что в «Вестях»; бедствие державы (комета) — гонцу, дверь — это донесение', () => {
    const s = createInitialState(7);
    s.time = 500;
    expect(raiseEvent(s, 'cr_comet')).toBe(true);
    const [t] = dated(tidingsOf(src(s)));
    const d = eventDispatch(s, s.inbox[0], 0)!;
    expect(t.kind).toBe('disaster');
    expect(HERALD_KINDS.has(t.kind)).toBe(true);
    expect(t.id, 'ключ — ключ почты').toBe(d.key);
    expect(t.clock).toBe('game');
    expect(t.at, 'минута — минута прихода на стол').toBe(500);
    const x = tell(t, src(s))!;
    expect(x.text, 'слова — заголовком почты').toBe(`${d.title} — ждёт твоего слова.`);
    expect(x.door).toEqual({ to: 'mail', key: d.key });
    // Ответили в «Вестях» — сказать нечего.
    expect(resolveEvent(s, 0).error).toBeNull();
    expect(tell(t, src(s))).toBeNull();
  });

  it('мятеж — к стабильности; утих — исходом, а не старым «встали»', () => {
    const s = createInitialState(7);
    expect(raiseEvent(s, REVOLT_EVENT.folk)).toBe(true);
    const [t] = dated(tidingsOf(src(s)));
    expect(t.kind).toBe('revolt');
    expect(tell(t, src(s))?.door).toEqual({ to: 'stab' });
    expect(tell(t, src(s))?.outcome).toBe(false);
    s.inbox = [];
    delete s.stab?.revolt;
    expect(tell(t, src(s))).toMatchObject({ text: 'Мятеж утих: город снова работает.', outcome: true });
  });

  it('кончился хлеб: журнал его не датирует — минута за двором (`real`); завезли — исход числом склада', () => {
    const s = createInitialState(7);
    s.resources.food = 0;
    const raw = tidingsOf(src(s)).find((t) => t.kind === 'out')!;
    expect(raw).toMatchObject({ id: 'out:food', clock: 'real', at: null });
    const t = { ...raw, at: 1 } as Tiding;
    expect(tell(t, src(s))).toMatchObject({ text: 'Хлеб кончился: амбары пусты.', door: { to: 'store' }, outcome: false });
    s.resources.food = 50.7;
    expect(tidingsOf(src(s)).some((x) => x.kind === 'out'), 'хлеб есть — вести нет').toBe(false);
    expect(tell(t, src(s))).toMatchObject({ text: 'Хлеб снова есть: еды на складе — 50.', outcome: true });
  });

  it('осада: пока стоит — срок хлеба той же дверью часов голода, что окно осады (`hungerLeft`); сняли — «сняли», а с донесением — его словами', () => {
    const s = createInitialState(7);
    const [t] = dated(tidingsOf(src(s, { siege: siege(W - 1000) })));
    expect(t).toMatchObject({ kind: 'siege', clock: 'world', at: W - 1000 });
    expect(tell(t, src(s, { siege: siege(W - 1000) }))?.text).toBe(`«Волчье логово» стоит лагерем под стенами. Хлеба в городе на ${hungerLeft(W + 3_600_000, W)}.`);
    expect(tell(t, src(s))).toMatchObject({ text: 'Осаду сняли: под стенами больше никого.', outcome: true });
    const r = report('fell', W, { siege: {} as Report['siege'], title: 'Осада снята вылазкой' });
    expect(tell(t, src(s, { reports: [report('old', W - 5000), r] }))).toMatchObject({ text: 'Осада кончилась. Осада снята вылазкой. Наши взяли верх.', door: { to: 'report', id: 'fell' }, outcome: true });
  });

  it('стройка из летописи — та же строка; важность: осада, набег, мятеж выше боя и стройки', () => {
    const s = createInitialState(7);
    s.time = 100;
    log(s, 'Достроили: кузница, ур. 3.', 'good', undefined, 'build');
    const b = dated(tidingsOf(src(s))).find((t) => t.kind === 'build')!;
    expect(tell(b, src(s))?.text).toBe('Достроили: кузница, ур. 3.');
    // Летопись читается до отметки: строка не новее неё не берётся.
    expect(tidingsOf(src(s), 100).some((t) => t.kind === 'build')).toBe(false);
    const kinds = (['build', 'battle', 'siege', 'revolt', 'march'] as const).map((k, i) => ({ id: k, kind: k, clock: 'game' as const, at: i, ref: '' }));
    expect([...kinds].sort(byWeight).map((t) => t.kind)).toEqual(['siege', 'march', 'revolt', 'battle', 'build']);
    expect(WEIGHT.build).toBeLessThan(WEIGHT.ask);
  });

  it('обращение — по вере, с большой буквы в начале фразы', () => {
    expect(says('{T}, беда.', 'orthodox')).toBe('Княже, беда.');
    expect(says('Слушай, {t}.', 'catholic')).toBe('Слушай, сир.');
  });
});
