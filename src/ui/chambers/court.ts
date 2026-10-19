// Двор покоев (docs/city_v3.md, Г-10): кто идёт к правителю с делом. Гонец — за важной вестью, пришедшей, пока правитель в
// покоях; советник — с докладом после отлучки. Здесь — только очередь и память: что за весть и что в докладе, решает
// `tidings.ts`, как люди идут, кланяются и протягивают письмо — режиссёр жизни (`render/chambers/life.ts`), куда ведёт
// строка — двери игры, которые даёт слой покоев (`host.open`).
import { ADVISOR_POST, type ChambersLife } from '@/render/chambers/life';
import { advisorReport, freshNews, newsOf, type AdvisorInput, type AdvisorMemory, type News, type NewsDoor, type ReportLine, type WorldNews } from './tidings';

/** Что двору даёт слой покоев: мир, партия, память советника и двери игры. */
export interface CourtHost {
  world(): WorldNews;
  advisor(): AdvisorInput;
  memory(): AdvisorMemory;
  remember(m: AdvisorMemory): void;
  /** Открыть весть или донесение — поверх покоев: закрыл окно — снова в покоях. */
  open(door: NewsDoor): void;
  /** Отложить дело на `ms` (письмо долетает до руки, потом весть открывается). Тестам — сразу. */
  later(f: () => void, ms: number): void;
}

/** Сколько письмо летит из руки гонца к правителю, мс (`life.drawPapers`, 0,45 с), — потом открывается весть. */
export const LETTER_FLIGHT_MS = 480;

export class Court {
  /** Ключи вестей, о которых уже знают: при входе — все, что были (их доложит советник); потом — принесённые. */
  private seen: Set<string>;
  private queue: News[] = [];
  /** Весть, с которой гонец идёт или стоит. */
  carrying: News | null = null;
  /** Доклад советника и какие строки уже открывали. */
  report: { lines: ReportLine[]; opened: Set<string> } | null = null;
  /** Слою выше: переменилось то, что он показывает. */
  onChange: (() => void) | null = null;

  constructor(
    private life: ChambersLife,
    private host: CourtHost,
  ) {
    this.seen = new Set(newsOf(host.world()).map((n) => n.key));
    life.onLetter = () => this.delivered();
  }

  /**
   * Вход в покои: была отлучка и есть что сказать — советник ждёт у стола. Память обновляется сразу (с этой минуты
   * доклад сделан): выйти и войти — второй раз о том же он не заговорит.
   */
  greet(): boolean {
    const r = advisorReport(this.host.advisor(), this.host.memory());
    if (!r) return false;
    this.host.remember(r.next);
    if (r.lines.length === 0) return false;
    this.report = { lines: r.lines, opened: new Set() };
    this.life.advisorWaits();
    this.onChange?.();
    return true;
  }

  /** Мир переменился (пульс, письмо, донесение): новые важные вести — в очередь, и гонец идёт, если может. */
  look(): void {
    const now = newsOf(this.host.world());
    for (const n of freshNews(now, this.seen)) {
      this.seen.add(n.key);
      this.queue.push(n);
    }
    // Ушедшее со стола до прихода гонца (ответили в «Вестях», набег отбит) — уже не весть.
    const live = new Set(now.map((n) => n.key));
    this.queue = this.queue.filter((n) => live.has(n.key));
    this.call();
  }

  /** Позвать гонца: есть весть и в покоях можно (нет сцены, разговора, ночи, другого гонца). Зовётся и раз в секунду. */
  call(): void {
    if (this.carrying || this.queue.length === 0) return;
    if (!this.life.summonHerald()) return;
    this.carrying = this.queue.shift()!;
    this.onChange?.();
  }

  /** Сколько вестей ждёт гонца — тестам и стенду. */
  get waiting(): number {
    return this.queue.length;
  }

  /** «Позже»: гонец кланяется и уходит, весть остаётся в «Вестях». */
  decline(): void {
    if (!this.carrying) return;
    this.carrying = null;
    this.life.order('dismiss');
    this.onChange?.();
  }

  /** Правитель взял письмо — гонец уходит сам (`life.takeLetter`), весть открывается, когда письмо в руке. */
  private delivered(): void {
    const n = this.carrying;
    this.carrying = null;
    this.onChange?.();
    if (n) this.host.later(() => this.host.open(n.door), LETTER_FLIGHT_MS);
  }

  /** Строка доклада: открыть её донесение; советник ждёт дальше — слушать остальное или «Ступай». */
  openLine(key: string): void {
    const l = this.report?.lines.find((x) => x.key === key);
    if (!l || !this.report) return;
    this.report.opened.add(key);
    this.host.open(l.door);
    this.onChange?.();
  }

  /** «Ступай»: советник кланяется и уходит. */
  dismiss(): void {
    if (this.life.view().talk?.who === 'advisor') this.life.order('dismiss');
    this.report = null;
    this.onChange?.();
  }

  /**
   * Стенду снимков (`scripts/city-shots.ts`, `COURT=`): гонец с письмом этой вести стоит перед правителем, или советник у
   * стола с этим докладом — сразу, без сцен (сцены держат тесты).
   */
  stage(what: { herald?: News; report?: ReportLine[]; opened?: string[]; at?: { x: number; z: number; yaw: number } }): void {
    if (what.herald) {
      this.carrying = what.herald;
      this.life.stage({ who: 'herald', at: what.at, letter: true, talk: true, why: 'news', gesture: { offer: 1 } });
    }
    if (what.report) {
      this.report = { lines: what.report, opened: new Set(what.opened ?? []) };
      this.life.stage({ who: 'advisor', at: what.at ?? ADVISOR_POST, talk: true, why: 'report', gesture: { read: 1 } });
    }
    this.onChange?.();
  }

  dispose(): void {
    this.life.onLetter = null;
    this.onChange = null;
  }
}
