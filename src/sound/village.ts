// Музыка деревни: круг дорожек с переливом.
//
// Устроена не так, как музыка боя, и это не небрежность. У боя три слоя одного
// материала, они идут **одновременно** с общего начала, а такт переключает
// громкости. У деревни четыре разные пьесы, они идут **по очереди**, и переход
// между ними — настоящий перелив: одна затухает, пока другая набирает.
//
// Три правила, и все три стоят денег или доверия:
//
// 1. **Без жеста игрока не открывается ничего.** Ни звукового контекста, ни
//    единой загрузки. В вебвью Telegram музыка иначе и не заиграет, но правило
//    шире: молчащая вкладка не должна ничего качать.
// 2. **Выключенный звук не грузит вовсе.** Не «грузит и не играет», а не
//    грузит: это чужой трафик.
// 3. **Качается ровно одна дорожка за раз, и следующая — к концу текущей.**
//    Самый тяжёлый файл 938 КБ; вчетвером они уронили бы первые секунды игры.
//    Поэтому очередь тянется по одной и не раньше, чем за `VILLAGE_LEAD` до
//    конца играющей.
//
// Всё, что музыке нужно от браузера и от часов, спрятано за `VillageHost` и
// `Timer`. Не ради красоты: иначе эти три правила проверялись бы ушами, а так
// их считает тест.
import {
  VILLAGE_DUCK_FADE,
  VILLAGE_FADE,
  VILLAGE_LEAD,
  VILLAGE_TRACKS,
  villageUrl,
  type VillageTrack,
} from './manifest';
import { soundOn } from './settings';

/** Что музыке деревни нужно от среды. */
export interface VillageHost {
  /** Открыть звук. Зовётся ТОЛЬКО из жеста игрока. `false` — звука в этой среде нет. */
  open(): boolean;
  /**
   * Скачать и разобрать дорожку. Наружу отдаёт **длину в секундах** — по ней
   * машинка и заводит будильники. Ноль — файла нет, и это нормальный ответ:
   * сборка без музыки обязана работать молча.
   */
  load(id: string, url: string): Promise<number>;
  /** Пустить дорожку, переливая её поверх предыдущей. */
  play(id: string, fade: number): void;
  /** Отпустить разобранную дорожку: в памяти держим играющую и следующую, не больше. */
  drop(id: string): void;
  /** Общая громкость деревни: 1 — обычная, 0 — заглушена роликом о бое. */
  volume(level: number, fade: number): void;
  stop(): void;
}

/**
 * Часы. Отдельным интерфейсом, потому что круг дорожек — это две отметки на
 * каждую пьесу (пора тянуть следующую, пора переливаться), и проверять их
 * подменой глобального `setTimeout` значило бы проверять не музыку, а vitest.
 */
export interface Timer {
  after(seconds: number, fn: () => void): number;
  cancel(handle: number): void;
}

export const realTimer: Timer = {
  after: (seconds, fn) => setTimeout(fn, Math.max(0, seconds) * 1000) as unknown as number,
  cancel: (handle) => clearTimeout(handle as unknown as ReturnType<typeof setTimeout>),
};

/** Что с музыкой деревни прямо сейчас — для интерфейса и для тестов. */
export type VillageState = 'off' | 'idle' | 'loading' | 'playing' | 'silent';

/** Перемешать. Источник случайности снаружи — тесту нужен предсказуемый. */
function shuffled<T>(items: readonly T[], rnd: () => number): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export class VillageMusic {
  private armed = false;
  private running = false;
  private dead = false;
  /** Качали хоть раз. Отличает «ещё грузится» от «файлов нет вовсе». */
  private tried = false;
  /** Идёт ли загрузка прямо сейчас. Больше одной за раз не бывает. */
  private pulling = false;
  /** Что играет и что уже скачано и ждёт своей очереди. */
  private current: { id: string; seconds: number } | null = null;
  private next: { id: string; seconds: number } | null = null;
  /** Порядок круга и место в нём. */
  private order: VillageTrack[] = [];
  private at = 0;
  /** Что играло прошлым: по нему круг и не даёт повтора подряд. */
  private last: string | null = null;
  /** Дорожка кончилась, а следующая ещё качается — переливаться нечем. */
  private waiting = false;
  private timers: number[] = [];
  private ducked = false;

  constructor(
    private host: VillageHost,
    private timer: Timer = realTimer,
    private enabled: () => boolean = soundOn,
    private rnd: () => number = Math.random,
  ) {}

  /**
   * Жест игрока. Годится любое первое нажатие в интерфейсе — деревня стоит с
   * первой секунды, и отдельной кнопки «включить музыку» у неё нет.
   *
   * Идемпотентно: нажатий будет много, а контекст один.
   */
  arm(): void {
    if (this.dead || !this.enabled()) return;
    if (this.armed) return;
    if (!this.host.open()) return;
    this.armed = true;
    this.running = true;
    this.pull();
  }

  get ready(): boolean {
    return this.armed;
  }

  /**
   * Заглушить на время ролика о бое и вернуть после. Именно заглушить, а не
   * остановить: круг идёт дальше под роликом, и возврат не стоит ни одной
   * загрузки — иначе каждый бой оплачивался бы лишним мегабайтом.
   */
  duck(on: boolean): void {
    if (this.ducked === on) return;
    this.ducked = on;
    if (!this.armed) return;
    this.host.volume(on ? 0 : 1, VILLAGE_DUCK_FADE);
  }

  /** Переключить звук. Включение — тоже жест, поэтому здесь же и открывается контекст. */
  toggle(on: boolean): void {
    if (!on) {
      this.stop();
      return;
    }
    this.arm();
  }

  state(): VillageState {
    if (!this.enabled()) return 'off';
    if (!this.armed) return 'idle';
    if (this.current) return 'playing';
    return this.tried && !this.pulling ? 'silent' : 'loading';
  }

  stop(): void {
    this.running = false;
    this.armed = false;
    this.clearTimers();
    if (this.current) this.host.drop(this.current.id);
    if (this.next) this.host.drop(this.next.id);
    this.current = null;
    this.next = null;
    this.waiting = false;
    this.host.stop();
  }

  dispose(): void {
    this.dead = true;
    this.stop();
  }

  /** Какая дорожка идёт следующей по кругу. Круг пуст — перемешиваем заново. */
  private take(): VillageTrack | null {
    if (VILLAGE_TRACKS.length === 0) return null;
    if (this.at >= this.order.length) {
      this.order = shuffled(VILLAGE_TRACKS, this.rnd);
      // Круг сошёлся так, что первая новая — та же, что играла последней.
      // Меняем её со второй: одна и та же пьеса дважды подряд — это не круг.
      if (this.order.length > 1 && this.order[0].id === this.last) {
        [this.order[0], this.order[1]] = [this.order[1], this.order[0]];
      }
      this.at = 0;
    }
    return this.order[this.at++];
  }

  /** Скачать следующую. Не больше одной загрузки за раз — это и есть правило. */
  private pull(): void {
    if (this.pulling || this.next || !this.running || this.dead) return;
    const track = this.take();
    if (!track) return;
    this.pulling = true;
    void this.host.load(track.id, villageUrl(track)).then((seconds) => {
      this.pulling = false;
      this.tried = true;
      if (!this.running || this.dead) {
        this.host.drop(track.id);
        return;
      }
      // Ноль — файла нет. Молчим: остальные дорожки могут быть на месте, но
      // круг за ними не гоняем, иначе один отсутствующий файл дал бы шквал
      // запросов на каждой отметке.
      if (seconds <= 0) return;
      this.next = { id: track.id, seconds };
      // Играющей нет вовсе (начало игры) или она уже кончилась и ждала —
      // тогда переливаться не во что и не откуда, ставим сразу.
      if (!this.current || this.waiting) this.advance();
    });
  }

  /** Пустить скачанную и завести будильники на её конец. */
  private advance(): void {
    const next = this.next;
    if (!next) return;
    this.next = null;
    this.waiting = false;
    const previous = this.current;
    // Первая дорожка входит переливом из тишины — так у музыки есть начало,
    // а не хлопок на первом же нажатии игрока.
    this.host.play(next.id, VILLAGE_FADE);
    if (previous) this.host.drop(previous.id);
    this.current = next;
    this.last = next.id;
    if (this.ducked) this.host.volume(0, 0);
    this.clearTimers();
    // Две отметки: пора тянуть следующую и пора переливаться. Раньше первой
    // не качаем — в этом всё правило «одна дорожка за раз».
    this.timers.push(this.timer.after(Math.max(1, next.seconds - VILLAGE_LEAD), () => this.pull()));
    this.timers.push(this.timer.after(Math.max(1, next.seconds - VILLAGE_FADE), () => this.turn()));
  }

  /** Дорожка досказана. Есть скачанная — переливаемся, нет — ждём её. */
  private turn(): void {
    if (!this.running || this.dead) return;
    if (this.next) {
      this.advance();
      return;
    }
    // Сеть не успела. Пауза вместо перелива слышна, но круг не рвётся:
    // загрузка договорит своё и пустит дорожку сама.
    this.waiting = true;
    this.pull();
  }

  private clearTimers(): void {
    for (const handle of this.timers) this.timer.cancel(handle);
    this.timers = [];
  }
}
