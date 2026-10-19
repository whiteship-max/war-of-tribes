// Жизнь покоев (docs/city_v3.md, Г-7): дверь, старый слуга, служанка с вином, супруга, кот, клубок и вино в кубке.
// Механики игры здесь нет — это вид: что кому сказать, решает слой интерфейса (`ui/chambers/talk.ts`), а здесь — кто
// где стоит, куда идёт и что делает руками. Покои правителя хозяйничают так:
//
//   · правитель стучит в дверь (дело «Дверь», `acts.ts`) — по лестнице поднимается слуга, открывает, входит, кланяется;
//   · просьба слуге — сцена: принести кота на руках и спустить на пол, унести его, позвать служанку с вином (та наливает в
//     кубок на столе), пригласить супругу, уйти и затворить дверь;
//   · кот живёт сам (`cat.ts`); клубок брошен — гоняет его;
//   · ночь вдвоём — правитель и она идут к кровати, дальше слой интерфейса затемняет кадр; утром её нет;
//   · гонец (Г-10): важная весть, пока правитель в покоях, — стук в дверь, гонец поднимается, входит, кланяется и
//     протягивает письмо с печатью; правитель взял письмо — гонец кланяется и уходит (что за весть, решает интерфейс);
//   · советник (Г-10): после отлучки ждёт у стола со свитком, кланяется и докладывает; «ступай» — уходит.
//
// Сценарии — сопрограммы: шаг сцены ждёт своего условия (дошёл, повернулся, прошло время), кадр двигает их по очереди.
import * as THREE from 'three';
import type { V3 } from '../city/geom';
import { tint } from '../city/geom';
import type { Arms } from '@/heraldry/arms';
import type { Quality } from '../quality';
import { geometryOf } from '../city/index';
import { DOOR, DESK, BED, HALF, isChestSpot, isWindowSpot, softFloor, type SpotId } from './plan';
import { DOOR_HINGE, doorLeaf } from './build';
import { Person, buildPerson, gripOf, isFemale, type FolkId } from './folk';
import { Cat, buildCat, type CatSpot } from './cat';
import { BODY_R, clear, free, pathTo, step } from './walk';
import { Mesher } from './geo';

/** Кто говорит с правителем. */
export type Who = FolkId;
/** Почему подошёл: пришёл на стук, вернулся с делом, налила вино, пришла сама; гонец — с письмом, советник — с докладом. */
export type Why = 'arrive' | 'cat' | 'uncat' | 'poured' | 'come' | 'news' | 'report';
/** Просьбы: слуге — кот, унести кота, служанку с вином, супругу, ступай; служанке — налить ещё; обеим — ночь, уйти. */
export type Order = 'cat' | 'uncat' | 'wine' | 'wife' | 'dismiss' | 'pour' | 'night';

/** Звук жизни покоев: стук, дверь, шаги людей и кота, мяу, налить, глоток, музыка ночи. */
export type LifeCue = 'knock' | 'doorOpen' | 'doorShut' | 'stepFolk' | 'stepFolkSoft' | 'catStep' | 'catLand' | 'meow' | 'pour' | 'gulp' | 'night' | 'letter';

/** Что правитель делает — режиссёру: где стоит, куда смотрит, свободен ли. */
export interface RulerNow {
  x: number;
  z: number;
  yaw: number;
  eye: V3;
  spot: SpotId | null;
  /** В деле (сидит, лежит, у окна) — не ходит сам. */
  inAct: boolean;
}

/** Что режиссёру даёт комната. */
export interface LifeHost {
  scene: THREE.Scene;
  material: THREE.Material;
  origin: THREE.Vector3;
  arms: Arms;
  quality: Quality;
  ruler(): RulerNow;
  cue(c: LifeCue, at: V3 | null): void;
  /** Правителю — пойти и сделать дело (лечь — ночь вдвоём). */
  intend(spot: SpotId): void;
  /** Встать из дела (у окна, у огня — чтобы обернуться к пришедшему). */
  stand(): void;
  /** Кубок: где его чаша (оси комнаты) и в руке ли он; положить на место. */
  goblet(): { at: V3; held: boolean };
  dropGoblet(): void;
}

/** Что режиссёр помнит между входами (устройство, не партия): есть ли кот и где лёг. */
export interface LifeMemory {
  cat: boolean;
  catSpot: CatSpot['id'] | null;
}

/** Что видит слой интерфейса. */
export interface LifeView {
  /** Кто подошёл и ждёт слова правителя; `n` — номер подхода (окно разговора — новое на каждый, Г-9). */
  talk: { who: Who; why: Why; n: number } | null;
  /** Кто сейчас в покоях (люди). */
  here: Who[];
  /** Сцена идёт (слуга несёт, служанка наливает): просьбы ждут. */
  busy: boolean;
  cat: boolean;
  /** Вина в кубке, 0…1. */
  wine: number;
  /** Ночь: доля сцены 0…1 (затемнение, сердце, утро) и кто был. */
  night: { k: number; who: Who } | null;
  /** Клубок брошен и катится. */
  ball: boolean;
  /** Гонец протягивает письмо: его можно взять (касание письма или кнопка). */
  letter: boolean;
}

type Cond = () => boolean;
type Script = Generator<Cond, void, void>;

const wait = (s: number, clock: { t: number }): Cond => {
  const until = clock.t + s;
  return () => clock.t >= until;
};

/** Двери: закрыта — 0, открыта внутрь — `OPEN` рад. */
const OPEN = 1.72;
/** Площадка за дверью (тамбур) и низ лестницы: отсюда приходят и сюда уходят. */
const LANDING = { x: DOOR.x - 0.15, z: -HALF - 0.78 };
const THRESH = { x: DOOR.x - 0.05, z: -HALF - 0.05 };
const INSIDE = { x: DOOR.x - 0.1, z: -HALF + 0.55 };
const STAIR = [
  { x: 3.0, z: -HALF - 0.78 },
  { x: 2.05, z: -HALF - 0.78 },
];
/** Пол тамбура и ступеней: высота в точке (ниже площадки — лестница на запад). */
export function floorAt(x: number, z: number): number {
  if (z > -HALF - 0.3) return 0;
  const xs = DOOR.x - DOOR.w / 2 - 0.05;
  if (x >= xs) return 0;
  return -Math.min(1.14, ((xs - x) / 0.24) * 0.19);
}

/** Скорость шага: старик — неспешно, служанка — живо, супруга — плавно, гонец — спеша, советник — степенно. */
const SPEED: Record<Who, number> = { servant: 0.85, maid: 1.05, wife: 0.9, herald: 1.3, advisor: 0.75 };
/** Коды подсветки касанием (`material.uSel`): люди, кот, дверь и письмо гонца — за предметами стола. */
export const LIFE_CODE: Record<Who | 'cat' | 'door' | 'letter', number> = { servant: 20, maid: 21, wife: 22, cat: 23, door: 24, herald: 25, advisor: 26, letter: 27 };

/** Где советник ждёт у стола: у восточного конца, лицом к середине покоев (правитель входит в неё). */
export const ADVISOR_POST = { x: 1.62, z: 2.3, yaw: -2.25 };

export class ChambersLife {
  readonly clock = { t: 0 };
  private folk = new Map<Who, Person>();
  cat: Cat | null = null;
  private leaf: THREE.Mesh;
  private door = { a: 0, goal: 0 };
  private jobs: { s: Script; c: Cond | null }[] = [];
  private talking: { who: Who; why: Why; n: number } | null = null;
  private talkN = 0;
  private busyN = 0;
  wine = 0;
  private night: { k: number; who: Who; t: number } | null = null;
  private ball: { mesh: THREE.Mesh; p: V3; v: V3; on: boolean; t: number } | null = null;
  private jug: THREE.Mesh | null = null;
  /** Письмо с печатью в руке гонца и свиток в руке советника. */
  private letterMesh: THREE.Mesh | null = null;
  private scrollMesh: THREE.Mesh | null = null;
  /** Письмо протянуто и ждёт руки правителя; `took` — взято (летит к правителю), доля полёта. */
  private letterOut = false;
  private took: { t: number; from: THREE.Vector3 } | null = null;
  private stream: THREE.Mesh | null = null;
  private pouring = 0;
  /** Кто говорит сейчас и сколько ещё (жест речи и голос). */
  private speaking = new Map<Who, number>();
  /** Слоям выше: переменилось то, что они показывают. */
  onChange: (() => void) | null = null;
  /** Память устройства переменилась (кот пришёл, ушёл, лёг). */
  onRemember: ((m: LifeMemory) => void) | null = null;
  /** Голос: кто и сколько секунд говорит — звуку (мурлыканье речи без слов). */
  onSpeak: ((who: Who, seconds: number) => void) | null = null;
  /** Правитель взял письмо гонца — интерфейсу открыть весть. */
  onLetter: (() => void) | null = null;
  private lastKey = '';
  private memo: LifeMemory;

  constructor(
    private host: LifeHost,
    memory: LifeMemory,
  ) {
    this.memo = { ...memory };
    const lg = geometryOf(doorLeaf().b);
    this.leaf = new THREE.Mesh(lg, host.material);
    this.leaf.name = 'chambers-door';
    host.scene.add(this.leaf);
    this.placeLeaf();
    if (memory.cat) {
      const c = this.ensureCat();
      c.settle(memory.catSpot ?? 'hearth');
    }
  }

  // ---------- Люди и кот ----------

  private person(who: Who): Person {
    let p = this.folk.get(who);
    if (!p) {
      const detail = this.host.quality === 'low' ? 0 : this.host.quality === 'medium' ? 1 : 2;
      p = new Person(who, buildPerson(who, this.host.arms, detail, LIFE_CODE[who]), this.host.material, SPEED[who]);
      p.onStep = (soft) => this.host.cue(soft ? 'stepFolkSoft' : 'stepFolk', [p!.x, 0, p!.z]);
      p.place(LANDING.x, LANDING.z, 0);
      this.host.scene.add(p.rig.mesh);
      this.folk.set(who, p);
    }
    return p;
  }

  private ensureCat(): Cat {
    if (!this.cat) {
      const detail = this.host.quality === 'low' ? 0 : this.host.quality === 'medium' ? 1 : 2;
      this.cat = new Cat(buildCat(detail, LIFE_CODE.cat), this.host.material, 7919);
      this.cat.onSound = (s, at) => this.host.cue(s === 'meow' ? 'meow' : s === 'land' ? 'catLand' : s === 'step' ? 'catStep' : 'meow', at);
      this.host.scene.add(this.cat.rig.mesh);
    }
    return this.cat;
  }

  /** Ноги правителя стоят: с ним говорят (окно разговора) или ночь — смотреть можно, ходить нет. */
  get holdsLegs(): boolean {
    return this.talking !== null || this.night !== null;
  }

  /** Человек в покоях (виден) — касанию и тестам. */
  personOf(who: Who): Person | null {
    const p = this.folk.get(who);
    return p && p.visible ? p : null;
  }

  // ---------- Что видит интерфейс ----------

  view(): LifeView {
    return {
      talk: this.talking,
      here: [...this.folk.values()].filter((p) => p.visible).map((p) => p.id),
      busy: this.busyN > 0,
      cat: !!this.cat?.visible,
      wine: this.wine,
      night: this.night ? { k: this.night.k, who: this.night.who } : null,
      ball: !!this.ball?.on,
      letter: this.letterOut,
    };
  }

  private changed(): void {
    const v = this.view();
    const key = JSON.stringify({ ...v, wine: Math.round(v.wine * 20), night: v.night ? Math.round(v.night.k * 20) : null });
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.onChange?.();
  }

  private remember(): void {
    const c = this.cat;
    this.memo = { cat: !!c?.visible && c.mind !== 'carried', catSpot: c?.place ?? (c?.visible ? 'hearth' : null) };
    this.onRemember?.(this.memo);
  }

  // ---------- Сцены ----------

  private run(s: Script): void {
    this.jobs.push({ s, c: null });
  }

  /** Правитель постучал: если никого нет — поднимается слуга. Повторный стук при слуге в дверях — подходит он же. */
  knocked(): void {
    const s = this.folk.get('servant');
    if (s?.visible) {
      if (!this.talking) this.run(this.approach('servant', 'arrive'));
      return;
    }
    this.run(this.servantArrives());
  }

  /**
   * Гонец с вестью (Г-10): стук в дверь, поднимается, входит, кланяется, протягивает письмо. Нельзя сейчас — идёт сцена,
   * ночь, разговор, гонец уже здесь или в покоях уже двое: `false`, интерфейс позовёт снова.
   */
  summonHerald(): boolean {
    if (this.busyN > 0 || this.night || this.talking || this.folk.get('herald')?.visible) return false;
    // Бюджет живых: в покоях разом — не больше двух людей (и кот); третьим гонец подождёт за дверью.
    if ([...this.folk.values()].filter((p) => p.visible).length > 1) return false;
    this.run(this.heraldArrives());
    return true;
  }

  /** Советник (Г-10): уже ждёт у стола, когда правитель входит, — кланяется и докладывает. */
  advisorWaits(): void {
    const a = this.person('advisor');
    a.visible = true;
    a.carry = 'scroll';
    a.place(ADVISOR_POST.x, ADVISOR_POST.z, ADVISOR_POST.yaw);
    a.want.read = 0.35;
    a.g.read = 0.35;
    this.run(this.advisorReports());
  }

  /** Правитель берёт письмо (касание письма или кнопка «Взять письмо»): гонец отдаёт, кланяется и уходит. */
  takeLetter(): boolean {
    const h = this.personOf('herald');
    if (!h || !this.letterOut) return false;
    this.letterOut = false;
    if (this.talking?.who === 'herald') this.talking = null;
    if (this.letterMesh) this.took = { t: 0, from: this.letterMesh.position.clone() };
    this.host.cue('letter', [h.x, 1.3, h.z]);
    h.want.offer = 0;
    h.carry = 'none';
    this.run(this.leave('herald'));
    this.onLetter?.();
    this.changed();
    return true;
  }

  /** Подойти к правителю для разговора (касание человека, вернулся с делом). */
  callOver(who: Who): void {
    const p = this.personOf(who);
    if (!p || this.busyN > 0 || this.talking) return;
    // Гонец с письмом подходит снова с письмом, советник — к докладу.
    this.run(this.approach(who, who === 'herald' && p.carry === 'letter' ? 'news' : who === 'advisor' ? 'report' : 'come'));
  }

  /** Сказать реплику: жест речи и голос на `seconds`. */
  say(who: Who, seconds: number): void {
    if (!this.personOf(who)) return;
    this.speaking.set(who, seconds);
    this.onSpeak?.(who, seconds);
  }

  /** Куда смотреть правителю: голова того, кто с ним говорит или к нему подходит (оси комнаты). */
  focus(): V3 | null {
    const who = this.talking?.who ?? [...this.folk.values()].find((p) => p.visible && !p.moving && p.z > -HALF + 0.2 && Math.hypot(p.x - this.host.ruler().x, p.z - this.host.ruler().z) < 2.6)?.id;
    const p = who ? this.personOf(who) : null;
    if (!p) return null;
    return p.rig.at('head', [0, 0.08, 0.04]);
  }

  /** Окно разговора закрыто без просьбы: человек остаётся стоять, касание — снова к разговору. */
  endTalk(): void {
    this.talking = null;
    this.changed();
  }

  /** Просьба. Возвращает, принята ли (кот уже здесь — «приведи кота» нечего делать). */
  order(o: Order): boolean {
    const who = this.talking?.who ?? null;
    this.talking = null;
    switch (o) {
      case 'cat':
        if (this.cat?.visible) return false;
        this.run(this.fetchCat());
        break;
      case 'uncat':
        if (!this.cat?.visible) return false;
        this.run(this.takeCat());
        break;
      case 'wine':
        this.run(this.callMaid());
        break;
      case 'wife':
        this.run(this.callWife());
        break;
      case 'pour':
        this.run(this.pourWine(true));
        break;
      case 'dismiss':
        if (who) this.run(this.leave(who));
        break;
      case 'night':
        if (who && who !== 'servant') this.run(this.nightWith(who));
        break;
    }
    this.changed();
    return true;
  }

  // ---------- Сценарии ----------

  /** Слуга поднимается по лестнице, открывает дверь, входит, кланяется — и ждёт слова. */
  private *servantArrives(): Script {
    this.busyN++;
    const s = this.person('servant');
    // Шаги по лестнице — снизу из темноты.
    s.place(STAIR[1].x, STAIR[1].z, Math.PI / 2);
    yield wait(1.1, this.clock);
    s.visible = true;
    s.go([STAIR[0], LANDING], 0);
    yield () => !s.moving;
    yield* this.openDoor(s);
    s.go([THRESH, INSIDE], null);
    yield () => !s.moving;
    this.busyN--;
    yield* this.approach('servant', 'arrive');
  }

  /** Открыть дверь изнутри тамбура: рука к кольцу, створка внутрь. */
  private *openDoor(p: Person): Script {
    p.face(0);
    yield () => p.settled;
    p.want.reach = 1;
    yield wait(0.45, this.clock);
    this.door.goal = OPEN;
    this.host.cue('doorOpen', [DOOR.x, 1.2, -HALF - 0.3]);
    yield wait(0.5, this.clock);
    p.want.reach = 0;
    yield () => this.door.a > OPEN * 0.8;
  }

  /** Затворить дверь, уходя: из тамбура тянет створку к себе. */
  private *shutDoor(p: Person): Script {
    p.face(0);
    yield () => p.settled;
    p.want.reach = 0.8;
    yield wait(0.3, this.clock);
    this.door.goal = 0;
    yield () => this.door.a < 0.05;
    this.host.cue('doorShut', [DOOR.x, 1.2, -HALF - 0.3]);
    p.want.reach = 0;
  }

  /**
   * Подойти к правителю для разговора: встать в шаге перед ним (где свободно и видно), лицом к нему, поклониться (слуга)
   * или присесть (служанка), кивнуть (супруга) — и ждать слова.
   */
  private *approach(who: Who, why: Why): Script {
    const p = this.person(who);
    if (!p.visible) return;
    this.busyN++;
    const r = this.host.ruler();
    // У окна, у огня и у стены оружия правитель встаёт, чтобы обернуться к пришедшему.
    if (r.inAct && (isWindowSpot(r.spot) || isChestSpot(r.spot) || r.spot === 'hearth' || r.spot === 'arms')) this.host.stand();
    const at = this.talkSpot(p);
    const route = this.route(p, at);
    p.go(route, null);
    yield () => !p.moving;
    const rr = this.host.ruler();
    p.face(Math.atan2(rr.eye[0] - p.x, rr.eye[2] - p.z));
    yield () => p.settled;
    // Слуга и гонец кланяются низко, советник — с достоинством; служанка приседает, супруга кивает.
    if (who === 'servant' || who === 'herald') p.want.bow = 1;
    else if (who === 'advisor') p.want.bow = 0.55;
    else if (who === 'maid') p.want.curtsy = 1;
    else p.want.curtsy = 0.45;
    yield wait(who === 'wife' ? 0.7 : 1.0, this.clock);
    p.want.bow = 0;
    p.want.curtsy = 0;
    yield wait(0.35, this.clock);
    // Гонец протягивает письмо: правая рука вперёд — письмо в ней на виду.
    if (who === 'herald' && p.carry === 'letter') {
      p.want.offer = 1;
      yield wait(0.45, this.clock);
      this.letterOut = true;
    }
    this.busyN--;
    this.talking = { who, why, n: ++this.talkN };
    this.changed();
  }

  /** Где встать для разговора: в шаге-полутора от правителя, у него на виду, на свободном полу. */
  talkSpot(p: { x: number; z: number }): { x: number; z: number } {
    const r = this.host.ruler();
    if (r.inAct && r.spot === 'desk') return { x: 0.95, z: 2.05 };
    if (r.inAct && r.spot === 'bed') return { x: BED.x1 + 0.42, z: -3.75 };
    if (r.inAct && r.spot === 'door') return { x: INSIDE.x, z: INSIDE.z };
    // Перед правителем: сначала по его взгляду, потом в сторону пришедшего, дальше — веером.
    const toP = Math.atan2(p.x - r.x, p.z - r.z);
    const tries: number[] = [];
    for (const a of [0, 0.35, -0.35, 0.7, -0.7]) tries.push(r.yaw + a);
    for (const a of [0, 0.5, -0.5, 1.0, -1.0, 1.6, -1.6, Math.PI]) tries.push(toP + a);
    for (const d of [1.25, 1.0, 1.55]) {
      for (const a of tries) {
        const x = r.x + Math.sin(a) * d;
        const z = r.z + Math.cos(a) * d;
        if (free(x, z, BODY_R) && Math.abs(z) < HALF - 0.4) return { x, z };
      }
    }
    return { x: INSIDE.x, z: INSIDE.z };
  }

  /** Путь человека по комнате (в тамбуре — через порог). */
  private route(p: Person, to: { x: number; z: number }): { x: number; z: number }[] {
    const pts: { x: number; z: number }[] = [];
    let from = { x: p.x, z: p.z };
    if (p.z < -HALF + 0.1) {
      pts.push(THRESH, INSIDE);
      from = INSIDE;
    }
    if (clear(from, to)) pts.push(to);
    else pts.push(...(pathTo(from, to) ?? [to]));
    return pts;
  }

  /** Уйти: к двери, за порог, вниз по лестнице; дверь — затворить за собой, если в покоях больше никого. */
  private *leave(who: Who): Script {
    const p = this.person(who);
    if (!p.visible) return;
    this.busyN++;
    if (isFemale(who)) p.want.curtsy = 0.6;
    else p.want.bow = 0.6;
    p.want.offer = 0;
    yield wait(0.7, this.clock);
    p.want.bow = 0;
    p.want.curtsy = 0;
    yield* this.exit(p);
    this.busyN--;
    this.changed();
  }

  /** Выйти в тамбур и вниз, затворив дверь, если больше никто не идёт. */
  private *exit(p: Person): Script {
    const out = this.route(p, INSIDE);
    p.go([...out, THRESH, LANDING], null);
    yield () => !p.moving;
    if (![...this.folk.values()].some((q) => q !== p && q.visible && q.z > -HALF)) yield* this.shutDoor(p);
    p.go(STAIR, null);
    yield () => p.x < 2.3 || !p.moving;
    p.visible = false;
    p.place(LANDING.x, LANDING.z, 0);
    p.carry = 'none';
  }

  /**
   * Гонец: три частых удара в дверь снаружи, шаги по лестнице, открывает, входит и подходит с письмом. Если дверь уже
   * открыта (слуга внизу не затворил) — входит без стука.
   */
  private *heraldArrives(): Script {
    this.busyN++;
    const h = this.person('herald');
    h.carry = 'letter';
    h.place(STAIR[1].x, STAIR[1].z, Math.PI / 2);
    h.visible = true;
    h.go([STAIR[0], LANDING], 0);
    yield () => !h.moving;
    if (this.door.a < OPEN * 0.5) {
      h.face(0);
      yield () => h.settled;
      // Стук спешный — гонец не ждёт: три удара чаще и твёрже, чем стучит правитель.
      for (let i = 0; i < 3; i++) {
        this.host.cue('knock', [DOOR.x, 1.3, -HALF - 0.1]);
        yield wait(0.24, this.clock);
      }
      yield wait(0.5, this.clock);
      yield* this.openDoor(h);
    }
    h.go([THRESH, INSIDE], null);
    yield () => !h.moving;
    this.busyN--;
    yield* this.approach('herald', 'news');
  }

  /** Советник у стола: оборачивается к правителю, кланяется, поднимает свиток — и докладывает. */
  private *advisorReports(): Script {
    this.busyN++;
    const a = this.person('advisor');
    yield wait(0.6, this.clock);
    const r = this.host.ruler();
    a.face(Math.atan2(r.eye[0] - a.x, r.eye[2] - a.z));
    yield () => a.settled;
    a.want.bow = 0.55;
    yield wait(1.0, this.clock);
    a.want.bow = 0;
    a.want.read = 1;
    yield wait(0.5, this.clock);
    this.busyN--;
    this.talking = { who: 'advisor', why: 'report', n: ++this.talkN };
    this.changed();
  }

  /** Принести кота: слуга уходит вниз, возвращается с котом на руках, спускает его на пол у правителя. */
  private *fetchCat(): Script {
    this.busyN++;
    const s = this.person('servant');
    yield wait(0.9, this.clock);
    yield* this.exitKeepDoor(s);
    yield wait(3.2, this.clock);
    const c = this.ensureCat();
    c.visible = true;
    s.carry = 'cat';
    s.want.carry = 1;
    s.visible = true;
    s.place(STAIR[1].x, STAIR[1].z, Math.PI / 2);
    s.go([STAIR[0], LANDING, THRESH, INSIDE], null);
    yield () => !s.moving;
    const at = this.talkSpot(s);
    s.go(this.route(s, at), null);
    yield () => !s.moving;
    const r = this.host.ruler();
    s.face(Math.atan2(r.eye[0] - s.x, r.eye[2] - s.z));
    yield () => s.settled;
    // Спустить на пол: присел, руки вниз — кот на полу перед ним.
    s.want.stoop = 1;
    s.want.carry = 0.4;
    yield wait(0.75, this.clock);
    s.carry = 'none';
    s.want.carry = 0;
    c.held = null;
    c.appear(s.x + Math.sin(s.yaw) * 0.45, s.z + Math.cos(s.yaw) * 0.45, s.yaw);
    c.meow();
    this.remember();
    yield wait(0.4, this.clock);
    s.want.stoop = 0;
    yield wait(0.6, this.clock);
    this.busyN--;
    yield* this.approach('servant', 'cat');
  }

  /** Выйти за дверь и вниз, не затворяя (сейчас вернётся). */
  private *exitKeepDoor(p: Person): Script {
    const out = this.route(p, INSIDE);
    p.go([...out, THRESH, LANDING, ...STAIR], null);
    yield () => p.x < 2.3 || !p.moving;
    p.visible = false;
  }

  /** Унести кота: «кис-кис» — кот подходит, слуга берёт его на руки и уносит, возвращается сказать. */
  private *takeCat(): Script {
    this.busyN++;
    const s = this.person('servant');
    const c = this.ensureCat();
    yield wait(0.6, this.clock);
    c.come(s.x + Math.sin(s.yaw) * 0.45, s.z + Math.cos(s.yaw) * 0.45);
    const until = this.clock.t + 9;
    yield () => (Math.hypot(c.x - s.x, c.z - s.z) < 0.7 && c.y < 0.05) || this.clock.t > until;
    // Повернуться к коту, присесть, взять.
    s.face(Math.atan2(c.x - s.x, c.z - s.z));
    yield () => s.settled;
    s.want.stoop = 1;
    yield wait(0.7, this.clock);
    s.carry = 'cat';
    s.want.carry = 1;
    s.want.stoop = 0;
    yield wait(0.7, this.clock);
    yield* this.exitKeepDoor(s);
    c.hide();
    s.carry = 'none';
    s.want.carry = 0;
    this.remember();
    yield wait(2.4, this.clock);
    s.visible = true;
    s.place(STAIR[1].x, STAIR[1].z, Math.PI / 2);
    s.go([STAIR[0], LANDING, THRESH, INSIDE], null);
    yield () => !s.moving;
    this.busyN--;
    yield* this.approach('servant', 'uncat');
  }

  /** Позвать служанку с вином: слуга уходит, она поднимается с кувшином, наливает в кубок на столе, подходит. */
  private *callMaid(): Script {
    this.busyN++;
    const s = this.person('servant');
    yield wait(0.8, this.clock);
    yield* this.exitKeepDoor(s);
    s.place(LANDING.x, LANDING.z, 0);
    yield wait(3.0, this.clock);
    const m = this.person('maid');
    m.carry = 'jug';
    m.visible = true;
    m.place(STAIR[1].x, STAIR[1].z, Math.PI / 2);
    m.go([STAIR[0], LANDING, THRESH, INSIDE], null);
    yield () => !m.moving;
    this.busyN--;
    yield* this.pourWine(false);
  }

  /** Налить вина в кубок на столе: подойти к столу, кувшин над кубком, струя, кубок полон; подойти к правителю. */
  private *pourWine(again: boolean): Script {
    this.busyN++;
    const m = this.person('maid');
    m.carry = 'jug';
    if (this.host.goblet().held) this.host.dropGoblet();
    yield wait(again ? 0.4 : 0.1, this.clock);
    yield () => !this.host.goblet().held;
    const g = this.host.goblet().at;
    // Встать у стола к востоку от кубка, лицом к нему.
    const spot = { x: Math.max(DESK.w / 2 + BODY_R + 0.05, g[0] + 0.62), z: g[2] - 0.05 };
    m.go(this.route(m, spot), null);
    yield () => !m.moving;
    m.face(Math.atan2(g[0] - m.x, g[2] - m.z));
    yield () => m.settled;
    m.want.pour = 1;
    yield wait(0.7, this.clock);
    m.want.tip = 1;
    this.host.cue('pour', g);
    this.pouring = 1;
    const start = this.wine;
    const t0 = this.clock.t;
    yield () => {
      const k = Math.min(1, (this.clock.t - t0) / 1.8);
      this.wine = start + (1 - start) * k;
      return k >= 1;
    };
    this.pouring = 0;
    m.want.tip = 0;
    yield wait(0.45, this.clock);
    m.want.pour = 0;
    yield wait(0.4, this.clock);
    this.busyN--;
    yield* this.approach('maid', 'poured');
  }

  /** Пригласить супругу: слуга уходит, она поднимается, входит, подходит. */
  private *callWife(): Script {
    this.busyN++;
    const s = this.person('servant');
    yield wait(0.8, this.clock);
    yield* this.exitKeepDoor(s);
    s.place(LANDING.x, LANDING.z, 0);
    yield wait(4.0, this.clock);
    const w = this.person('wife');
    w.visible = true;
    w.place(STAIR[1].x, STAIR[1].z, Math.PI / 2);
    w.go([STAIR[0], LANDING, THRESH, INSIDE], null);
    yield () => !w.moving;
    this.busyN--;
    yield* this.approach('wife', 'arrive');
  }

  /**
   * Ночь вдвоём: правитель идёт к кровати и ложится, она — к кровати с другой стороны; кадр темнеет (слой интерфейса:
   * затемнение, сердце, тихая музыка), утром её нет — ушла к себе до света. Ничего, кроме затемнения.
   */
  private *nightWith(who: Who): Script {
    this.busyN++;
    const p = this.person(who);
    yield wait(0.6, this.clock);
    this.host.intend('bed');
    const side = { x: BED.x1 + 0.38, z: -4.35 };
    p.go(this.route(p, side), null);
    const until = this.clock.t + 14;
    yield () => (this.host.ruler().inAct && this.host.ruler().spot === 'bed') || this.clock.t > until;
    p.face(Math.atan2(this.host.ruler().eye[0] - p.x, this.host.ruler().eye[2] - p.z));
    yield wait(0.5, this.clock);
    this.night = { k: 0, who, t: 0 };
    this.host.cue('night', null);
    this.changed();
    // Затемнение (1,6 с), сердце и музыка в темноте, утро — проступает (до 7,5 с).
    yield () => this.night!.t >= 2.0;
    p.visible = false;
    p.place(LANDING.x, LANDING.z, 0);
    p.carry = 'none';
    if (this.door.goal > 0) this.door.goal = 0;
    yield () => this.night!.t >= NIGHT_LEN;
    this.night = null;
    this.busyN--;
    this.changed();
  }

  // ---------- Клубок ----------

  /** Бросить клубок: из руки правителя вперёд, на пол в паре метров; кот бежит играть. */
  throwBall(): void {
    const c = this.cat;
    if (!c?.visible) return;
    if (!this.ball) {
      const m = new Mesher();
      m.at(0, 0, 0);
      const r = 0.045;
      // Клубок шерсти: шар и пара витков нитки.
      for (let i = 0; i < 6; i++) {
        const a0 = (i / 6) * Math.PI;
        const a1 = ((i + 1) / 6) * Math.PI;
        for (let k = 0; k < 8; k++) {
          const b0 = (k / 8) * Math.PI * 2;
          const b1 = ((k + 1) / 8) * Math.PI * 2;
          const P = (a: number, b: number): V3 => [Math.sin(a) * Math.cos(b) * r, Math.cos(a) * r, Math.sin(a) * Math.sin(b) * r];
          m.quad(P(a1, b0), P(a1, b1), P(a0, b1), P(a0, b0), 'plain', (i + k) % 2 ? tint(0xa83a2a) : tint(0x8a2a22));
        }
      }
      m.smoothFrom(0, 80);
      const mesh = new THREE.Mesh(geometryOf(m.b), this.host.material);
      mesh.name = 'chambers-ball';
      this.host.scene.add(mesh);
      this.ball = { mesh, p: [0, 0, 0], v: [0, 0, 0], on: false, t: 0 };
    }
    const r = this.host.ruler();
    const f: V3 = [Math.sin(r.yaw), 0, Math.cos(r.yaw)];
    this.ball.p = [r.eye[0] + f[0] * 0.35, r.eye[1] - 0.45, r.eye[2] + f[2] * 0.35];
    this.ball.v = [f[0] * 2.6, 1.6, f[2] * 2.6];
    this.ball.on = true;
    this.ball.t = 0;
    this.ball.mesh.visible = true;
    c.play();
    this.changed();
  }

  private stepBall(dt: number): void {
    const b = this.ball;
    if (!b?.on) return;
    b.t += dt;
    b.v[1] -= 9.8 * dt;
    let nx = b.p[0] + b.v[0] * dt;
    let nz = b.p[2] + b.v[2] * dt;
    let ny = b.p[1] + b.v[1] * dt;
    if (ny < 0.045) {
      ny = 0.045;
      b.v[1] = Math.abs(b.v[1]) > 0.8 ? -b.v[1] * 0.35 : 0;
      b.v[0] *= 0.985;
      b.v[2] *= 0.985;
    }
    // По полу — трение; стены и мебель отталкивают.
    if (ny <= 0.046) {
      const k = Math.exp(-dt * 1.4);
      b.v[0] *= k;
      b.v[2] *= k;
    }
    const got = step({ x: b.p[0], z: b.p[2] }, nx, nz, 0.05);
    if (Math.abs(got.x - nx) > 1e-4) b.v[0] = -b.v[0] * 0.5;
    if (Math.abs(got.z - nz) > 1e-4) b.v[2] = -b.v[2] * 0.5;
    nx = got.x;
    nz = got.z;
    // Кот бьёт лапой: клубок отскакивает.
    const c = this.cat;
    if (c && c.mind === 'play' && Math.hypot(c.x - nx, c.z - nz) < 0.24 && Math.hypot(b.v[0], b.v[2]) < 0.4 && ny < 0.06) {
      const a = c.yaw + (Math.sin(b.t * 13) > 0 ? 0.7 : -0.7);
      b.v[0] = Math.sin(a) * 1.4;
      b.v[2] = Math.cos(a) * 1.4;
      b.v[1] = 0.6;
    }
    // Укатившись, клубок лежит; кот бросил играть — клубок убирается.
    const roll = Math.hypot(b.v[0], b.v[2]);
    b.mesh.rotation.x += (b.v[2] / 0.045) * dt;
    b.mesh.rotation.z -= (b.v[0] / 0.045) * dt;
    b.p = [nx, ny, nz];
    b.mesh.position.set(this.host.origin.x + nx, this.host.origin.y + ny, this.host.origin.z + nz);
    if (c && c.mind !== 'play' && roll < 0.05 && b.t > 3) {
      b.on = false;
      b.mesh.visible = false;
      this.changed();
    }
  }

  // ---------- Кадр ----------

  step(dt: number): void {
    this.clock.t += dt;
    // Сценарии.
    for (const j of [...this.jobs]) {
      if (j.c && !j.c()) continue;
      const n = j.s.next();
      if (n.done) this.jobs.splice(this.jobs.indexOf(j), 1);
      else j.c = n.value;
    }
    // Дверь: створка догоняет цель плавно.
    const d = this.door.goal - this.door.a;
    if (Math.abs(d) > 1e-3) {
      this.door.a += Math.sign(d) * Math.min(Math.abs(d), dt * (0.6 + Math.abs(d) * 1.4));
      this.placeLeaf();
    }
    const r = this.host.ruler();
    for (const p of this.folk.values()) {
      if (!p.visible) continue;
      p.step(dt, softFloor);
      // Ступени тамбура — ниже площадки.
      p.y = floorAt(p.x, p.z);
      // Речь: жест рук, пока говорит.
      const left = this.speaking.get(p.id) ?? 0;
      if (left > 0) this.speaking.set(p.id, left - dt);
      p.want.talk = left > 0 ? 1 : 0;
      // Взгляд — на правителя, когда стоит рядом; в пути — вперёд.
      const near = Math.hypot(r.x - p.x, r.z - p.z) < 3.2 && !p.moving;
      const eyeYaw = Math.atan2(r.eye[0] - p.x, r.eye[2] - p.z) - p.yaw;
      const eyePitch = Math.atan2(r.eye[1] - 1.6, Math.hypot(r.eye[0] - p.x, r.eye[2] - p.z));
      p.want.lookYaw = near ? wrapA(eyeYaw) : 0;
      p.want.lookPitch = near ? eyePitch : 0;
    }
    // Кот: мозг, клубок, на руках слуги.
    const c = this.cat;
    if (c?.visible) {
      const s = this.folk.get('servant');
      if (s?.visible && s.carry === 'cat' && s.g.carry > 0.5) {
        const at = s.rig.at('chest', [0, -0.16, 0.2]);
        c.held = { x: at[0], y: at[1] - 0.2, z: at[2], yaw: s.yaw + Math.PI / 2 };
      } else if (c.held && s?.carry !== 'cat') c.held = null;
      const before = c.place;
      c.step(dt, { ruler: { x: r.x, z: r.z, yaw: r.yaw, busy: r.inAct }, ball: this.ball?.on ? { x: this.ball.p[0], y: this.ball.p[1], z: this.ball.p[2], moving: true } : null });
      if (c.mind === 'play' && this.ball?.on) c.lookAt(this.ball.p[0], this.ball.p[1], this.ball.p[2]);
      else if (c.mind !== 'rest' || c.place !== 'hearth') c.lookAt(r.eye[0], r.eye[1], r.eye[2]);
      if (c.place !== before) this.remember();
    }
    this.stepBall(dt);
    if (this.took) this.took.t += dt;
    if (this.night && this.night.t > -1e8) {
      this.night.t += dt;
      this.night.k = Math.min(1, this.night.t / NIGHT_LEN);
    }
    this.changed();
  }

  /** Поставить сетки кадра: люди, кот, кувшин и струя вина. */
  draw(): void {
    const o: V3 = [this.host.origin.x, this.host.origin.y, this.host.origin.z];
    for (const p of this.folk.values()) p.draw(o);
    this.cat?.draw(o);
    this.drawJug();
    this.drawPapers();
  }

  /**
   * Письмо в правой руке гонца (сложенный лист пергамента, шнур и печать красного воска с гербом державы) и свиток в
   * левой руке советника. Взятое письмо летит к правителю и гаснет у его руки.
   */
  private drawPapers(): void {
    const h = this.folk.get('herald');
    const a = this.folk.get('advisor');
    const showL = (!!h?.visible && h.carry === 'letter') || this.took !== null;
    const showS = !!a?.visible && a.carry === 'scroll';
    if (showL && !this.letterMesh) this.letterMesh = this.paper('letter');
    if (showS && !this.scrollMesh) this.scrollMesh = this.paper('scroll');
    if (this.letterMesh) {
      this.letterMesh.visible = showL;
      if (this.took) {
        // Письмо — к правой руке правителя: полсекунды и в руке (дальше его читают «Вести»).
        const r = this.host.ruler();
        const to = new THREE.Vector3(this.host.origin.x + r.eye[0] + Math.sin(r.yaw) * 0.32, this.host.origin.y + r.eye[1] - 0.35, this.host.origin.z + r.eye[2] + Math.cos(r.yaw) * 0.32);
        const k = Math.min(1, this.took.t / 0.45);
        this.letterMesh.position.lerpVectors(this.took.from, to, k * k * (3 - 2 * k));
        if (k >= 1) {
          this.took = null;
          this.letterMesh.visible = false;
        }
      } else if (showL && h) this.inHand(this.letterMesh, h, 'R');
    }
    if (this.scrollMesh) {
      this.scrollMesh.visible = showS;
      if (showS && a) this.inHand(this.scrollMesh, a, 'L');
    }
  }

  /** Поставить вещь в кисть человека: оси кисти, точка у ладони. */
  private inHand(mesh: THREE.Mesh, p: Person, side: 'L' | 'R'): void {
    const grip = gripOf(p.rig.sk, side);
    const bone = side === 'R' ? 'handR' : 'handL';
    const j = p.rig.sk.bones[p.rig.sk.of(bone)].j;
    const at = p.rig.at(bone, [grip[0] - j[0], grip[1] - j[1], grip[2] - j[2]]);
    const R = p.rig.axes(bone);
    MAT.set(R[0], R[3], R[6], 0, R[1], R[4], R[7], 0, R[2], R[5], R[8], 0, 0, 0, 0, 1);
    mesh.quaternion.setFromRotationMatrix(MAT);
    mesh.position.set(this.host.origin.x + at[0], this.host.origin.y + at[1], this.host.origin.z + at[2]);
  }

  /** Сетки бумаг: письмо — в осях кисти (лист поперёк ладони), свиток — вдоль пальцев. */
  private paper(kind: 'letter' | 'scroll'): THREE.Mesh {
    const b = new Mesher();
    const parch = tint(0xd8c8a0);
    const cord = tint(0x6a4a2a);
    if (kind === 'letter') {
      b.code = LIFE_CODE.letter;
      // Сложенный лист 16 × 11 см стоймя за нижний край в щепоти: в осях кисти пальцы — к −y, большой палец — к +z, так
      // что лист — поперёк пальцев (x — ширина, z — высота), лицом туда, куда пальцы (к правителю). На лице — загнутый
      // клапан, шнур крест-накрест и печать красного воска.
      const f = -0.068;
      b.cuboid(-0.08, f, -0.025, 0.08, f + 0.008, 0.085, 'plain', parch);
      b.cuboid(-0.079, f - 0.003, 0.03, 0.079, f, 0.084, 'plain', mixV(parch, tint(0xa89068), 0.4));
      b.cuboid(-0.081, f - 0.0055, 0.024, 0.081, f - 0.003, 0.034, 'plain', cord);
      b.cuboid(-0.004, f - 0.0055, -0.026, 0.004, f - 0.003, 0.086, 'plain', cord);
      // Печать: токарный диск на перекрестье шнура, ось — из листа к правителю (−y).
      b.shine = 0.45;
      b.at(0, f - 0.0055, 0.029, 0, Math.PI);
      b.lathe(
        [
          [0, 0],
          [0.017, 0],
          [0.019, 0.004],
          [0.015, 0.008],
          [0, 0.009],
        ],
        10,
        'plain',
        tint(0x9a1a16),
      );
    } else {
      // Свиток доклада: пергамент на двух палочках тёмного дерева.
      b.lathe(
        [
          [0, -0.12],
          [0.02, -0.12],
          [0.021, 0.12],
          [0, 0.12],
        ],
        9,
        'plain',
        parch,
      );
      for (const y of [-0.13, 0.13]) b.beam([0, y - 0.012, 0], [0, y + 0.012, 0], 0.026, 0.026, 'plain', tint(0x3a2416));
    }
    const m = new THREE.Mesh(geometryOf(b.b), this.host.material);
    m.name = kind === 'letter' ? 'chambers-letter' : 'chambers-scroll';
    this.host.scene.add(m);
    return m;
  }

  /** Кувшин в правой руке служанки и струя вина из носика в кубок. */
  private drawJug(): void {
    const m = this.folk.get('maid');
    const show = !!m?.visible && m.carry === 'jug';
    if (show && !this.jug) {
      const b = new Mesher();
      b.shine = 0.35;
      b.lathe(
        [
          [0, 0],
          [0.05, 0],
          [0.065, 0.04],
          [0.07, 0.1],
          [0.055, 0.16],
          [0.032, 0.2],
          [0.036, 0.235],
          [0, 0.235],
        ],
        12,
        'plain',
        tint(0x9a5a34),
      );
      // Носик и ручка.
      b.beam([0.03, 0.215, 0], [0.075, 0.235, 0], 0.02, 0.016, 'plain', tint(0x9a5a34));
      b.beam([-0.06, 0.07, 0], [-0.085, 0.17, 0], 0.016, 0.022, 'plain', tint(0x8a4a2a));
      // Кувшин держат за горло (точка у ладони) — модель стоит ниже кисти.
      const g = geometryOf(b.b);
      g.translate(0, -0.2, 0);
      this.jug = new THREE.Mesh(g, this.host.material);
      this.jug.name = 'chambers-jug';
      this.host.scene.add(this.jug);
      // Струя: тонкий брусок единичной длины — тянется от носика к чаше.
      const w = new Mesher();
      w.shine = 0.55;
      w.beam([0, -0.5, 0], [0, 0.5, 0], 0.007, 0.007, 'plain', tint(0x4a0812));
      this.stream = new THREE.Mesh(geometryOf(w.b), this.host.material);
      this.stream.name = 'chambers-wine-stream';
      this.host.scene.add(this.stream);
    }
    if (!this.jug || !this.stream) return;
    this.jug.visible = show;
    this.stream.visible = show && this.pouring > 0;
    if (!show || !m) return;
    const grip = gripOf(m.rig.sk, 'R');
    const j = m.rig.sk.bones[m.rig.sk.of('handR')].j;
    const at = m.rig.at('handR', [grip[0] - j[0], grip[1] - j[1], grip[2] - j[2]]);
    const R = m.rig.axes('handR');
    // Оси кувшина — оси кисти: верх кувшина — вверх по руке, носик — вперёд пальцев.
    MAT.set(R[0], R[3], R[6], 0, R[1], R[4], R[7], 0, R[2], R[5], R[8], 0, 0, 0, 0, 1);
    this.jug.quaternion.setFromRotationMatrix(MAT);
    // Кувшин висит в руке горлом вверх: поворот кисти на пол-оборота вокруг её оси x.
    this.jug.quaternion.multiply(FLIP);
    this.jug.position.set(this.host.origin.x + at[0], this.host.origin.y + at[1], this.host.origin.z + at[2]);
    if (this.stream.visible) {
      // Струя — от носика к чаше кубка.
      const spout = new THREE.Vector3(0.075, 0.035, 0).applyQuaternion(this.jug.quaternion).add(this.jug.position);
      const g = this.host.goblet().at;
      const cup = new THREE.Vector3(this.host.origin.x + g[0], this.host.origin.y + g[1], this.host.origin.z + g[2]);
      const mid = spout.clone().add(cup).multiplyScalar(0.5);
      this.stream.position.copy(mid);
      const len = spout.distanceTo(cup);
      this.stream.scale.set(1, Math.max(0.01, len), 1);
      this.stream.quaternion.setFromUnitVectors(UP, cup.clone().sub(spout).normalize());
    }
  }

  /** Письмо гонца в мире: где оно сейчас и протянуто ли (касанию и тестам). */
  letterAt(): THREE.Vector3 | null {
    return this.letterOut && this.letterMesh?.visible ? this.letterMesh.position : null;
  }

  private placeLeaf(): void {
    const h = DOOR_HINGE;
    this.leaf.position.set(this.host.origin.x + h[0], this.host.origin.y + h[1], this.host.origin.z + h[2]);
    this.leaf.rotation.set(0, this.door.a, 0);
  }

  /** Открыта ли дверь (доля). */
  get doorOpen(): number {
    return this.door.a / OPEN;
  }

  /** Стенду и тестам: поставить людей и кота сразу (без сцен). */
  stage(what: { who?: Who; at?: { x: number; z: number; yaw: number }; gesture?: Partial<Person['g']>; cat?: CatSpot['id'] | 'floor'; catAt?: { x: number; z: number; yaw: number }; door?: number; wine?: number; carry?: Person['carry']; talk?: boolean; why?: Why; pouring?: boolean; night?: { k: number; who: Who }; letter?: boolean }): void {
    if (what.who) {
      const p = this.person(what.who);
      p.visible = true;
      const at = what.at ?? INSIDE;
      p.place(at.x, at.z, (at as { yaw?: number }).yaw ?? 0);
      if (what.gesture) Object.assign(p.g, what.gesture), Object.assign(p.want, what.gesture);
      if (what.carry) p.carry = what.carry;
      if (what.talk) this.talking = { who: what.who, why: what.why ?? 'arrive', n: ++this.talkN };
      // Гонец с протянутым письмом, советник со свитком.
      if (what.who === 'herald' && what.letter) {
        p.carry = 'letter';
        this.letterOut = true;
      }
      if (what.who === 'advisor') p.carry = 'scroll';
    }
    if (what.cat) {
      const c = this.ensureCat();
      if (what.cat === 'floor') c.appear(0.8, 0.4, 0.6);
      else c.settle(what.cat);
    }
    if (what.catAt) this.ensureCat().sitAt(what.catAt.x, what.catAt.z, what.catAt.yaw);
    if (what.door !== undefined) {
      this.door.a = what.door * OPEN;
      this.door.goal = this.door.a;
      this.placeLeaf();
    }
    if (what.wine !== undefined) this.wine = what.wine;
    if (what.pouring !== undefined) this.pouring = what.pouring ? 1 : 0;
    // Ночь стоит на доле (стенд снимает затемнение с сердцем): часы ночи не идут.
    if (what.night) this.night = { k: what.night.k, who: what.night.who, t: -1e9 };
    this.changed();
  }

  /** Касание: кто под лучом (люди и кот — коробками вокруг тела, письмо гонца — вокруг листа). */
  pick(ray: THREE.Ray): LifePick | null {
    let best: LifePick | null = null;
    const o = this.host.origin;
    for (const p of this.folk.values()) {
      if (!p.visible) continue;
      BOX.min.set(o.x + p.x - 0.3, o.y, o.z + p.z - 0.3);
      BOX.max.set(o.x + p.x + 0.3, o.y + 1.8, o.z + p.z + 0.3);
      const hit = ray.intersectBox(BOX, V);
      if (hit) {
        const d = V.distanceTo(ray.origin);
        if (!best || d < best.d) best = { kind: 'folk', who: p.id, d };
      }
    }
    // Письмо в протянутой руке гонца — точнее его тела: коробка с палец вокруг листа.
    const lt = this.letterAt();
    if (lt) {
      BOX.min.set(lt.x - 0.12, lt.y - 0.12, lt.z - 0.12);
      BOX.max.set(lt.x + 0.12, lt.y + 0.12, lt.z + 0.12);
      const hit = ray.intersectBox(BOX, V);
      if (hit) {
        const d = V.distanceTo(ray.origin) - 0.35;
        if (!best || d < best.d) best = { kind: 'letter', d };
      }
    }
    const c = this.cat;
    if (c?.visible) {
      BOX.min.set(o.x + c.x - 0.28, o.y + c.y, o.z + c.z - 0.28);
      BOX.max.set(o.x + c.x + 0.28, o.y + c.y + 0.4, o.z + c.z + 0.28);
      const hit = ray.intersectBox(BOX, V);
      if (hit) {
        const d = V.distanceTo(ray.origin) - 0.2;
        if (!best || d < best.d) best = { kind: 'cat', d };
      }
    }
    return best;
  }

  /** Треугольники живых — бюджету покоев. */
  counts(): { triangles: number; meshes: number } {
    let t = 0;
    let n = 1;
    for (const p of this.folk.values())
      if (p.visible) {
        t += p.rig.triangles;
        n++;
      }
    if (this.cat?.visible) {
      t += this.cat.rig.triangles;
      n++;
    }
    return { triangles: t, meshes: n };
  }

  dispose(): void {
    for (const p of this.folk.values()) p.rig.dispose();
    this.cat?.rig.dispose();
    this.leaf.geometry.dispose();
    this.ball?.mesh.geometry.dispose();
    this.jug?.geometry.dispose();
    this.stream?.geometry.dispose();
    this.letterMesh?.geometry.dispose();
    this.scrollMesh?.geometry.dispose();
    this.jobs = [];
    this.onChange = null;
    this.onRemember = null;
    this.onSpeak = null;
    this.onLetter = null;
  }
}

/** Что под лучом касания: человек, кот или письмо гонца. */
export type LifePick = { kind: 'folk'; who: Who; d: number } | { kind: 'cat'; d: number } | { kind: 'letter'; d: number };

/** Сколько длится ночь вдвоём, с: затемнение, сердце, музыка — и утро проступает. */
export const NIGHT_LEN = 7.5;

const BOX = new THREE.Box3();
const V = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const MAT = new THREE.Matrix4();
const FLIP = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);

const mixV = (a: V3, b: V3, k: number): V3 => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];

const wrapA = (a: number): number => {
  let x = a % (2 * Math.PI);
  if (x <= -Math.PI) x += 2 * Math.PI;
  if (x > Math.PI) x -= 2 * Math.PI;
  return x;
};

