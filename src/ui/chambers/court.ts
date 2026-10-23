// Двор покоев (docs/city_v3.md, ПК-1): кто идёт к правителю с делом. Что за весть и что о ней сказать — `tidings.ts`, как
// люди идут и кланяются — режиссёр жизни (`render/chambers/life.ts`), куда ведёт строка — двери игры (`host.open`).
//
// **Приходов по часам нет.** Двор действует на два повода: вход в покои (`enter`) и перемену журнала, пока правитель в
// покоях (`look`, зовёт её слой покоев на перемене стора).
//
// Гонец — только с вестью, случившейся после входа (минута вести позже минуты входа, своими часами): стук в дверь, справа
// внизу «Впустить» и «Позже». Впустили — входит, кланяется, рассказывает все вести разом. «Позже» — вести ждут до
// следующего входа, и гонец там первым. Советник — при входе, если правителя не было дольше `AWAY_MS` и за это время есть
// важное: до `REPORT_MAX` вестей по важности, ни одной дважды; иначе стоит у стола, кивает и молчит.
import { ADVISOR_POST, type ChambersLife } from '@/render/chambers/life';
import { after, byWeight, HERALD_KINDS, IMPORTANT, tell, tidingsOf, WEIGHT, type CourtSource, type Moment, type NewsDoor, type Telling, type Tiding } from './tidings';

/** Отлучка, после которой советник встречает с докладом: пятнадцать настоящих минут (часы игрока, без ускорения). */
export const AWAY_MS = 15 * 60_000;
/** Вестей в докладе — не больше. */
export const REPORT_MAX = 3;
/** Сколько ключей сказанного помнить: старые вести из журнала уходят раньше. */
const TOLD_MAX = 400;

/** Память двора на устройстве (не партия): когда правитель был в покоях, что уже сказано и что отложено «Позже». */
export interface CourtMemory {
  /** Настоящая минута, когда правитель последний раз был в покоях (`serverNow`); `null` — ещё не был. */
  seenAt: number | null;
  /** Та же минута на трёх часах: доклад — о том, что случилось позже. */
  out: Moment | null;
  /** Ключи вестей, о которых уже сказали гонец или советник. */
  told: string[];
  /** Вести, отложенные «Позже»: ссылки, а не слова — слова строятся в минуту рассказа. */
  later: Tiding[];
  /** Отметки двора для того, что журнал не датирует (кончился хлеб, поход соседа): ключ → настоящая минута. */
  stamps: Record<string, number>;
}

export const freshCourt = (): CourtMemory => ({ seenAt: null, out: null, told: [], later: [], stamps: {} });

/** Что двору даёт слой покоев. */
export interface CourtHost {
  source(): CourtSource;
  now(): Moment;
  memory(): CourtMemory;
  remember(m: CourtMemory): void;
  /** Открыть место вести — поверх покоев: закрыл окно — снова в покоях. */
  open(door: NewsDoor): void;
}

export class Court {
  /** Минута входа в покои: гонец носит только то, что позже. */
  entry: Moment | null = null;
  /** Гонец стучит: эти вести за дверью, внизу «Впустить» и «Позже». */
  knocking: Tiding[] | null = null;
  /** Гонца впустили: с чем он идёт и рассказывает. */
  carrying: Tiding[] | null = null;
  /** Доклад советника: строки и какая сейчас (касание — дальше). */
  report: { lines: Telling[]; at: number } | null = null;
  /** Слова гонца, поставленные стендом снимков (`stage`): у стенда нет журнала. */
  private heard: Telling[] | null = null;
  /** Доклад, ждущий гонца: гонец — первым. */
  private pending: Telling[] | null = null;
  /** «Впустить» нажато, а покои заняты (сцена, разговор): войдёт, как освободятся. */
  private admitting = false;
  onChange: (() => void) | null = null;

  constructor(
    private life: ChambersLife,
    private host: CourtHost,
  ) {}

  /** Вести журнала с отметками двора: недатированное получает минуту первого взгляда, ушедшее — отметку теряет. */
  private stamped(src: CourtSource, real: number): Tiding[] {
    const mem = this.host.memory();
    const raw = tidingsOf(src, Math.min(this.entry?.game ?? Infinity, mem.out?.game ?? -Infinity));
    const seen = new Set<string>();
    let moved = false;
    const out: Tiding[] = raw.map((r) => {
      if (r.at !== null) return r as Tiding;
      seen.add(r.id);
      let at = mem.stamps[r.id];
      if (at === undefined) {
        at = mem.stamps[r.id] = real;
        moved = true;
      }
      return { ...r, id: `${r.id}@${at}`, at };
    });
    for (const k of Object.keys(mem.stamps)) {
      // Походы соседей видны, только когда мир встал: до того «нет похода» — неправда, отметку не трогать.
      if (seen.has(k) || (!src.ready && k.startsWith('war:'))) continue;
      delete mem.stamps[k];
      moved = true;
    }
    if (moved) this.host.remember(mem);
    return out;
  }

  /** Рассказ вестей сейчас: устаревшее — исходом, сказать нечего — молча мимо. */
  tellings(list: readonly Tiding[]): Telling[] {
    const src = this.host.source();
    return list.map((t) => tell(t, src)).filter((x): x is Telling => x !== null);
  }

  /** Что гонец рассказывает — в минуту, когда встал перед правителем. */
  heraldLines(): Telling[] {
    return this.heard ?? this.tellings(this.carrying ?? []);
  }

  private told(list: readonly Tiding[]): void {
    const mem = this.host.memory();
    const ids = new Set(list.map((t) => t.id));
    mem.told = [...mem.told.filter((k) => !ids.has(k)), ...ids].slice(-TOLD_MAX);
    mem.later = mem.later.filter((t) => !ids.has(t.id));
    this.host.remember(mem);
  }

  /**
   * Вход в покои. Сперва гонец с отложенным «Позже» (стук), потом советник: доклад, если отлучка дольше `AWAY_MS` и за неё
   * было важное, иначе — стоит у стола, кивает. Память — сразу: выйти и войти — второй раз о том же не заговорят.
   */
  enter(): void {
    const now = this.host.now();
    const mem = this.host.memory();
    // Отметки входа — «до входа»: что журнал не датирует и что видно уже при входе, случилось в отлучку.
    const list = this.stamped(this.host.source(), now.real - 1);
    this.entry = now;
    const away = mem.seenAt === null ? 0 : now.real - mem.seenAt;
    let lines: Telling[] = [];
    if (mem.out && away > AWAY_MS) {
      const skip = new Set([...mem.told, ...mem.later.map((t) => t.id)]);
      const fresh = list.filter((t) => after(t, mem.out!) && !skip.has(t.id)).sort(byWeight);
      for (const x of this.tellings(fresh)) if (lines.length < REPORT_MAX) lines.push(x);
      if (!lines.some((l) => WEIGHT[l.t.kind] >= IMPORTANT)) lines = [];
    }
    mem.seenAt = now.real;
    mem.out = now;
    this.host.remember(mem);
    const later = this.tellings(mem.later);
    // Вернулся в покои, пока гонец стучал (аппку сворачивали): стучит он с прежним и с отложенным разом.
    const at = new Set((this.knocking ?? []).map((t) => t.id));
    if (later.length > 0) this.knock([...(this.knocking ?? []), ...later.map((l) => l.t).filter((t) => !at.has(t.id))]);
    else if (mem.later.length > 0) {
      mem.later = [];
      this.host.remember(mem);
    }
    if (lines.length > 0) {
      this.told(lines.map((l) => l.t));
      if (this.knocking) {
        this.pending = lines;
        this.life.advisorStands();
      } else this.startReport(lines);
    } else this.life.advisorStands();
    this.onChange?.();
  }

  /** Правитель всё ещё в покоях (или уходит): минута присутствия — от неё мерится следующая отлучка. */
  presence(): void {
    const mem = this.host.memory();
    const now = this.host.now();
    mem.seenAt = now.real;
    mem.out = now;
    this.host.remember(mem);
  }

  /** Журнал переменился: новые важные вести после входа — гонец стучит; устаревшее за дверью — исходом или молча мимо. */
  look(): void {
    if (!this.entry) return;
    const now = this.host.now();
    const mem = this.host.memory();
    const list = this.stamped(this.host.source(), now.real);
    const known = new Set([...mem.told, ...mem.later.map((t) => t.id), ...(this.knocking ?? []).map((t) => t.id), ...(this.carrying ?? []).map((t) => t.id)]);
    const fresh = list.filter((t) => HERALD_KINDS.has(t.kind) && after(t, this.entry!) && !known.has(t.id));
    const was = this.knocking;
    const door = [...(was ?? []), ...fresh];
    const live = this.tellings(door).map((l) => l.t);
    if (live.length === 0) {
      if (was) {
        this.knocking = null;
        this.admitting = false;
        this.afterHerald();
      }
      return;
    }
    if (!was) this.knock(live);
    else this.knocking = live;
    this.onChange?.();
  }

  /** Стук в дверь: гонец за дверью с этими вестями. */
  private knock(list: Tiding[]): void {
    this.knocking = list.sort(byWeight);
    this.life.heraldKnocks();
    this.onChange?.();
  }

  /** «Впустить»: гонец входит, кланяется и рассказывает; покои заняты — войдёт, как освободятся (`call`). */
  admit(): void {
    if (!this.knocking) return;
    this.admitting = true;
    this.call();
  }

  /** Покои освободились (сцена, разговор кончились): впущенный гонец входит. */
  call(): void {
    if (!this.admitting || !this.knocking || this.carrying) return;
    const list = this.tellings(this.knocking).map((l) => l.t);
    if (list.length === 0) {
      this.knocking = null;
      this.admitting = false;
      this.afterHerald();
      this.onChange?.();
      return;
    }
    if (!this.life.summonHerald()) return;
    this.admitting = false;
    this.knocking = null;
    this.carrying = list;
    this.told(list);
    this.onChange?.();
  }

  /** «Позже»: вести ждут следующего входа, гонец с ними придёт первым. */
  postpone(): void {
    if (!this.knocking) return;
    const mem = this.host.memory();
    const ids = new Set(mem.later.map((t) => t.id));
    mem.later = [...mem.later, ...this.knocking.filter((t) => !ids.has(t.id))];
    this.host.remember(mem);
    this.knocking = null;
    this.admitting = false;
    this.afterHerald();
    this.onChange?.();
  }

  /** Гонец рассказал: «Открыть» — место вести поверх покоев, гонец уходит; без двери — просто уходит. */
  heraldDone(door?: NewsDoor): void {
    if (!this.carrying) return;
    this.carrying = null;
    this.heard = null;
    if (this.life.view().talk?.who === 'herald') this.life.order('dismiss');
    if (door) this.host.open(door);
    this.afterHerald();
    // Пока он говорил, пришло новое — снова стук.
    this.look();
    this.onChange?.();
  }

  /** После гонца — советник, если ждал. */
  private afterHerald(): void {
    const p = this.pending;
    this.pending = null;
    if (p) this.startReport(p);
  }

  private startReport(lines: Telling[]): void {
    this.report = { lines, at: 0 };
    this.life.advisorWaits();
    this.onChange?.();
  }

  /** Касание доклада: следующая весть; последняя — советник замолкает и стоит у стола. */
  next(): void {
    const r = this.report;
    if (!r) return;
    r.at++;
    if (r.at >= r.lines.length) {
      this.report = null;
      if (this.life.view().talk?.who === 'advisor') this.life.endTalk();
    }
    this.onChange?.();
  }

  /** «Открыть» строки доклада: её место поверх покоев; советник ждёт со следующей. */
  openLine(): void {
    const l = this.report?.lines[this.report.at];
    if (!l) return;
    this.host.open(l.door);
    this.next();
  }

  /**
   * Стенду снимков (`scripts/city-shots.ts`, `COURT=`): стук с вестями, гонец перед правителем или советник у стола с
   * докладом — сразу, без сцен (сцены держат тесты).
   */
  stage(what: { knock?: Tiding[]; herald?: Telling[]; report?: Telling[]; at?: { x: number; z: number; yaw: number } }): void {
    if (what.knock) this.knocking = what.knock;
    if (what.herald) {
      this.carrying = what.herald.map((l) => l.t);
      this.heard = what.herald;
      this.life.stage({ who: 'herald', at: what.at, talk: true, why: 'news', gesture: {}, guest: true });
    }
    if (what.report) {
      this.report = { lines: what.report, at: 0 };
      this.life.stage({ who: 'advisor', at: what.at ?? ADVISOR_POST, talk: true, why: 'report', gesture: { read: 1 }, guest: true });
    }
    this.onChange?.();
  }

  dispose(): void {
    this.onChange = null;
  }
}
