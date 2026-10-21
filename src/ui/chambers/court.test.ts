// Гонец и советник в покоях (docs/city_v3.md, Г-10) — сценами, числами, без WebGL: важная весть, пока правитель в покоях, —
// стук, гонец поднимается, входит, кланяется, протягивает письмо; касание письма открывает эту весть, гонец уходит. После
// отлучки советник ждёт у стола и докладывает по летописи; строки ведут в донесения; «Ступай» — уходит; второй раз о том же
// не докладывает. Слой покоев целиком (`Chambers.rise`) — той же дверью «Вестей».
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { ChambersRoom } from '@/render/chambers/room';
import { DEFAULT_ARMS } from '@/heraldry/arms';
import { HALF } from '@/render/chambers/plan';
import { ADVISOR_POST, type Who, type Why } from '@/render/chambers/life';
import { useWorld } from '@/world/store';
import { useGame } from '@/game/store';
import { useRealm } from '@/ui/realm/open';
import { letterKey } from '@/ui/realm/unread';
import { chronEvents } from '@/ui/realm/annals';
import type { LetterView, Report } from '@/world/types';
import type { LogEntry } from '@/game/types';
import { Court, type CourtHost } from './court';
import { ADVISOR_AWAY, freshAdvisor, type AdvisorMemory, type NewsDoor, type WorldNews } from './tidings';
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

const NOW = 5_000_000;
const raid = (id: string): LetterView => ({ id, kind: 'raid', at: 0, until: NOW + 9e6, fromId: 's1', fromName: 'Волчье логово', cost: {}, title: 'Набег', icon: '', body: '', from: null, choices: [], seconds: 100, silence: '' }) as LetterView;
const fight = (id: string): Report => ({ id, at: 0, kind: 'defense', title: 'Набег отбит у ворот', target: { id: 's1', name: 'Х', x: 0, y: 0 }, won: true, sent: {}, lost: {}, enemyPower: 40, enemyLost: 30, loot: null, intel: null, battle: null, text: '', read: false }) as Report;

/** Двор с подделкой мира: мир правится руками, двери пишутся в список, «потом» — сразу. */
function court(room: ChambersRoom, w: WorldNews, mem: AdvisorMemory = freshAdvisor(), log: LogEntry[] = [], time = 10_000) {
  const opened: NewsDoor[] = [];
  const state = { w, mem };
  const host: CourtHost = {
    world: () => state.w,
    advisor: () => ({ events: chronEvents(log, state.w.reports), time, gold: 900, inbox: 0, world: state.w }),
    memory: () => state.mem,
    remember: (m) => (state.mem = m),
    open: (d) => opened.push(d),
    later: (f) => f(),
  };
  return { c: new Court(room.life, host), opened, state };
}

const empty = (): WorldNews => ({ letters: [], siege: null, camp: null, reports: [], now: NOW });

describe('покои: гонец с вестью (Г-10)', () => {
  it('важная весть в покоях — стук, гонец поднимается, входит, кланяется и протягивает письмо; касание письма открывает эту весть, гонец уходит', async () => {
    const room = phoneRoom();
    await room.life.heraldReady;
    const cues: string[] = [];
    room.onLifeCue = (c) => cues.push(c);
    const { c, opened, state } = court(room, empty());
    // Весть, что лежала при входе, гонец не несёт.
    expect(c.waiting).toBe(0);
    run(room, 1);
    expect(room.life.personOf('herald'), 'до вести гонца нет').toBeNull();
    state.w = { ...empty(), letters: [raid('r1')] };
    c.look();
    expect(run(room, 30, talking(room, 'herald', 'news')), 'гонец вошёл и ждёт').toBe(true);
    expect(cues.filter((x) => x === 'knock').length, 'три удара в дверь').toBe(3);
    expect(cues).toContain('doorOpen');
    const h = room.life.personOf('herald')!;
    expect(h.z, 'гонец в покоях').toBeGreaterThan(-HALF);
    expect(h.carry).toBe('letter');
    expect(room.life.view().letter, 'письмо протянуто').toBe(true);
    expect(c.carrying?.key).toBe(letterKey('r1'));
    // Письмо — в протянутой правой руке, перед грудью, и касание по нему на экране попадает в письмо.
    run(room, 0.5);
    const at = room.life.letterAt()!;
    expect(at, 'письмо видно').not.toBeNull();
    const sp = at.clone().project(room.camera);
    const x = ((sp.x + 1) / 2) * PHONE.width;
    const y = ((1 - sp.y) / 2) * PHONE.height;
    expect(sp.z < 1 && x > 0 && x < PHONE.width && y > 0 && y < PHONE.height, `письмо на экране (${x.toFixed(0)}, ${y.toFixed(0)})`).toBe(true);
    const aim = room.pickAt(x, y);
    expect(aim).toEqual({ kind: 'letter' });
    room.touch(aim);
    expect(opened, 'открылась эта весть — письмо о набеге в «Вестях»').toEqual([{ to: 'mail', key: letterKey('r1') }]);
    expect(cues).toContain('letter');
    expect(room.life.view().talk, 'гонец не ждёт слова').toBeNull();
    expect(run(room, 30, () => room.life.personOf('herald') === null), 'гонец ушёл').toBe(true);
    expect(cues, 'затворил дверь').toContain('doorShut');
    expect(room.life.holdsLegs).toBe(false);
    room.dispose();
  });

  it('вести одна за другой: второй гонец ждёт, пока уйдёт первый; «Позже» — уходит без письма, весть остаётся в «Вестях»', async () => {
    const room = phoneRoom();
    await room.life.heraldReady;
    const { c, opened, state } = court(room, empty());
    state.w = { ...empty(), letters: [raid('r1')], reports: [fight('b1')] };
    c.look();
    expect(run(room, 30, talking(room, 'herald', 'news'))).toBe(true);
    // Набег — срочнее итога боя: первым несут его.
    expect(c.carrying?.key).toBe(letterKey('r1'));
    expect(c.waiting).toBe(1);
    c.decline();
    expect(opened).toEqual([]);
    expect(run(room, 30, () => room.life.personOf('herald') === null), 'ушёл без письма').toBe(true);
    // Гонца зовут снова (слой покоев зовёт раз в 400 мс): пришёл со вторым.
    expect(run(room, 40, () => (c.call(), talking(room, 'herald', 'news')())), 'второй гонец').toBe(true);
    expect(c.carrying?.key).toBe('report:b1');
    room.life.takeLetter();
    expect(opened).toEqual([{ to: 'report', id: 'b1' }]);
    room.dispose();
  });

  it('пока идёт разговор — гонец ждёт за дверью, разговор кончился — входит', async () => {
    const room = phoneRoom();
    await room.life.heraldReady;
    const { c, state } = court(room, empty());
    room.life.stage({ who: 'servant', talk: true });
    state.w = { ...empty(), letters: [raid('r1')] };
    c.look();
    run(room, 3);
    expect(room.life.personOf('herald'), 'не вошёл посреди разговора').toBeNull();
    room.life.order('dismiss');
    expect(run(room, 40, () => (c.call(), talking(room, 'herald', 'news')())), 'вошёл, когда слуга ушёл').toBe(true);
    room.dispose();
  });
});

describe('покои: советник с докладом (Г-10)', () => {
  const T = 10_000;
  const log: LogEntry[] = [
    { at: T - 10, text: 'Набег «Волчьего логова» отбит', kind: 'good', ref: 'b1' },
    { at: T - 30, text: 'Кузница поднялась до 3-го уровня', kind: 'good', topic: 'build' },
  ];

  it('после отлучки советник ждёт у стола, кланяется и докладывает по летописи; строка ведёт в своё донесение; «Ступай» — уходит; второй раз о том же не докладывает', () => {
    const room = phoneRoom();
    const { c, opened, state } = court(room, { ...empty(), reports: [fight('b1')] }, { at: T - ADVISOR_AWAY, gold: 700, told: [] }, log, T);
    expect(c.greet(), 'есть что доложить').toBe(true);
    const a = room.life.personOf('advisor')!;
    expect(Math.hypot(a.x - ADVISOR_POST.x, a.z - ADVISOR_POST.z), 'у стола').toBeLessThan(0.05);
    expect(a.carry).toBe('scroll');
    expect(run(room, 10, talking(room, 'advisor', 'report')), 'кланяется и докладывает').toBe(true);
    expect(room.life.holdsLegs, 'пока докладывает — слушают стоя').toBe(true);
    const lines = c.report!.lines;
    const battle = lines.find((l) => l.text === 'Набег «Волчьего логова» отбит')!;
    expect(battle.door).toEqual({ to: 'report', id: 'b1' });
    expect(lines.find((l) => l.key === 'gold')?.text).toBe('Казна: прибыло 200 золота, теперь 900.');
    c.openLine(battle.key);
    expect(opened).toEqual([{ to: 'report', id: 'b1' }]);
    expect(c.report!.opened.has(battle.key), 'строка прочитана').toBe(true);
    // Советник ждёт дальше, пока не скажут «Ступай».
    expect(room.life.personOf('advisor')).not.toBeNull();
    c.dismiss();
    expect(run(room, 40, () => room.life.personOf('advisor') === null), 'ушёл').toBe(true);
    expect(room.life.holdsLegs).toBe(false);
    // Память — с этой минуты: тот же вход ещё раз — советника нет.
    expect(state.mem.at).toBe(T);
    const room2 = phoneRoom();
    const again = new Court(room2.life, { world: () => state.w, advisor: () => ({ events: chronEvents(log, state.w.reports), time: T + 10, gold: 900, inbox: 0, world: state.w }), memory: () => state.mem, remember: () => undefined, open: () => undefined, later: (f) => f() });
    expect(again.greet()).toBe(false);
    expect(room2.life.personOf('advisor')).toBeNull();
    room.dispose();
    room2.dispose();
  });

  it('без отлучки советника нет; отлучка без событий — тоже', () => {
    const room = phoneRoom();
    expect(court(room, empty(), { at: T - ADVISOR_AWAY + 1, gold: 900, told: [] }, log, T).c.greet()).toBe(false);
    expect(court(room, empty(), { at: T - ADVISOR_AWAY, gold: 900, told: [] }, [], T).c.greet()).toBe(false);
    expect(room.life.personOf('advisor')).toBeNull();
    room.dispose();
  });
});

describe('покои: гонец в слое покоев (Г-10)', () => {
  afterEach(() => {
    __chambers.fall();
    useChambers.setState({ open: false });
    useRealm.setState({ open: false, mail: null });
    useWorld.setState({ letters: [] });
  });

  it('письмо о набеге пришло, пока правитель в покоях, — гонец; письмо открывает это письмо в «Вестях» поверх покоев', async () => {
    useWorld.setState({ letters: [], reports: [], siege: null, camp: null });
    useGame.setState({ sheet: null, mapOpen: false });
    __chambers.rise(fakeScene() as never);
    const room = __chambers.live()!;
    await room.life.heraldReady;
    useWorld.setState({ letters: [raid('r9')] });
    expect(run(room, 30, talking(room, 'herald', 'news'))).toBe(true);
    vi.useFakeTimers();
    room.touch({ kind: 'letter' });
    vi.advanceTimersByTime(600);
    vi.useRealTimers();
    const r = useRealm.getState();
    expect(r.open, '«Вести» открыты').toBe(true);
    expect(r.view).toBe('decisions');
    expect(r.mail).toBe(letterKey('r9'));
    expect(__chambers.live(), 'покои на месте — закрыл «Вести», и снова в покоях').toBe(room);
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
