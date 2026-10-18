// Жизнь покоев (docs/city_v3.md, Г-7): стук — слуга поднимается и входит; каждая просьба слуге — своя сцена (кот, унести
// кота, служанка с вином, супруга, ступай); кот остаётся между входами в покои; разговор держит ноги, конец разговора
// их отпускает; кот живёт сам и не проходит сквозь мебель. Числами, без WebGL: комната и люди считаются в узле.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ChambersRoom } from './room';
import { DEFAULT_ARMS } from '@/heraldry/arms';
import { DOOR, HALF, POI_BY_ID, type PoiId } from './plan';
import { CAT_R, CAT_SPOTS, catRandom } from './cat';
import { BODY_R, free } from './walk';
import { floorAt, type LifeMemory, type Who, type Why } from './life';

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

function phoneRoom(memory?: LifeMemory): ChambersRoom {
  const room = new ChambersRoom(KEEP, DEFAULT_ARMS, 'low', () => null, memory);
  room.camera.aspect = PHONE.width / PHONE.height;
  room.camera.updateProjectionMatrix();
  room.setRect(PHONE);
  return room;
}

let clock = 0;
/** Кадры по 1/60 до условия или до `s` секунд; возвращает, сбылось ли условие. */
function run(room: ChambersRoom, s: number, until?: () => boolean): boolean {
  for (let i = 0; i < Math.round(s * 60); i++) {
    clock += 1 / 60;
    room.frame(1 / 60, clock, SKY);
    if (until?.()) return true;
  }
  return !until;
}

const poi = (id: PoiId) => ({ kind: 'poi' as const, poi: POI_BY_ID[id] });
const talking = (room: ChambersRoom, who: Who, why?: Why) => (): boolean => {
  const t = room.life.view().talk;
  return !!t && t.who === who && (!why || t.why === why);
};

/** Постучать и дождаться слугу у порога, готового слушать. */
function knock(room: ChambersRoom): void {
  room.touch(poi('door'));
  expect(run(room, 30, talking(room, 'servant')), 'слуга поднялся и ждёт слова').toBe(true);
}

describe('покои: дверь и слуга (Г-7)', () => {
  it('касание двери — правитель стучит, слуга поднимается, открывает внутрь, входит, кланяется и ждёт слова', () => {
    const room = phoneRoom();
    const cues: string[] = [];
    room.onLifeCue = (c) => cues.push(c);
    expect(room.life.doorOpen, 'дверь закрыта').toBe(0);
    room.touch(poi('door'));
    // Подошёл к двери и постучал трижды.
    expect(run(room, 12, () => cues.filter((c) => c === 'knock').length === 3), 'три удара').toBe(true);
    expect(room.state().spot).toBe('door');
    expect(room.life.personOf('servant'), 'до стука слуги нет — он внизу').toBeNull();
    expect(run(room, 30, talking(room, 'servant', 'arrive'))).toBe(true);
    expect(cues, 'дверь скрипнула').toContain('doorOpen');
    expect(room.life.doorOpen, 'дверь открыта внутрь').toBeGreaterThan(0.9);
    const s = room.life.personOf('servant')!;
    expect(s.z, 'слуга вошёл в покои').toBeGreaterThan(-HALF);
    expect(free(s.x, s.z, BODY_R), 'стоит на свободном полу').toBe(true);
    // Лицом к правителю.
    const r = room.state();
    const face = Math.atan2(r.x - s.x, r.z - s.z);
    expect(Math.abs(Math.atan2(Math.sin(face - s.yaw), Math.cos(face - s.yaw))), 'лицом к правителю').toBeLessThan(0.15);
    room.dispose();
  });

  it('каждая просьба слуге работает: кот, унести кота, служанка с вином, супруга, «ступай»', () => {
    const room = phoneRoom();
    let memory: LifeMemory | null = null;
    room.life.onRemember = (m) => (memory = m);
    knock(room);

    // «Приведи кота»: уходит вниз, возвращается с котом на руках, спускает на пол, снова ждёт слова.
    expect(room.life.order('cat')).toBe(true);
    expect(room.life.view().talk, 'просьба закрывает разговор').toBeNull();
    expect(run(room, 40, talking(room, 'servant', 'cat')), 'вернулся с котом').toBe(true);
    const c = room.life.cat!;
    expect(c.visible, 'кот в покоях').toBe(true);
    expect(c.held, 'кот на полу, а не на руках').toBeNull();
    expect(Math.abs(c.x) < HALF && Math.abs(c.z) < HALF, 'кот в комнате').toBe(true);
    expect(memory, 'память устройства: кот остался').toMatchObject({ cat: true });

    // «Унеси кота»: кот подходит на «кис-кис», слуга берёт его и уносит, возвращается.
    expect(room.life.order('uncat')).toBe(true);
    expect(run(room, 40, talking(room, 'servant', 'uncat')), 'унёс и вернулся').toBe(true);
    expect(room.life.cat!.visible, 'кота нет').toBe(false);
    expect(memory, 'память: кота нет').toMatchObject({ cat: false });

    // «Позови служанку с вином»: слуга уходит, служанка наливает в кубок на столе и подходит.
    expect(room.life.view().wine).toBe(0);
    expect(room.life.order('wine')).toBe(true);
    expect(run(room, 50, talking(room, 'maid', 'poured')), 'служанка налила и подошла').toBe(true);
    expect(room.life.view().wine, 'кубок полон').toBeGreaterThan(0.99);
    expect(room.life.personOf('servant'), 'слуга ушёл').toBeNull();
    // Служанка — «ступай»: уходит, дверь затворяется.
    expect(room.life.order('dismiss')).toBe(true);
    expect(run(room, 30, () => !room.life.personOf('maid') && room.life.doorOpen < 0.02), 'ушла и затворила дверь').toBe(true);

    // «Пригласи супругу»: снова стук, слуга, супруга поднимается и подходит.
    knock(room);
    expect(room.life.order('wife')).toBe(true);
    expect(run(room, 50, talking(room, 'wife', 'arrive')), 'супруга пришла').toBe(true);
    expect(room.life.personOf('wife')!.z).toBeGreaterThan(-HALF);
    expect(room.life.order('dismiss')).toBe(true);
    expect(run(room, 30, () => !room.life.personOf('wife')), 'супруга ушла').toBe(true);

    // «Ступай»: слуга кланяется, уходит, затворяет дверь.
    knock(room);
    expect(room.life.order('dismiss')).toBe(true);
    expect(run(room, 30, () => !room.life.personOf('servant') && room.life.doorOpen < 0.02), 'слуга ушёл, дверь затворена').toBe(true);
    room.dispose();
  });

  it('кот остаётся между входами: память устройства — кот в покоях сразу, на своём месте', () => {
    const a = phoneRoom();
    let memory: LifeMemory = { cat: false, catSpot: null };
    a.life.onRemember = (m) => (memory = m);
    knock(a);
    a.life.order('cat');
    expect(run(a, 40, talking(a, 'servant', 'cat'))).toBe(true);
    a.dispose();
    expect(memory.cat).toBe(true);
    // Новый вход — новая комната с той же памятью: кот уже здесь, без слуги.
    const b = phoneRoom(memory);
    expect(b.life.cat?.visible, 'кот в покоях с порога').toBe(true);
    expect(b.life.view().cat).toBe(true);
    expect(b.life.personOf('servant'), 'слуги нет').toBeNull();
    b.dispose();
    // А без кота в памяти — кота нет.
    const c = phoneRoom({ cat: false, catSpot: null });
    expect(c.life.view().cat).toBe(false);
    c.dispose();
  });

  it('разговор держит ноги, конец разговора отпускает: палец движения снова ведёт', () => {
    const room = phoneRoom();
    knock(room);
    room.leave();
    run(room, 4, () => room.state().mode === 'free');
    // Слуга ждёт слова: палец движения не двигает правителя.
    const at = room.state();
    room.down(7, 60, 700, PHONE);
    room.move(7, 60, 560);
    run(room, 1.2);
    const held = room.state();
    expect(Math.hypot(held.x - at.x, held.z - at.z), 'пока говорят — стоит').toBeLessThan(0.01);
    room.up(7);
    // Помолчать (крестик окна разговора): разговор кончился — ноги свободны.
    room.life.endTalk();
    expect(room.life.holdsLegs).toBe(false);
    room.down(8, 60, 700, PHONE);
    room.move(8, 60, 560);
    run(room, 1.2);
    room.up(8);
    const moved = room.state();
    expect(Math.hypot(moved.x - held.x, moved.z - held.z), 'после разговора — идёт').toBeGreaterThan(0.3);
    room.dispose();
  });

  it('касание стоящего слуги — снова к разговору', () => {
    const room = phoneRoom();
    knock(room);
    room.life.endTalk();
    expect(room.life.view().talk).toBeNull();
    room.touch({ kind: 'folk', who: 'servant' });
    expect(run(room, 10, talking(room, 'servant', 'come'))).toBe(true);
    room.dispose();
  });
});

describe('покои: кот (Г-7)', () => {
  it('кот бродит сам минуты, но не сквозь стены и мебель; ложится на свои места', () => {
    // Граница области — пол комнаты и ниши; места кота над полом (подоконник, кровать) — только прыжком на своё место.
    const room = phoneRoom({ cat: true, catSpot: 'hearth' });
    const c = room.life.cat!;
    const places = new Set<string>();
    for (let i = 0; i < 60 * 240; i++) {
      clock += 1 / 60;
      room.frame(1 / 60, clock, SKY);
      if (c.place) places.add(c.place);
      if (c.y < 0.01 && i % 20 === 0) expect(free(c.x, c.z, CAT_R * 0.9), `кот на свободном полу (${c.x.toFixed(2)}, ${c.z.toFixed(2)})`).toBe(true);
      if (c.y > 0.01) {
        // Над полом — только на своём месте или в прыжке к нему.
        const spot = CAT_SPOTS.find((s) => Math.hypot(s.x - c.x, s.z - c.z) < 1.4);
        expect(spot, `над полом — у своего места (${c.x.toFixed(2)}, ${c.y.toFixed(2)}, ${c.z.toFixed(2)})`).toBeTruthy();
      }
    }
    expect(places.size, `мест за четыре минуты: ${[...places].join(', ')}`).toBeGreaterThanOrEqual(2);
    room.dispose();
  });

  it('касание кота: рядом — правитель приседает и гладит, кот мурчит; клубок — кот играет', () => {
    const room = phoneRoom({ cat: true, catSpot: 'hearth' });
    const c = room.life.cat!;
    c.sitAt(0.4, -1.3, Math.PI);
    room.standAtPoint(0.4, -0.75, Math.PI, -0.6);
    room.touch({ kind: 'cat' });
    run(room, 1.2);
    expect(room.state().y, 'присел').toBeLessThan(1.3);
    expect(c.mind).toBe('petted');
    expect(c.purring, 'мурчит').toBeGreaterThan(0.5);
    run(room, 5);
    expect(c.mind, 'погладил — кот пошёл по своим делам').not.toBe('petted');
    expect(room.state().y, 'встал').toBeGreaterThan(1.55);
    room.life.throwBall();
    expect(room.life.view().ball).toBe(true);
    expect(c.mind).toBe('play');
    run(room, 3);
    expect(Math.hypot(c.look.speed, c.look.bat) > 0 || c.mind === 'play', 'играет').toBe(true);
    room.dispose();
  });

  it('кот за клубком — прямо к нему, но не сквозь мебель: клубок брошен в стол и сундук', () => {
    // Граница области — игра с клубком (кот бежит прямо на клубок, без пути в обход); броски — в стол и в сундук у стены.
    // Кот — по ту сторону стола и столика с шахматами: прямой путь к клубку лежит сквозь них.
    for (const [x, z, yaw, cx, cz] of [
      [0, 1.3, 0, 0.2, 4.0],
      [2.15, -1.5, Math.PI, 2.2, -3.6],
    ] as const) {
      const room = phoneRoom();
      room.life.stage({ catAt: { x: cx, z: cz, yaw: yaw + Math.PI } });
      room.standAtPoint(x, z, yaw, -0.3);
      room.life.throwBall();
      const c = room.life.cat!;
      let played = 0;
      for (let i = 0; i < 60 * 8; i++) {
        clock += 1 / 60;
        room.frame(1 / 60, clock, SKY);
        if (c.mind === 'play') played++;
        expect(free(c.x, c.z, CAT_R * 0.9), `кот за клубком на свободном полу (${c.x.toFixed(2)}, ${c.z.toFixed(2)})`).toBe(true);
      }
      expect(played, 'играл').toBeGreaterThan(60);
      room.dispose();
    }
  });

  it('кот далеко: касание — зовёт, подойдёт — гладит', () => {
    const room = phoneRoom({ cat: true, catSpot: 'bed' });
    const c = room.life.cat!;
    room.standAtPoint(1.0, 0.5, -Math.PI / 2, -0.4);
    room.touch({ kind: 'cat' });
    expect(run(room, 20, () => c.mind === 'petted'), 'пришёл и его гладят').toBe(true);
    room.dispose();
  });
});

describe('покои: вино и ночь (Г-7)', () => {
  it('кубок полон — правитель пьёт: к губам, глоток, вина меньше', () => {
    const room = phoneRoom();
    room.life.stage({ wine: 1 });
    room.snap('desk', 0, 0, 'goblet');
    run(room, 0.7);
    expect(room.view().drink, 'можно выпить').toBe(true);
    const cues: string[] = [];
    room.onLifeCue = (c) => cues.push(c);
    room.drink();
    run(room, 2.2);
    expect(cues).toContain('gulp');
    expect(room.life.wine).toBeCloseTo(0.66, 2);
    room.dispose();
  });

  it('ночь вдвоём: правитель ложится, кадр темнеет, утром её нет — и ноги снова свободны', () => {
    const room = phoneRoom();
    knock(room);
    room.life.order('wife');
    expect(run(room, 50, talking(room, 'wife'))).toBe(true);
    expect(room.life.order('night')).toBe(true);
    expect(run(room, 30, () => !!room.life.view().night), 'началась ночь').toBe(true);
    expect(room.state().spot, 'правитель в кровати').toBe('bed');
    expect(room.life.holdsLegs).toBe(true);
    expect(run(room, 12, () => !room.life.view().night), 'утро').toBe(true);
    expect(room.life.personOf('wife'), 'ушла до света').toBeNull();
    expect(room.life.holdsLegs).toBe(false);
    room.dispose();
  });
});

describe('покои: тамбур и случайность кота', () => {
  it('ступени тамбура — вниз на запад от площадки, в комнате и на площадке пол ровный', () => {
    expect(floorAt(0, 0)).toBe(0);
    expect(floorAt(DOOR.x, -HALF - 0.6)).toBe(0);
    expect(floorAt(2.2, -HALF - 0.78)).toBeLessThan(-0.6);
  });

  it('кость кота — своя, зернистая: один сид — одна дорожка', () => {
    const a = catRandom(5);
    const b = catRandom(5);
    for (let i = 0; i < 20; i++) expect(a()).toBe(b());
  });
});

describe('покои: бюджет живых (Г-7)', () => {
  it('люди и кот — в потолках по уровням; строятся, только когда понадобились; в покоях разом — не больше двух людей и кота', async () => {
    const { buildPerson } = await import('./folk');
    const { buildCat } = await import('./cat');
    // Потолки: человек — 2,6 / 3,0 / 3,5 тысячи треугольников («Низкий», «Средний», «Высокий»), кот — 1,3 / 1,6 / 1,9.
    const PERSON = [2600, 3000, 3500];
    const CAT = [1300, 1600, 1900];
    for (const d of [0, 1, 2] as const) {
      for (const who of ['servant', 'maid', 'wife'] as const) expect(buildPerson(who, DEFAULT_ARMS, d, 1).m.b.triangleCount, `${who} @${d}`).toBeLessThanOrEqual(PERSON[d]);
      expect(buildCat(d, 1).m.b.triangleCount, `кот @${d}`).toBeLessThanOrEqual(CAT[d]);
    }
    // Вход без кота: живых нет ни одного — сетки строятся по делу, а не при входе.
    const room = phoneRoom();
    expect(room.life.counts().triangles).toBe(0);
    room.dispose();
  });
});
