// Музыка ролика: слои по тактам.
//
// Три правила, и все три структурные, а не пожелания:
//
// 1. **Слой приходит из раскадровки.** Что звучит, решает `Cast.music` — та же
//    таблица по тактам, что и всё остальное. Звук ничего не решает сам: тот же
//    журнал даёт ту же последовательность слоёв.
// 2. **Без жеста игрока не открывается ничего.** Ни звукового контекста, ни
//    единой загрузки. В вебвью Telegram звук по-другому и не заиграет, но
//    правило шире: молчащая вкладка не должна ничего качать.
// 3. **Выключенный звук не грузит файлов вовсе.** Не «грузит и не играет», а
//    не грузит: это чужой трафик.
//
// Всё, что музыке нужно от браузера, спрятано за `AudioHost`. Не ради красоты:
// иначе первые три правила проверялись бы глазами, а так тест считает вызовы.
import { trackOf, trackUrl, MUSIC_FADE, MUSIC_LOOP, type MusicTrack } from './manifest';
import { soundOn } from './settings';
import type { MusicLayer } from '@/battle/replay';

/**
 * Что музыке нужно от среды. Ровно столько и ни строкой больше — всё остальное
 * (какой слой когда) решает раскадровка.
 */
export interface AudioHost {
  /**
   * Открыть звук. Зовётся ТОЛЬКО из жеста игрока. `false` — звука в этой среде
   * нет (сервер, тест, старый вебвью), и это нормальный ответ.
   */
  open(): boolean;
  /**
   * Скачать и разобрать дорожку. `false` — файла нет, и это тоже нормальный
   * ответ: сборка без звуковых файлов обязана работать молча.
   */
  load(id: string, url: string): Promise<boolean>;
  /** Пустить все загруженные слои с общего начала, петлёй. */
  start(loop: number): void;
  /** Слышен один слой, остальные молчат. `null` — тишина. */
  layer(id: string | null, fade: number): void;
  stop(): void;
}

/** Что с музыкой прямо сейчас — для интерфейса и для тестов. */
export type MusicState = 'off' | 'idle' | 'loading' | 'playing' | 'silent';

export class BattleMusic {
  private armed = false;
  private pulling: Promise<void> | null = null;
  /** Качать уже пробовали. Отличает «ещё грузится» от «файлов нет вовсе». */
  private pulled = false;
  private have = new Set<string>();
  private want: MusicLayer = 'silence';
  private running = false;
  private dead = false;

  constructor(
    private host: AudioHost,
    private enabled: () => boolean = soundOn,
  ) {}

  /**
   * Жест игрока: нажатие «Смотреть бой» или самого переключателя звука. До него
   * не открывается контекст и не начинается ни одна загрузка.
   *
   * Идемпотентно: жестов будет много, а контекст один.
   */
  arm(): void {
    if (this.armed || this.dead || !this.enabled()) return;
    this.armed = true;
    if (!this.host.open()) this.armed = false;
  }

  /** Был ли жест. По нему видно, законно ли вообще что-то звучит. */
  get ready(): boolean {
    return this.armed;
  }

  /**
   * Начать ролик. Загрузка идёт отсюда — при первом включении ролика, а не при
   * запуске игры, — и только если жест уже был.
   */
  start(): void {
    if (!this.armed || this.dead || !this.enabled()) return;
    if (this.running) return;
    this.running = true;
    if (!this.pulling) this.pulling = this.pull();
    void this.pulling.then(() => {
      if (!this.running || this.dead) return;
      this.host.start(MUSIC_LOOP);
      this.apply();
    });
  }

  /** Какой слой звучит. Зовётся каждый кадр — поэтому дешёвое и идемпотентное. */
  set(layer: MusicLayer): void {
    if (layer === this.want) return;
    this.want = layer;
    this.apply();
  }

  /** Переключить звук. Тоже жест, поэтому здесь же и открывается контекст. */
  toggle(on: boolean): void {
    if (!on) {
      this.want = 'silence';
      this.running = false;
      this.host.stop();
      return;
    }
    this.arm();
    if (this.armed) this.start();
  }

  state(): MusicState {
    if (!this.enabled()) return 'off';
    if (!this.armed) return 'idle';
    if (this.pulling && !this.pulled) return 'loading';
    // Жест был, качать пробовали, а играть нечем: файлов ещё нет. Это не ошибка.
    return this.have.size === 0 ? 'silent' : 'playing';
  }

  stop(): void {
    this.running = false;
    this.want = 'silence';
    this.host.stop();
  }

  dispose(): void {
    this.dead = true;
    this.stop();
  }

  /** Скачать всё разом: слои идут с общего начала, догружать по одному нечего. */
  private async pull(): Promise<void> {
    const tracks: MusicTrack[] = [];
    for (const layer of ['drums', 'harmony', 'full'] as const) {
      const track = trackOf(layer);
      if (track) tracks.push(track);
    }
    await Promise.all(
      tracks.map(async (track) => {
        const ok = await this.host.load(track.layer, trackUrl(track));
        if (ok) this.have.add(track.layer);
      }),
    );
    this.pulled = true;
  }

  /** Выставить громкости под нынешний слой. Нет дорожки — тишина, и это не сбой. */
  private apply(): void {
    if (!this.running) return;
    const id = this.want !== 'silence' && this.have.has(this.want) ? this.want : null;
    this.host.layer(id, MUSIC_FADE);
  }
}
