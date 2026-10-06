// Музыка эпохи звучит: пьесы из `compose.ts` одна за другой, между ними — пауза (docs/audio.md, раздел 5).
//
// Планировщик с упреждением: `tick(now, horizon)` ставит ноты, начало которых попадает в окно до `now + horizon`. Живая
// игра зовёт его раз в четверть секунды с окном в секунду; офлайн-отрисовка образцов — один раз на всю длину. Код один:
// образец, который слушает владелец, — та же музыка, что в игре.

import { compose, pauseAfter, DRONE_LEAD, DRONE_TAIL, type Piece } from './compose';
import { drone, flute, pluck, type Kit } from './synth';

/** Уровни голосов на выходе музыки — выставлены офлайн-отрисовкой (docs/audio.md, раздел 6). */
export const MUSIC_MIX = { lute: 0.42, flute: 0.3, drone: 1 } as const;

/** Пауза перед первой пьесой: сначала слышен город, потом входит музыка. */
export const FIRST_PIECE_AFTER = 6;

export class EpochMusic {
  private piece: Piece | null = null;
  private pieceAt = 0;
  private cursor = 0;
  private nextAt: number;
  /** Корпус лютни: щипок без лишней звонкости. */
  private body: BiquadFilterNode;
  /** Сколько пьес начато — образцам и тесту. */
  started = 0;

  constructor(
    private kit: Kit,
    private out: AudioNode,
    from: number,
    private lite: boolean,
    firstAfter = FIRST_PIECE_AFTER,
  ) {
    this.nextAt = from + firstAfter;
    this.body = kit.ctx.createBiquadFilter();
    this.body.type = 'lowpass';
    this.body.frequency.value = 3400;
    this.body.Q.value = 0.6;
    this.body.connect(out);
  }

  /** Поставить всё, что начинается до `now + horizon`. Ноты, опоздавшие больше чем на 50 мс, пропускаются. */
  tick(now: number, horizon: number): void {
    const until = now + horizon;
    for (let guard = 0; guard < 8; guard++) {
      if (!this.piece) {
        if (until < this.nextAt) return;
        this.begin(Math.max(this.nextAt, now));
      }
      const p = this.piece!;
      while (this.cursor < p.notes.length && this.pieceAt + p.notes[this.cursor].at < until) {
        const n = p.notes[this.cursor++];
        const at = this.pieceAt + n.at;
        if (at < now - 0.05) continue;
        // Лютню чуть оживить: щипок на пару сотых раньше или позже доли — рука, а не метроном.
        const human = n.voice === 'lute' ? (this.kit.rnd() - 0.5) * 0.02 : 0;
        if (n.voice === 'lute') pluck(this.kit, this.body, Math.max(now, at + human), n.midi, n.vel * MUSIC_MIX.lute, n.lead ? 0 : -0.25);
        else flute(this.kit, this.out, at, n.dur, n.midi, n.vel * MUSIC_MIX.flute);
      }
      if (this.cursor < p.notes.length || this.pieceAt + p.length > until) return;
      this.nextAt = this.pieceAt + p.length + pauseAfter(this.kit.rnd);
      this.piece = null;
    }
  }

  private begin(at: number): void {
    const p = compose(this.kit.rnd, { lite: this.lite });
    this.piece = p;
    this.pieceAt = at;
    this.cursor = 0;
    this.started++;
    drone(this.kit, this.out, at, at + p.length, p.drone, DRONE_LEAD - 1, DRONE_TAIL - 1);
  }

  /** Что играет — образцам. */
  get current(): Piece | null {
    return this.piece;
  }
}
