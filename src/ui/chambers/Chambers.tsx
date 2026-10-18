// Покои правителя (docs/city_v3.md, Г-4, Г-5): слой поверх холста города — палец (слева — идти, справа — смотреть),
// подписи, выход, «Встать» из дела, руки и подписи-указатели первого входа.
// Свой кусок: его тянет верх города (`next/Hud`), когда покои открыты (`open.ts`), — в первую загрузку не едет ни байта.
//
// Комната живёт, пока покои открыты, а не пока стоит этот слой: карта мира прячет верх города и слой с ним, а глаз в
// покоях остаётся на месте — закрыл карту, и снова за столом. Уходит комната только по «В город».
import './chambers.css';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useGame } from '@/game/store';
import { activeScene, type TribeScene } from '@/render/Scene';
import type { Inside } from '@/render/city/inside';
import type { Tower } from '@/render/city/layout';
import type { CityShare } from '@/render/city/index';
import { ChambersRoom, type ChambersView } from '@/render/chambers/room';
import { ChambersSound } from '@/render/chambers/sound';
import { TRINKETS, type SpotId, type TrinketId } from '@/render/chambers/plan';
import { armsOr } from '@/heraldry/arms';
import { cityAudio } from '@/sound/city';
import { probe } from '@/debug';
import { useChambers } from './open';
import { openDoor } from './doors';

/** Сцена города глазами покоев: у общей оболочки сцены этих рычагов нет (`render/city/scene.ts`). */
type CityLike = TribeScene & {
  keep(): Tower | null;
  cityShare(): CityShare | null;
  enterInside(room: Inside): boolean;
  leaveInside(room: Inside): void;
  readonly quality: 'high' | 'medium' | 'low';
};

const asCity = (s: TribeScene | null): CityLike | null => (s && 'enterInside' in s ? (s as CityLike) : null);

/** Живые покои: комната, сцена, в которую вошли, и звук. Одни на игру. */
interface Live {
  room: ChambersRoom;
  scene: CityLike | null;
  sound: ChambersSound;
  view: ChambersView;
  subs: Set<() => void>;
}

let live: Live | null = null;

function notify(): void {
  if (!live) return;
  live.view = live.room.view();
  for (const f of live.subs) f();
}

/** Поднять комнату в сцене города, если её ещё нет и город встал. Сцена — живая сцена игры (довод — тестам). */
function rise(scene: CityLike | null = asCity(activeScene())): Live | null {
  if (live) {
    // Сцену пересобрали (потерянный контекст, `ui/GameCanvas`): войти в новую той же комнатой.
    if (scene && live.scene !== scene && scene.keep() && scene.enterInside(live.room)) live.scene = scene;
    return live;
  }
  const keep = scene?.keep();
  if (!scene || !keep) return null;
  const s = useGame.getState().s;
  const room = new ChambersRoom(keep, armsOr(s.profile.arms), scene.quality, () => asCity(activeScene())?.cityShare()?.uniforms.cityTex.value ?? null);
  const sound = new ChambersSound();
  live = { room, scene: null, sound, view: room.view(), subs: new Set() };
  room.onChange = notify;
  room.onUse = (door) => openDoor(door);
  room.onEar = (ear, dt) => sound.update(dt, ear);
  room.onCue = (c) => sound.cue(c);
  if (!scene.enterInside(room)) {
    room.dispose();
    live = null;
    return null;
  }
  live.scene = scene;
  cityAudio.hush('chambers', true);
  void sound.start();
  if (probe()) (window as unknown as { __chambers?: ChambersRoom }).__chambers = room;
  notify();
  return live;
}

/** Спуститься в город: сцена — снова город, комната и звук уходят. */
function fall(): void {
  const l = live;
  if (!l) return;
  live = null;
  l.scene?.leaveInside(l.room);
  l.sound.stop();
  l.room.dispose();
  cityAudio.hush('chambers', false);
  if (probe()) delete (window as unknown as { __chambers?: ChambersRoom }).__chambers;
}

// Закрыли покои откуда угодно — комната уходит, даже если слоя сейчас нет (под картой).
useChambers.subscribe((c, was) => {
  if (was.open && !c.open) fall();
});

function useView(): ChambersView | null {
  return useSyncExternalStore(
    (f) => {
      live?.subs.add(f);
      return () => live?.subs.delete(f);
    },
    () => live?.view ?? null,
  );
}

const TRINKET_BY_ID = Object.fromEntries(TRINKETS.map((t) => [t.id, t])) as Record<TrinketId, (typeof TRINKETS)[number]>;

/** Кнопка выхода из дела: сидя и лёжа — «Встать», у окна и огня — «Отойти». */
const LEAVE: Record<SpotId, string> = { desk: 'Встать', bed: 'Встать', window: 'Отойти', hearth: 'Отойти', arms: 'Отойти' };

/**
 * Подписи-указатели первого входа (как в промыслах, docs/minigames.md, 18.1): над пальцем движения, у взгляда и о мебели.
 * Гаснут по делу — пошёл, посмотрел, сделал дело — или через `COACH_MS`; что игрок уже видел, помнит устройство.
 */
export const COACH = {
  walk: 'Веди пальцем — идти и поворачивать',
  look: 'Веди — смотреть',
  act: 'Коснись кресла, кровати, окна, камина или оружия',
} as const;
const COACH_MS = 14000;
const COACH_KEY = 'tribe.chambers.coach';

function coachSeen(): boolean {
  try {
    return localStorage.getItem(COACH_KEY) === '1';
  } catch {
    return true;
  }
}

function coachDone(): void {
  try {
    localStorage.setItem(COACH_KEY, '1');
  } catch {
    /* память устройства недоступна — покажем ещё раз */
  }
}

export function Chambers() {
  const hide = useChambers((c) => c.hide);
  const ruler = useGame((g) => g.s.realm.ruler.name ?? 'Без имени');
  const layer = useRef<HTMLDivElement>(null);
  const tags = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(() => live !== null);
  const [coach, setCoach] = useState(() => !coachSeen());
  const [, bump] = useState(0);
  const view = useView();

  // Комната встаёт, когда город готов: пока он собирается, слой показывает подъём в покои.
  useEffect(() => {
    let t = 0;
    const tryRise = (): void => {
      const l = rise();
      if (l) {
        setReady(true);
        bump((n) => n + 1);
        l.room.attachLabels(tags.current);
      }
    };
    tryRise();
    // Не цикл кадра — редкая проверка: сцену могли пересобрать, а город — ещё строить.
    t = window.setInterval(tryRise, 400);
    return () => {
      window.clearInterval(t);
      live?.room.attachLabels(null);
    };
  }, []);

  // Клавиши: Esc — в город; W/A/S/D и стрелки — шаг и поворот (как в промыслах).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        hide();
        return;
      }
      if (live?.room.keyDown(e.code, e.target)) e.preventDefault();
    };
    const onUp = (e: KeyboardEvent): void => live?.room.keyUp(e.code);
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onUp);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onUp);
    };
  }, [hide]);

  // Подписи-указатели стоят, пока игрок не прошёлся, не огляделся и не сделал дело, но не дольше `COACH_MS`.
  const used = view?.used;
  const coaching = coach && ready && !!used && !(used.walk && used.look && used.act);
  useEffect(() => {
    if (!coach || !ready) return;
    coachDone();
    const t = window.setTimeout(() => setCoach(false), COACH_MS);
    return () => window.clearTimeout(t);
  }, [coach, ready]);

  const room = live?.room ?? null;
  const rect = (): DOMRect => (layer.current ?? document.body).getBoundingClientRect();
  const v = view;
  const held = v?.held ? TRINKET_BY_ID[v.held] : null;

  return (
    <div className="ch" data-ready={ready ? '1' : '0'}>
      <div
        ref={layer}
        className="ch-layer"
        onPointerDown={(e) => {
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            /* захват не обязателен */
          }
          room?.down(e.pointerId, e.clientX, e.clientY, rect());
        }}
        onPointerMove={(e) => {
          if (e.pointerType === 'mouse' && e.buttons === 0) room?.hoverAt(e.clientX, e.clientY, rect());
          else room?.move(e.pointerId, e.clientX, e.clientY);
        }}
        onPointerUp={(e) => room?.up(e.pointerId)}
        onPointerCancel={(e) => room?.cancel(e.pointerId)}
        onWheel={(e) => room?.wheel(e.deltaY)}
      >
        <div ref={tags} className="ch-tags" aria-hidden="true" />
      </div>

      <div className="ch-top">
        <button className="ch-exit" onClick={hide} aria-label="Выйти в город">
          <span aria-hidden="true">‹</span> Город
        </button>
        <div className="ch-title">
          <b>Покои</b>
          <small className="one-line">{ruler}</small>
        </div>
      </div>

      {v && !held && (
        <>
          {/* Палец движения — рисунок: касание ловит вся левая половина (`prologue/controls.Sticks`), стик встаёт под палец. */}
          <div className="ch-pad" aria-hidden="true">
            <i />
          </div>
          {v.mode === 'in' && v.spot && (
            <button className="ch-leave" onClick={() => room?.leave()}>
              {LEAVE[v.spot]}
            </button>
          )}
          {v.zoom !== null && (
            <div className="ch-zoom" role="group" aria-label="Смотреть вдаль">
              <button disabled={v.zoom <= 0.01} onClick={() => room?.zoomBy(1 / 1.6)}>
                Ближе
              </button>
              <button disabled={v.zoom >= 0.99} onClick={() => room?.zoomBy(1.6)}>
                Вдаль
              </button>
            </div>
          )}
        </>
      )}

      {coaching && used && (
        <>
          {!used.walk && <div className="ch-coach walk">{COACH.walk}</div>}
          {!used.look && <div className="ch-coach look">{COACH.look}</div>}
          {!used.act && <div className="ch-coach act">{COACH.act}</div>}
        </>
      )}

      {held && (
        <div className="ch-hand">
          <div className="ch-hand-text">
            <b>{held.name}</b>
            <small>{held.hint}</small>
          </div>
          <button className="ch-put" onClick={() => room?.drop()}>
            Положить
          </button>
        </div>
      )}

      {!ready && <div className="ch-wait">Поднимаемся в покои…</div>}
      <div className="ch-veil" aria-hidden="true" />
    </div>
  );
}

/** Для тестов: живая комната и уборка. */
export const __chambers = {
  live: (): ChambersRoom | null => live?.room ?? null,
  fall,
  rise,
};
