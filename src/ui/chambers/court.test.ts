// Гонец и советник в покоях (docs/city_v3.md, ПК-1) — сценами, без WebGL, на настоящей партии (`createInitialState`, вести на
// стол — `sim/mail.raiseEvent`) и настоящем мире (`LocalWorld`, набег с письмом). Советник: при входе, только после отлучки
// дольше 15 мин и с важным; до трёх вестей по важности, ни одной дважды; по часам не приходит. Гонец: только с вестью
// позже входа — тихий стук, «Впустить» / «Позже»; «Позже» — при следующем входе первым; устаревшее — исходом или молча.
// Мир — на шкале правил мира (день в минуту), как все тесты писем: при ней набег сида 43 приходит за четыре часа.
import '@/game/pace.minute';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { ChambersRoom } from '@/render/chambers/room';
import { DEFAULT_ARMS } from '@/heraldry/arms';
import { HALF } from '@/render/chambers/plan';
import { ADVISOR_POST, type Who, type Why } from '@/render/chambers/life';
import { LIFE_MIX } from '@/render/chambers/voices';
import { useWorld, worldNow } from '@/world/store';
import { useGame } from '@/game/store';
import { useRealm } from '@/ui/realm/open';
import { createInitialState } from '@/game/state';
import { raiseEvent, resolveEvent } from '@/game/sim/mail';
import { log } from '@/game/sim/log';
import { REVOLT_EVENT } from '@/game/data/stability';
import { eventDispatch, letterDispatch } from '@/ui/realm/dispatch';
import { LocalWorld } from '@/world/local/LocalWorld';
import { shieldVillagers } from '@/world/lairs';
import { realDue } from '@/ui/parts/wait';
import type { GameState } from '@/game/types';
import type { LetterView, PlayerProfile, Report, SiegeView } from '@/world/types';
import { AWAY_MS, Court, freshCourt, REPORT_MAX, type CourtHost, type CourtMemory } from './court';
import type { CourtSource, Moment, NewsDoor } from './tidings';
import { useChambers } from './open';
import { __chambers } from './Chambers';

(globalThis as { window?: unknown }).window ??= {};

const KEEP = { x: -4, z: -147, base: 16, height: 30, size: 13 };
const PHONE = { left: 0, top: 0, width: 390, height: 844 };
const SKY = {
  daylight: 1,
  night: 0,
  nightK: 0,
  sky: new THREE.Color(0.6, 0.7, 0.85),
  haze: new THREE.Color(0.7, 0.75, 0.8),
  sunDir: new THREE.Vector3(-0.4, 0.5, 0.77).normalize(),
  sun: new THREE.Color(2, 1.6, 1.1),
  hemi: new THREE.Color(0.6, 0.65, 0.7),
  rain: 0,
  snow: 0,
  mist: 0,
  cloud: 0,
  wind: 0.3,
  windX: 1,
  windZ: 0,
  flash: 0,
};

function phoneRoom(): ChambersRoom {
  const room = new ChambersRoom(KEEP, DEFAULT_ARMS, 'low', () => null);
  room.camera.aspect = PHONE.width / PHONE.height;
  room.camera.updateProjectionMatrix();
  room.setRect(PHONE);
  return room;
}

let clock = 0;
function run(room: ChambersRoom, s: number, until?: () => boolean): boolean {
  for (let i = 0; i < Math.round(s * 60); i++) {
    clock += 1 / 60;
    room.frame(1 / 60, clock, SKY);
    if (until?.()) return true;
  }
  return !until;
}

const talking = (room: ChambersRoom, who: Who, why?: Why) => (): boolean => {
  const t = room.life.view().talk;
  return !!t && t.who === who && (!why || t.why === why);
};

const MIN = 60_000;
const T0 = { game: 10_000, world: 50_000_000, real: 1_000_000_000 };

/** Двор на настоящей партии: часы и мир правятся руками, двери пишутся в список. */
function court(room: ChambersRoom, s: GameState, mem: CourtMemory = freshCourt()) {
  const opened: NewsDoor[] = [];
  const st = { s, mem, now: { ...T0 } as Moment, letters: [] as LetterView[], siege: null as SiegeView | null, reports: [] as Report[] };
  const host: CourtHost = {
    source: (): CourtSource => ({ s: st.s, letters: st.letters, siege: st.siege, reports: st.reports, marching: [], world: st.now.world, ready: true }),
    now: () => ({ ...st.now }),
    memory: () => st.mem,
    remember: (m) => (st.mem = m),
    open: (d) => opened.push(d),
  };
  return { c: new Court(room.life, host), opened, st };
}

/** Часы вперёд на `ms` настоящих: игровые — тридцать раз быстрее (шкала), мир — как настоящие. */
function tick(st: { now: Moment; s: GameState }, ms: number): void {
  st.now = { real: st.now.real + ms, world: st.now.world + ms, game: st.now.game + ms / 1000 / 30 };
  st.s.time = st.now.game;
}

/** Память после выхода из покоев `ago` назад (настоящие мс). */
const leftAgo = (ago: number): CourtMemory => ({ ...freshCourt(), seenAt: T0.real - ago, out: { game: T0.game - ago / 30_000, world: T0.world - ago, real: T0.real - ago } });

/** Партия, на чей стол за отлучку легли вести: что лежит, решает `defs`; минута — посреди отлучки. */
function partyWith(defs: string[], at = T0.game - 1): GameState {
  const s = createInitialState(7);
  s.time = at;
  for (const d of defs) expect(raiseEvent(s, d), d).toBe(true);
  s.time = T0.game;
  return s;
}

describe('советник (ПК-1)', () => {
  it('отлучка 14 мин — стоит у стола, кивает, молчит; 16 мин — встречает с докладом (точки — по обе стороны границы 15 мин)', async () => {
    for (const [away, speaks] of [
      [14 * MIN, false],
      [16 * MIN, true],
    ] as const) {
      expect(away < AWAY_MS, 'точка с той стороны границы, где ей положено').toBe(!speaks);
      const room = phoneRoom();
      await room.life.advisorReady;
      const { c } = court(room, partyWith(['cr_comet']), leftAgo(away));
      c.enter();
      expect(c.report !== null, `отлучка ${away / MIN} мин`).toBe(speaks);
      run(room, 3);
      const a = room.life.personOf('advisor')!;
      expect(Math.hypot(a.x - ADVISOR_POST.x, a.z - ADVISOR_POST.z), 'у стола').toBeLessThan(0.05);
      expect(talking(room, 'advisor', 'report')(), 'докладывает ли').toBe(speaks);
      room.dispose();
    }
  });

  it('долгая отлучка без важного (одна стройка) — молчит; первый вход вовсе (не с чем сравнить) — тоже', async () => {
    const room = phoneRoom();
    await room.life.advisorReady;
    const s = createInitialState(7);
    s.time = T0.game - 1;
    log(s, 'Достроили: кузница, ур. 3.', 'good', undefined, 'build');
    s.time = T0.game;
    const a = court(room, s, leftAgo(3 * 60 * MIN));
    a.c.enter();
    expect(a.c.report, 'стройка — не повод встречать').toBeNull();
    const b = court(room, partyWith(['cr_comet']));
    b.c.enter();
    expect(b.c.report, 'первый вход: отлучки не мерили').toBeNull();
    room.dispose();
  });

  it('доклад — до трёх вестей по важности, касание — следующая; сказанное не повторяется, даже если выйти, не попрощавшись', async () => {
    const room = phoneRoom();
    await room.life.advisorReady;
    const s = partyWith(['cr_comet', REVOLT_EVENT.folk, 'cr_wedding']);
    s.resources.food = 0;
    const { c, st, opened } = court(room, s, leftAgo(60 * MIN));
    st.siege = { byId: 's1', byName: 'Волчье логово', since: T0.world - 5 * MIN, starvesAt: T0.world + 60 * MIN, garrison: 5, foodAtStart: 0 } as SiegeView;
    c.enter();
    const lines = c.report!.lines;
    expect(lines.length).toBe(REPORT_MAX);
    // Осада (9), мятеж (7), а из равных бедствия (комета) и «кончился хлеб» — новее; свадьба (ждёт ответа) — за бортом.
    expect(lines.map((l) => l.t.kind)).toEqual(['siege', 'revolt', 'out']);
    expect(run(room, 10, talking(room, 'advisor', 'report'))).toBe(true);
    c.openLine();
    expect(opened, '«Открыть» — место первой вести').toEqual([{ to: 'siege' }]);
    expect(c.report!.at, 'и дальше — следующая').toBe(1);
    c.next();
    c.next();
    expect(c.report, 'три сказаны — доклад кончился').toBeNull();
    expect(room.life.view().talk, 'замолчал').toBeNull();
    expect(room.life.personOf('advisor'), 'и стоит у стола').not.toBeNull();
    // Ушёл, не попрощавшись (аппку убили: выхода не было), и вернулся через час: что сказано — не повторяется.
    tick(st, 60 * MIN);
    st.mem.out = { ...T0, game: T0.game - 10, world: T0.world - 10 * MIN, real: T0.real - 10 * MIN };
    const room2 = phoneRoom();
    await room2.life.advisorReady;
    const again = new Court(room2.life, { source: () => ({ s, letters: [], siege: st.siege, reports: [], marching: [], world: st.now.world, ready: true }), now: () => st.now, memory: () => st.mem, remember: (m) => (st.mem = m), open: () => undefined });
    again.enter();
    const told = new Set(lines.map((l) => l.t.id));
    expect((again.report?.lines ?? []).filter((l) => told.has(l.t.id)), 'ни одной дважды').toEqual([]);
    expect(again.report?.lines.map((l) => l.t.kind), 'досказал отложенное за бортом').toEqual(['disaster', 'ask']);
    room.dispose();
    room2.dispose();
  });

  it('по часам не приходит: десять минут в покоях без вестей — ни советника с докладом, ни гонца; в двери двора нет таймеров', async () => {
    const room = phoneRoom();
    await room.life.advisorReady;
    await room.life.heraldReady;
    const { c } = court(room, createInitialState(7), leftAgo(60 * MIN));
    c.enter();
    for (let i = 0; i < 20; i++) {
      run(room, 30);
      c.look();
    }
    expect(c.report).toBeNull();
    expect(c.knocking).toBeNull();
    expect(room.life.view().talk).toBeNull();
    expect(room.life.personOf('herald')).toBeNull();
    for (const f of ['court.ts', 'tidings.ts']) expect(readFileSync(new URL(`./${f}`, import.meta.url), 'utf8'), f).not.toMatch(/setTimeout|setInterval|requestAnimationFrame/);
    // Слой покоев зовёт двор только переменой журнала, входом и выходом: в его редкой проверке (400 мс) двора нет.
    const layer = readFileSync(new URL('./Chambers.tsx', import.meta.url), 'utf8');
    const tryRise = layer.slice(layer.indexOf('const tryRise'), layer.indexOf('t = window.setInterval(tryRise'));
    expect(tryRise).not.toMatch(/court/);
    room.dispose();
  });
});

describe('гонец (ПК-1)', () => {
  it('весть до входа — не его (и приехавшая в стор после входа — тоже); весть после входа — тихий стук, «Впустить», входит, кланяется, рассказывает', async () => {
    const room = phoneRoom();
    await room.life.heraldReady;
    const cues: string[] = [];
    room.onLifeCue = (c) => cues.push(c);
    const s = partyWith(['cr_plague_near']);
    const { c, st, opened } = court(room, s, leftAgo(5 * MIN));
    c.enter();
    c.look();
    expect(c.knocking, 'мор у ворот лёг до входа — гонец с ним не идёт').toBeNull();
    // Донесения и письма приехали в стор после входа (причина 1): минута их — до входа, и гонец молчит.
    st.letters = [{ id: 'old', kind: 'raid', at: T0.world - MIN, until: T0.world + 9 * MIN, fromId: 's1', fromName: 'Волчье логово', cost: {}, title: 'Набег', body: '', from: null, choices: [], seconds: 1, silence: '' } as LetterView];
    c.look();
    expect(c.knocking).toBeNull();
    // После входа — комета.
    tick(st, MIN);
    expect(raiseEvent(s, 'cr_comet')).toBe(true);
    c.look();
    expect(c.knocking?.map((t) => t.kind)).toEqual(['disaster']);
    run(room, 1.5);
    expect(cues.filter((x) => x === 'knockFar').length, 'три тихих удара').toBe(3);
    expect(LIFE_MIX.knockFar, 'тише шагов и двери').toBeLessThan(Math.min(LIFE_MIX.doorOpen, LIFE_MIX.stepFolk, LIFE_MIX.knock));
    expect(room.life.personOf('herald'), 'стук — только стук: сам не входит').toBeNull();
    expect(room.life.attention(), 'и глаз не уводит').toBeNull();
    c.admit();
    expect(run(room, 30, talking(room, 'herald', 'news')), 'вошёл и говорит').toBe(true);
    expect(room.life.personOf('herald')!.z, 'в покоях').toBeGreaterThan(-HALF);
    const lines = c.heraldLines();
    const d = eventDispatch(s, s.inbox.find((e) => e.defId === 'cr_comet')!, 0)!;
    expect(lines.map((l) => l.text), 'слова — заголовок «Вестей»').toEqual([`${d.title} — ждёт твоего слова.`]);
    c.heraldDone(lines[0].door);
    expect(opened, '«Открыть» — эта весть в «Вестях»').toEqual([{ to: 'mail', key: d.key }]);
    expect(run(room, 30, () => room.life.personOf('herald') === null), 'ушёл').toBe(true);
    room.dispose();
  });

  it('«Позже» — весть ждёт; при следующем входе гонец первым, советник — после него и её не повторяет', async () => {
    const room = phoneRoom();
    await room.life.heraldReady;
    await room.life.advisorReady;
    const s = createInitialState(7);
    const { c, st } = court(room, s, leftAgo(5 * MIN));
    c.enter();
    tick(st, MIN);
    expect(raiseEvent(s, REVOLT_EVENT.folk)).toBe(true);
    c.look();
    expect(c.knocking?.length).toBe(1);
    const id = c.knocking![0].id;
    c.postpone();
    expect(c.knocking).toBeNull();
    expect(st.mem.later.map((t) => t.id)).toEqual([id]);
    c.presence();
    // Через полчаса за столом ещё и комета — вход: стучит гонец (с мятежом), советник ждёт у стола.
    tick(st, 30 * MIN);
    expect(raiseEvent(s, 'cr_comet')).toBe(true);
    const room2 = phoneRoom();
    await room2.life.heraldReady;
    await room2.life.advisorReady;
    const again = new Court(room2.life, { source: () => ({ s, letters: [], siege: null, reports: [], marching: [], world: st.now.world, ready: true }), now: () => st.now, memory: () => st.mem, remember: (m) => (st.mem = m), open: () => undefined });
    again.enter();
    expect(again.knocking?.map((t) => t.id), 'гонец первым — с отложенным').toEqual([id]);
    expect(again.report, 'советник ждёт гонца').toBeNull();
    again.admit();
    expect(run(room2, 30, talking(room2, 'herald', 'news'))).toBe(true);
    again.heraldDone();
    const rep = again.report!.lines;
    expect(rep.map((l) => l.t.kind), 'советник — после, о комете').toEqual(['disaster']);
    expect(rep.some((l) => l.t.id === id), 'мятеж не повторяет').toBe(false);
    expect(st.mem.later).toEqual([]);
    room.dispose();
    room2.dispose();
  });

  it('устарела до рассказа: осаду сняли — исход; на весть стола ответили — не приходит вовсе', async () => {
    const room = phoneRoom();
    await room.life.heraldReady;
    const s = createInitialState(7);
    const { c, st } = court(room, s, leftAgo(5 * MIN));
    c.enter();
    tick(st, MIN);
    st.siege = { byId: 's1', byName: 'Волчье логово', since: st.now.world, starvesAt: st.now.world + 60 * MIN, garrison: 5, foodAtStart: 0 } as SiegeView;
    c.look();
    expect(c.knocking?.map((t) => t.kind)).toEqual(['siege']);
    st.siege = null;
    c.look();
    c.admit();
    expect(run(room, 30, talking(room, 'herald', 'news'))).toBe(true);
    expect(c.heraldLines().map((l) => [l.text, l.outcome])).toEqual([['Осаду сняли: под стенами больше никого.', true]]);
    c.heraldDone();
    expect(run(room, 30, () => room.life.personOf('herald') === null)).toBe(true);
    // Комета легла и на неё ответили в «Вестях», пока гонец стоял за дверью: сказать нечего — стука больше нет.
    tick(st, MIN);
    expect(raiseEvent(s, 'cr_comet')).toBe(true);
    c.look();
    expect(c.knocking?.length).toBe(1);
    expect(resolveEvent(s, 0).error).toBeNull();
    c.look();
    expect(c.knocking).toBeNull();
    room.dispose();
  });

  it('настоящий мир: письмо о набеге после входа — гонец, слова — те же, что у «Вестей»; набег прошёл — исход донесением или молчание', async () => {
    let now = 1_700_000_000_000;
    const world = new LocalWorld({ seed: 43, now: () => now, storage: null });
    // Профиль — как в тестах писем мира (`world/letters.test.ts`): выше защиты новичка, набеги по нему идут.
    const profile: PlayerProfile = { name: 'Тест', pop: shieldVillagers(0.1), defense: 30, units: { warrior: 10, scout: 4 }, stock: { food: 4000, wood: 4000, stone: 4000, hides: 4000, charcoal: 4000, copper: 4000, iron: 4000 }, stash: 0 };
    const room = phoneRoom();
    await room.life.heraldReady;
    const s = createInitialState(7);
    const { c, st } = court(room, s, leftAgo(5 * MIN));
    const sync = async (): Promise<void> => {
      await world.sync(profile);
      st.letters = await world.letters();
      st.reports = await world.reports();
      st.now = { ...st.now, world: now };
    };
    st.now = { ...st.now, world: now };
    c.enter();
    let raid: LetterView | undefined;
    for (let m = 1; m <= 240 && !raid; m++) {
      now += MIN;
      await sync();
      c.look();
      raid = st.letters.find((l) => l.kind === 'raid');
    }
    expect(raid, 'за четыре часа набег случается').toBeTruthy();
    expect(raid!.at, 'письмо после входа').toBeGreaterThan(c.entry!.world);
    expect(c.knocking?.map((t) => t.id)).toEqual([letterDispatch(raid!, now).key]);
    const [x] = c.tellings(c.knocking!);
    // Срок — тот же, что «До набега» у письма в «Вестях» (`letterDispatch.left`), и той же дверью слов.
    expect(x.text).toBe(`«${raid!.fromName}» идёт на нас набегом — у ворот через ${realDue(letterDispatch(raid!, now).left!)}.`);
    expect(x.door).toEqual({ to: 'map' });
    // Набег дошёл: письма нет; есть донесение обороны после письма — исход им, нет — гонцу сказать нечего.
    const t = c.knocking![0];
    for (let m = 1; m <= 240 && st.letters.some((l) => l.id === raid!.id); m++) {
      now += MIN;
      await sync();
    }
    expect(st.letters.some((l) => l.id === raid!.id), 'набег прошёл').toBe(false);
    const after = c.tellings([t]);
    const fight = st.reports.filter((r) => r.kind === 'defense' && r.at >= raid!.at).sort((a, b) => a.at - b.at)[0];
    if (fight) expect(after).toEqual([{ t, text: `Набег, что шёл на нас, кончился. ${fight.title}. ${fight.won ? 'Наши взяли верх.' : 'Худо вышло.'}`, door: { to: 'report', id: fight.id }, outcome: true }]);
    else expect(after).toEqual([]);
    room.dispose();
  });
});

describe('гонец в слое покоев (ПК-1)', () => {
  afterEach(() => {
    __chambers.fall();
    useChambers.setState({ open: false });
    useRealm.setState({ open: false, mail: null });
    useWorld.setState({ letters: [] });
  });

  it('письмо о набеге после входа — стук; «Впустить» — гонец входит; «Открыть» — карта поверх покоев, покои на месте', async () => {
    useWorld.setState({ letters: [], reports: [], siege: null, camp: null });
    useGame.setState({ sheet: null, mapOpen: false });
    __chambers.rise(fakeScene() as never);
    const room = __chambers.live()!;
    await room.life.heraldReady;
    // Вход — когда донесения свежие (`loadReports`): дождаться его.
    await vi.waitFor(() => expect(__chambers.court()?.entry).not.toBeNull());
    const c = __chambers.court()!;
    useWorld.setState({ letters: [{ id: 'r9', kind: 'raid', at: worldNow() + 1000, until: worldNow() + 9 * MIN, fromId: 's1', fromName: 'Волчье логово', cost: {}, title: 'Набег', body: '', from: null, choices: [], seconds: 1, silence: '' } as LetterView] });
    expect(c.knocking?.length, 'стук').toBe(1);
    c.admit();
    expect(run(room, 30, talking(room, 'herald', 'news'))).toBe(true);
    c.heraldDone(c.heraldLines()[0].door);
    expect(useGame.getState().mapOpen, 'карта открыта').toBe(true);
    expect(__chambers.live(), 'покои на месте — закрыл карту, и снова в покоях').toBe(room);
  });
});

function fakeScene() {
  return {
    quality: 'low' as const,
    keep: () => ({ kind: 'keep', x: -4, z: -147, out: -Math.PI / 2, size: 13, height: 30, base: 16, seed: 1 }),
    cityShare: () => null,
    enterInside: vi.fn(() => true),
    leaveInside: vi.fn(),
  };
}
