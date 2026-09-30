/**
 * Сторож плавности — одна дверь на предысторию и посёлок.
 *
 * Кормится длительностью каждого кадра и отвечает, не пора ли опустить ступень графики.
 * Кадров он не считает сам и часов не читает: время приносит сцена. Опускает только вниз
 * и только по одному шагу за окно: вверх он не ходит нарочно — ступень, прыгающая туда
 * и обратно, дёргает картинку сильнее, чем любая из двух.
 *
 * Лестница ступеней и пороги — свои у каждой сцены: у предыстории цель тридцать
 * (`prologue/look.THIRTY`), у посёлка — шестьдесят (`quality.VILLAGE_STEADY`). Второго
 * сторожа не заводить: два судьи «тянет ли телефон» разошлись бы молча, и заметил бы это
 * телефон, у которого одна сцена опустила графику, а другая — нет.
 */

/** Что сторож считает провалом и сколько терпит. */
export interface SteadyRule {
  /** Кадр дольше этого, мс, — медленный. */
  slowMs: number;
  /** Доля медленных кадров в окне, при которой ступень опускается. */
  share: number;
  /** Окно, мс. */
  windowMs: number;
  /** Сколько кадров после смены ступени не судить: сборка шейдеров и новые цели. */
  warm: number;
  /** Промежуток длиннее этого, мс, — не кадр, а пауза (фон, сборка мусора, клавиатура). */
  gapMs: number;
}

export class Steady<T> {
  private warm: number;
  private spent = 0;
  private slow = 0;
  private count = 0;

  /**
   * `ladder` — ступени от дорогой к дешёвой; `rule` — правило целиком или своё у каждой
   * ступени (с высокой на среднюю посёлок падает строже, чем со средней на низкую).
   */
  constructor(
    private readonly ladder: readonly T[],
    public tier: T,
    private readonly rule: SteadyRule | ((tier: T) => SteadyRule),
  ) {
    this.warm = this.ruleOf(tier).warm;
  }

  private ruleOf(tier: T): SteadyRule {
    return typeof this.rule === 'function' ? this.rule(tier) : this.rule;
  }

  /** Длительность очередного кадра, мс. Вернёт новую ступень, если эту пора опустить. */
  feed(ms: number): T | null {
    const r = this.ruleOf(this.tier);
    if (ms > r.gapMs || ms <= 0) return null;
    if (this.warm > 0) {
      this.warm--;
      return null;
    }
    this.spent += ms;
    this.count++;
    if (ms > r.slowMs) this.slow++;
    if (this.spent < r.windowMs) return null;
    const failing = this.slow / this.count >= r.share;
    this.spent = 0;
    this.slow = 0;
    this.count = 0;
    if (!failing) return null;
    const next = this.ladder[this.ladder.indexOf(this.tier) + 1];
    if (next === undefined) return null;
    this.set(next);
    return next;
  }

  /** Сменить ступень руками (стенд, адрес): окно начинается заново, прогрев тоже. */
  set(tier: T): void {
    this.tier = tier;
    this.warm = this.ruleOf(tier).warm;
    this.spent = 0;
    this.slow = 0;
    this.count = 0;
  }
}
