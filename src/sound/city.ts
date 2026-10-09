// Звук города: дверь из первой загрузки (docs/audio.md, раздел 1).
//
// Здесь — только то, что должно быть под рукой у жеста: открыть контекст в обработчике касания и попросить докачку.
// Сам звук — фон, музыка эпохи, звуки интерфейса — едет своим куском (`sound/epoch/`) после первого касания, когда
// первый кадр давно нарисован; в первую загрузку он не входит (тест `LAZY_DOORS`). Выключенный звук не открывает
// контекста и не качает куска вовсе.
//
// Почему докачка после жеста законна, хотя справочник запрещает `import()` из обработчика жеста: запрет — про
// открытие контекста (`await` теряет пользовательскую активацию). Контекст открывается здесь синхронно, в самом
// обработчике (`openBus`); кусок приезжает потом и берёт готовые выходы, как звук боя (`sound/battlefx.ts`).

import { soundOn } from './settings';
import { openBus, wakeSound } from './web';
import type { Cue, Duck, EpochMachine } from './epoch';

/** Почему город глушится: свои звуки поверх. */
export type DuckReason = 'battle' | 'mini' | 'prologue';

/** Насколько глушить по причине: музыка уступает звукам боя и промыслов, фон города в предыстории не к месту вовсе. */
const DUCKS: Record<DuckReason, Duck> = {
  battle: { music: 0.12, amb: 0.25 },
  // Промысел: фон не глушится, а становится его поляной — лес, ветер и птицы (`glade`, docs/minigames.md, 16.2).
  mini: { music: 0.15, amb: 1 },
  prologue: { music: 0.3, amb: 0 },
};

class CityAudio {
  private machine: EpochMachine | null = null;
  private loading = false;
  private ducks = new Set<DuckReason>();

  /**
   * Жест игрока. Годится любое касание — у города нет отдельной кнопки «звук». Идемпотентно: контекст один, кусок
   * качается один раз. При выключенном звуке не делает ничего.
   */
  arm(): void {
    if (!soundOn()) return;
    if (this.machine || this.loading) {
      wakeSound();
      return;
    }
    const music = openBus(1, 'music');
    const fx = openBus(1, 'fx');
    if (!music || !fx) return;
    this.loading = true;
    void import('./epoch')
      .then((m) => {
        this.loading = false;
        if (!soundOn()) {
          music.disconnect();
          fx.disconnect();
          return;
        }
        this.machine = m.startEpoch({ music, fx });
        this.machine.duck(this.duck());
      })
      .catch(() => {
        // Кусок не доехал (сеть) — город молчит, следующее касание попробует снова.
        this.loading = false;
        music.disconnect();
        fx.disconnect();
      });
  }

  /** Рычаг из настроек: включение — тот же жест; выключение гасит город. */
  toggle(on: boolean): void {
    if (on) {
      this.arm();
      return;
    }
    this.machine?.stop();
    this.machine = null;
  }

  /** Поверх города свои звуки — глушить; ушли — вернуть. */
  hush(reason: DuckReason, on: boolean): void {
    if (on === this.ducks.has(reason)) return;
    if (on) this.ducks.add(reason);
    else this.ducks.delete(reason);
    this.machine?.duck(this.duck());
  }

  /** Идёт промысел: фон играет его поляну, а не город (`epoch.hearing`). */
  get glade(): boolean {
    return this.ducks.has('mini');
  }

  /** Звук интерфейса. До докачки и при выключенном звуке — тишина. */
  cue(name: Cue): void {
    this.machine?.cue(name);
  }

  private duck(): Duck {
    let d: Duck = { music: 1, amb: 1 };
    for (const r of this.ducks) d = { music: Math.min(d.music, DUCKS[r].music), amb: Math.min(d.amb, DUCKS[r].amb) };
    return d;
  }
}

/** Звук города на всю игру. */
export const cityAudio = new CityAudio();
