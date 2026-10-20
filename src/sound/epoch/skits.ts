// Звук сценок жителей (docs/city_v3.md, ЖГ-2): у каждой — свой узор событий, тихо и по месту. Что слышно, где и насколько
// громко, решает вид (`render/city/skitview` → `sound/ear.hearSkits`): ближе к камере — громче, слева на экране — слева в
// ушах; издали сценок нет — и звука нет. Здесь — только что звучит и когда.
//
// Всё — синтез (`synth.ts`), без файлов: первая загрузка не растёт. Уровни (`SKIT_MIX`) — ниже трактира и рынка: сценка —
// подробность вблизи, а не новый слой фона; выставлены офлайн-отрисовкой (`npm run audio:samples`, образцы `skit-*`).
import type { HeardSkit } from '../ear';
import { span, type Rng } from './rng';
import { bark, bell, bird, bleat, clink, creak, drum, flute, knock, laugh, pluck, sing, sob, swish, voice, type Kit } from './synth';

/** Уровень сценки на выходе фона при полной близости — не громче трактира (`AMB_MIX.tavern` 0,06). */
export const SKIT_MIX: Record<string, number> = {
  brawl: 0.05,
  drunks: 0.045,
  dance: 0.045,
  haggle: 0.04,
  widow: 0.04,
  children: 0.04,
  preacher: 0.045,
  lovers: 0.035,
  dice: 0.04,
  thief: 0.05,
  funeral: 0.05,
  revel: 0.05,
  travelers: 0.04,
  shepherd: 0.04,
  reapers: 0.04,
  hunter: 0.04,
  pilgrims: 0.04,
  scouts: 0.03,
};

/** Тише этой громкости сценка не звучит вовсе. */
const QUIET = 0.03;

/** Напевы: баллада пьяных, хорал похорон и паломников, песня жнецов, свирель пастуха (MIDI). */
const BALLAD = [57, 59, 60, 62, 64, 62, 60, 59, 57, 55, 57];
const CHANT = [50, 50, 52, 53, 52, 50, 48, 50];
const WORKSONG = [55, 57, 59, 57, 55, 52, 55];
const PIPE = [74, 76, 79, 76, 74, 72, 74, 71];
const LUTE = [62, 64, 65, 67, 69, 71, 72];

export class SkitSounds {
  private next = new Map<string, number>();
  /** Разовые звуки сценки уже прозвучали (выстрел охотника, окрик стражи): сбрасываются в начале следующего хода. */
  private done = new Set<string>();
  private rnd: Rng;

  constructor(
    private kit: Kit,
    private out: AudioNode,
  ) {
    this.rnd = kit.rnd;
  }

  /** Поставить события окна `[from, to)` для слышных сценок. */
  tick(from: number, to: number, heard: readonly HeardSkit[]): void {
    for (const h of heard) {
      const v = (SKIT_MIX[h.id] ?? 0) * h.gain;
      if (h.k < 0.1) {
        this.done.delete(`${h.id}:a`);
        this.done.delete(`${h.id}:b`);
      }
      if (h.gain < QUIET || v <= 0) continue;
      let t = Math.max(from, this.next.get(h.id) ?? from);
      while (t < to) t += this.play(h, v, t);
      this.next.set(h.id, t);
    }
    // Ушедшие сценки забываются: следующая такая начнёт с первого звука.
    for (const id of [...this.next.keys()]) if (!heard.some((h) => h.id === id)) this.next.delete(id);
  }

  /** Разово за ход сценки. */
  private once(id: string): boolean {
    if (this.done.has(id)) return false;
    this.done.add(id);
    return true;
  }

  /** Одно событие сценки в миг `t`; вернуть, через сколько следующее. */
  private play(h: HeardSkit, v: number, t: number): number {
    const kit = this.kit;
    const out = this.out;
    const r = this.rnd;
    const pan = h.pan;
    const p = (): number => pan + span(r, -0.15, 0.15);
    switch (h.id) {
      case 'brawl': {
        // До стражи — удары, крики, гогот вокруг; стража прибежала — окрик, потом бормотание.
        if (h.k > 0.45 && this.once('brawl:a')) {
          voice(kit, out, t, 3, v * 1.2, p(), true, 210);
          return 1.6;
        }
        if (h.k > 0.5) return voice(kit, out, t, 2 + Math.floor(r() * 3), v * 0.6, p(), false) + span(r, 0.6, 1.6);
        const x = r();
        if (x < 0.4) {
          knock(kit, out, t, span(r, 100, 150), v * 1.1, p());
          if (r() < 0.5) knock(kit, out, t + 0.22, span(r, 100, 150), v * 0.8, p());
          return span(r, 0.5, 1.1);
        }
        if (x < 0.75) return voice(kit, out, t, 2, v, p(), true) + span(r, 0.3, 0.9);
        return laugh(kit, out, t, v * 0.7, p()) + span(r, 0.2, 0.8);
      }
      case 'drunks': {
        const x = r();
        if (x < 0.15) return laugh(kit, out, t, v * 0.8, p()) + span(r, 0.5, 1.5);
        if (x < 0.25) return voice(kit, out, t, 1, v * 0.6, p(), false, span(r, 140, 180)) + span(r, 0.6, 1.4);
        const at0 = Math.floor(r() * 4);
        const line = BALLAD.slice(at0, at0 + 5 + Math.floor(r() * 3));
        // Двое поют вразнобой: второй чуть позже и мимо нот.
        const len = sing(kit, out, t, line, 0.42, v, p(), 0.4);
        if (!kit.lite) sing(kit, out, t + 0.12, line.map((n) => n - 12), 0.42, v * 0.7, p(), 0.6);
        return len + span(r, 1, 3);
      }
      case 'dance': {
        // Такт: бубен на сильные доли, хлопки на слабые, дудка ведёт по две ноты.
        const beat = 0.34;
        for (let i = 0; i < 4; i++) {
          drum(kit, out, t + i * beat, v * (i % 2 ? 0.5 : 0.9), pan - 0.1, i % 2 === 1);
          if (i % 2 === 1) knock(kit, out, t + i * beat + 0.01, 1500, v * 0.5, p());
        }
        for (let i = 0; i < 2; i++) flute(kit, out, t + i * beat * 2, beat * 1.8, PIPE[Math.floor(r() * PIPE.length)], v * 0.9);
        return beat * 4;
      }
      case 'haggle': {
        const x = r();
        if (x < 0.15) {
          for (let i = 0; i < 3; i++) clink(kit, out, t + i * span(r, 0.06, 0.12), v * 0.8, p());
          return span(r, 0.8, 1.6);
        }
        // Купец — низко, покупательница — выше; слово за слово.
        const merchant = x < 0.55;
        return voice(kit, out, t, 2 + Math.floor(r() * 3), v, p(), r() < 0.1, merchant ? span(r, 110, 140) : span(r, 220, 270)) + span(r, 0.2, 0.7);
      }
      case 'widow': {
        if (r() < 0.25) return voice(kit, out, t, 3, v * 0.5, p(), false, span(r, 210, 240)) + span(r, 1, 2);
        return sob(kit, out, t, v, p()) + span(r, 1.2, 3);
      }
      case 'children': {
        const x = r();
        if (x < 0.3) return laugh(kit, out, t, v, p(), span(r, 330, 420)) + span(r, 0.3, 1.2);
        return voice(kit, out, t, 1 + Math.floor(r() * 3), v * 0.9, p(), x > 0.85, span(r, 340, 470)) + span(r, 0.3, 1.1);
      }
      case 'preacher': {
        if (r() < 0.1) return voice(kit, out, t, 2, v * 0.5, p(), false, span(r, 110, 160)) + 1;
        // Проповедь: долгая фраза низким голосом, на конце — возглас.
        const len = voice(kit, out, t, 6 + Math.floor(r() * 5), v, pan, false, span(r, 108, 126));
        if (r() < 0.3) voice(kit, out, t + len + 0.1, 2, v * 1.1, pan, true, 170);
        return len + span(r, 1, 2.4);
      }
      case 'lovers': {
        if (r() < 0.2) return laugh(kit, out, t, v * 0.5, p(), span(r, 260, 300)) + span(r, 2, 4);
        const n = 4 + Math.floor(r() * 3);
        for (let i = 0; i < n; i++) pluck(kit, out, t + i * 0.46, LUTE[Math.floor(r() * LUTE.length)], v, pan);
        return n * 0.46 + span(r, 2, 4);
      }
      case 'dice': {
        // Кости в кружке, о крышку бочки — и вой или гогот.
        const n = 3 + Math.floor(r() * 3);
        for (let i = 0; i < n; i++) knock(kit, out, t + i * span(r, 0.05, 0.09), span(r, 1700, 2500), v * 0.7, p());
        const after = t + n * 0.08 + span(r, 0.6, 1);
        if (r() < 0.5) voice(kit, out, after, 2, v, p(), true);
        else voice(kit, out, after, 1, v * 0.8, p(), false, span(r, 100, 130));
        return 5 + span(r, -0.5, 0.5);
      }
      case 'thief': {
        // Топот бегом и «держи!» вдогонку.
        for (let i = 0; i < 6; i++) knock(kit, out, t + i * 0.16, span(r, 80, 110), v * span(r, 0.5, 0.9), p());
        if (r() < 0.45) voice(kit, out, t + span(r, 0, 0.4), 2, v * 1.1, p(), true);
        return 0.96;
      }
      case 'funeral': {
        // Редкий низкий удар колокола и хорал; изредка — плач.
        bell(kit, out, t, 96, v * 0.9);
        if (r() < 0.7) sing(kit, out, t + 1.2, CHANT.slice(0, 4 + Math.floor(r() * 4)), 1.05, v * 0.7, pan);
        if (r() < 0.2) sob(kit, out, t + 3, v * 0.6, p());
        return span(r, 6.5, 8.5);
      }
      case 'revel': {
        const x = r();
        if (x < 0.25) {
          // Тост: разом «ура», кружки звенят.
          for (let i = 0; i < 3; i++) voice(kit, out, t + i * 0.08, 2, v, p(), true);
          for (let i = 0; i < 4; i++) clink(kit, out, t + 0.6 + i * 0.05, v * 0.8, p());
          return span(r, 2.5, 4);
        }
        if (x < 0.5) return laugh(kit, out, t, v * 0.8, p()) + span(r, 0.2, 0.8);
        return voice(kit, out, t, 2 + Math.floor(r() * 4), v * 0.7, p(), false) + span(r, 0.1, 0.6);
      }
      case 'travelers': {
        // Скрип оси, шаг вола, редкое слово.
        const len = span(r, 1.5, 3);
        creak(kit, out, t, len, v * 0.8, pan);
        for (let i = 0; i < len / 0.6; i++) knock(kit, out, t + i * 0.6, span(r, 140, 180), v * 0.5, pan);
        if (r() < 0.15) voice(kit, out, t + len * 0.5, 3, v * 0.7, p(), false);
        return len + span(r, 0.5, 2);
      }
      case 'shepherd': {
        const x = r();
        if (x < 0.15) {
          const n = 4 + Math.floor(r() * 4);
          const at0 = Math.floor(r() * 4);
          for (let i = 0; i < n; i++) flute(kit, out, t + i * 0.36, 0.34, PIPE[(at0 + i) % PIPE.length], v * 0.8);
          return n * 0.36 + span(r, 1, 2);
        }
        if (x < 0.25) return bark(kit, out, t, v * 0.8, p()) + span(r, 0.8, 2);
        return bleat(kit, out, t, v * span(r, 0.6, 1), pan + span(r, -0.35, 0.35)) + span(r, 0.6, 2.6);
      }
      case 'reapers': {
        // Три серпа вразнобой и изредка — песня жнецов.
        for (let i = 0; i < 3; i++) swish(kit, out, t + i * span(r, 0.3, 0.45), v * span(r, 0.6, 1), p());
        if (r() < 0.12) sing(kit, out, t + 0.5, WORKSONG, 0.55, v * 0.6, pan);
        return span(r, 1.2, 1.7);
      }
      case 'hunter': {
        // Тишина подкрадывания — хруст ветки; выстрел — тетива и шлепок; олень сорвался — лай и топот.
        if (h.k > 0.66 && this.once('hunter:a')) {
          pluck(kit, out, t, 40, v * 1.2, pan);
          knock(kit, out, t + 0.02, 300, v * 0.6, pan);
          return 0.8;
        }
        if (h.k > 0.68 && this.once('hunter:b')) {
          bark(kit, out, t, v, p());
          for (let i = 0; i < 6; i++) knock(kit, out, t + 0.3 + i * 0.18, span(r, 150, 200), v * 0.5, pan + 0.3);
          return 1.5;
        }
        if (r() < 0.3) knock(kit, out, t, span(r, 1900, 2600), v * 0.4, p());
        return span(r, 2, 4);
      }
      case 'pilgrims': {
        const len = sing(kit, out, t, CHANT.slice(Math.floor(r() * 3)), 0.9, v * 0.8, pan);
        if (!kit.lite) sing(kit, out, t + 0.05, CHANT.slice(0, 5).map((n) => n + 7), 0.9, v * 0.4, pan);
        for (let i = 0; i < len / 1.2; i++) knock(kit, out, t + i * 1.2, 320, v * 0.4, p());
        return len + span(r, 1.5, 3);
      }
      case 'scouts': {
        // Условный свист — две ноты, будто птица; изредка хруст.
        if (r() < 0.6) bird(kit, out, t, 'whistle', v * 0.8, pan);
        else knock(kit, out, t, span(r, 1900, 2600), v * 0.4, p());
        return span(r, 6, 11);
      }
      default:
        return 2;
    }
  }
}
