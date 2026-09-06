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
import { MUSIC_FADE, battleFiles, battleLevels, battleLoop } from './manifest';
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
  /**
   * Пустить все загруженные слои с общего начала, петлёй. `loop` — где петля
   * замыкается; `null` — петля и есть сама дорожка. Слои обязаны замыкаться в
   * одной точке, иначе они разъедутся к третьему кругу; у цельной пьесы такой
   * точки нет, и придумывать её — значит резать её посреди такта.
   */
  start(loop: number | null): void;
  /**
   * Выставить громкости. Ключ — дорожка, значение — 0..1; чего в наборе нет,
   * то молчит. Не «слышен один», а именно набор: в слоях звучит ровно один из
   * трёх, а цельная дорожка ведётся по такту промежуточной громкостью, и
   * второго способа сказать это быть не должно.
   */
  mix(levels: Record<string, number>, fade: number): void;
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
      this.host.start(battleLoop());
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

  /**
   * Скачать боевую музыку. Что именно качать, решает режим (`battleFiles`):
   * три слоя или одна цельная пьеса. Догружать по одному нечего — слои идут с
   * общего начала и одновременно, и приход третьего после начала боя дал бы
   * шов посреди такта.
   */
  private async pull(): Promise<void> {
    await Promise.all(
      battleFiles().map(async ({ id, url }) => {
        const ok = await this.host.load(id, url);
        if (ok) this.have.add(id);
      }),
    );
    this.pulled = true;
  }

  /**
   * Выставить громкости под нынешний слой. Нет дорожки — тишина, и это не сбой.
   *
   * В цельном режиме слой не выбирает материал, а задаёт громкость: такт
   * по-прежнему приходит из раскадровки, и `silence` по-прежнему означает
   * обрыв в тишину перед финалом — просто обрывается одна дорожка, а не
   * гасится третья из трёх.
   */
  private apply(): void {
    if (!this.running) return;
    const levels: Record<string, number> = {};
    // Чего не скачалось, того и нет: молчим, а не ждём отсутствующего файла.
    for (const [id, level] of Object.entries(battleLevels(this.want))) {
      if (this.have.has(id)) levels[id] = level;
    }
    this.host.mix(levels, MUSIC_FADE);
  }
}
