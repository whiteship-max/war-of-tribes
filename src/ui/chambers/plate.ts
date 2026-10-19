// Плашка реплики в покоях (docs/city_v3.md, Г-9): когда она гаснет. Чистый модуль без React — его держат тесты.
//
// Последняя реплика разговора (просьба, прощание, ночь) стоит миг и гаснет. Срок — от мига, когда реплику показали
// (`show`), а не от перерисовки окна: в Г-7 таймер конца заводился заново при каждой перерисовке слоя покоев (раз в 400 мс
// и на каждом шаге ночи), и «Раз просишь — останусь.» висела до утра и после. Ночь гасит плашку сразу; выход из покоев
// снимает весь слой.

/** Сколько последняя реплика стоит на экране, когда разговор кончился, с. */
export const LINGER = 1.7;

/** Сколько секунд говорить реплику (голос без слов — столько же). */
export const speechSeconds = (line: string): number => Math.min(5.5, 0.6 + line.length / 15);

/** Сколько стоит последняя реплика, мс: не меньше `LINGER`, длинную — пока её договаривают. */
export const lingerMs = (line: string): number => (Math.max(LINGER, speechSeconds(line) * 0.7) + 0.2) * 1000;

/** Срок плашки: реплика показана в `show`, у последней — миг гашения. */
export class Plate {
  private closeAt: number | null = null;

  /** Реплика на плашке: последняя — заводит срок, обычная — снимает его (разговор идёт дальше). */
  show(turn: { line: string; end?: boolean }, now: number): void {
    this.closeAt = turn.end ? now + lingerMs(turn.line) : null;
  }

  /** Сколько мс до гашения (`null` — разговор идёт, плашка ждёт ответа). */
  left(now: number): number | null {
    return this.closeAt === null ? null : Math.max(0, this.closeAt - now);
  }

  /** Погасла ли: срок вышел или пришла ночь. */
  gone(now: number, night: boolean): boolean {
    return night || (this.closeAt !== null && now >= this.closeAt);
  }
}
