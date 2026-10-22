// Дверь к голосам зданий (docs/city_v3.md, ЗВ-1): машинка звука города (`index.ts`) зовёт её, когда открылась карточка
// здания, а она докачивает кусок голосов (`halls.ts`) по первому такому касанию. Касание, пришедшее до куска, звучит, когда
// кусок доехал, — если не опоздало (`HALL_LATE`). Выключенный звук и погашенная машинка молчат и ничего не качают.
import type { BuildingTypeId } from '@/game/types';
import type { SheetView } from '@/game/store';
import type { HallMood, HallPlay } from './halls';

/**
 * Чей голос звучит при смене шторки: номер здания, если карточку открыло **касание здания в сцене города** (`touched`, решение
 * владельца по ЗВ-1); карточка из окна («Казармы» в «Дружине», «Показать в городе»), с открытой картой или не здания — молчит.
 */
export const hallHeard = (g: { mapOpen: boolean; sheet: SheetView | null }): number | null =>
  !g.mapOpen && g.sheet?.kind === 'building' && g.sheet.touched ? g.sheet.id : null;

/** Что умеет кусок голосов. */
export interface HallPlayer {
  play(type: BuildingTypeId, level: number, mood: HallMood, at: number): HallPlay | null;
}

/** Касание старше этого к приезду куска — уже не к месту, с. */
export const HALL_LATE = 1.5;

export class HallCue {
  private voices: HallPlayer | null = null;
  private loading = false;
  private pending: { type: BuildingTypeId; level: number; at: number } | null = null;

  constructor(
    private load: () => Promise<HallPlayer>,
    private now: () => number,
    /** Звук включён и машинка жива. */
    private live: () => boolean,
    private mood: () => HallMood,
  ) {}

  /** Касание здания этого вида и уровня. */
  tap(type: BuildingTypeId, level: number): void {
    if (!this.live()) return;
    const at = this.now();
    if (this.voices) {
      this.voices.play(type, level, this.mood(), at);
      return;
    }
    this.pending = { type, level, at };
    if (this.loading) return;
    this.loading = true;
    this.load().then(
      (v) => {
        this.loading = false;
        this.voices = v;
        const p = this.pending;
        this.pending = null;
        const now = this.now();
        if (p && this.live() && now - p.at <= HALL_LATE) v.play(p.type, p.level, this.mood(), now);
      },
      () => {
        // Кусок не доехал (сеть) — здание молчит, следующее касание попробует снова.
        this.loading = false;
        this.pending = null;
      },
    );
  }
}
