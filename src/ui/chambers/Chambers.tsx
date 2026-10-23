// Покои правителя (docs/city_v3.md, Г-4, Г-5): слой поверх холста города — палец (слева — идти, справа — смотреть),
// подписи, выход, «Встать» из дела, руки и подписи-указатели первого входа.
// Свой кусок: его тянет верх города (`next/Hud`), когда покои открыты (`open.ts`), — в первую загрузку не едет ни байта.
//
// Комната живёт, пока покои открыты, а не пока стоит этот слой: карта мира прячет верх города и слой с ним, а глаз в
// покоях остаётся на месте — закрыл карту, и снова за столом. Уходит комната только по «В город».
import './chambers.css';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useGame } from '@/game/store';
import { councilSeat } from '@/game/derived';
import { advisorAgeNow } from '@/game/sim/council';
import { faceAge } from '@/game/data/council';
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
import { useWorld, marchesOnUs, worldNow } from '@/world/store';
import { useRealm } from '@/ui/realm/open';
import type { LifeView, Who, Why } from '@/render/chambers/life';
import { Talk } from './TalkWindow';
import { realPlain } from '@/ui/parts/wait';
import { daypartOf, household, type TalkCtx } from './talk';
import { loadMemory, saveMemory, type ChambersMemory } from './memory';
import { adultScenes } from './adult';
import { Court } from './court';
import { AdvisorPlate, HeraldPlate, KnockBar } from './CourtWindow';
import type { CourtSource, Moment, NewsDoor } from './tidings';
import { serverNow } from '@/net/clock';
import { buildingOfType } from '@/game/derived';

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
  /** Жизнь покоев (Г-7): кто в покоях и кто ждёт слова. */
  life: LifeView;
  /** Память устройства (кот, разговоры) и дом правителя — имена супруги, служанки и слуги. */
  memory: ChambersMemory;
  house: ReturnType<typeof household>;
  /** Гонец и советник (ПК-1): стук с важной вестью после входа и доклад после отлучки. */
  court: Court;
  /** Отписка двора от сторов мира и партии и от скрытия страницы. */
  unwatch: () => void;
  subs: Set<() => void>;
}

let live: Live | null = null;

function notify(): void {
  if (!live) return;
  live.view = live.room.view();
  live.life = live.room.life.view();
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
  // Дом правителя и память устройства: кот остался ли, о чём уже говорили (Г-7).
  const house = household(s.realm.ruler.name ?? 'Правитель', s.realm.ruler.n, s.faith.id ?? 'catholic');
  const memory = loadMemory(house.house);
  memory.talk.visits++;
  saveMemory(memory);
  // Старший советник совета Ратуши — Староста (Бургомистр): тот, кто стоит у стола в покоях, — тот же человек, что на портрете.
  const chief = (): { seed: number; age: number; post: string } | null => {
    const g = useGame.getState().s;
    const a = councilSeat(g, 'steward');
    return a ? { seed: a.look, age: faceAge(advisorAgeNow(g, a)), post: 'steward' } : null;
  };
  const room = new ChambersRoom(keep, armsOr(s.profile.arms), scene.quality, () => asCity(activeScene())?.cityShare()?.uniforms.cityTex.value ?? null, memory.life, chief);
  const sound = new ChambersSound();
  const court = new Court(room.life, {
    source: courtSource,
    now: courtNow,
    memory: () => memory.court,
    remember: (m) => {
      memory.court = m;
      saveMemory(memory);
    },
    open: goNews,
  });
  court.onChange = notify;
  // Журнал переменился — нет ли важной вести для гонца (поход на нас, осада, мятеж, бедствие, кончился хлеб). Приходов по
  // часам нет: только перемена журнала (ПК-1).
  const offWorld = useWorld.subscribe((w, was) => {
    if (w.letters !== was.letters || w.siege !== was.siege || w.reports !== was.reports || w.rivals !== was.rivals || w.ready !== was.ready) court.look();
  });
  const offGame = useGame.subscribe((g, was) => {
    if (g.s !== was.s) court.look();
  });
  // Свернули аппку — правитель вышел из покоев: от этой минуты мерится отлучка. Развернули — вошёл снова: случившееся
  // в отлучку — советнику, а не гонцу.
  const onHide = (): void => {
    if (typeof document === 'undefined' || !court.entry) return;
    if (document.visibilityState === 'hidden') court.presence();
    else court.enter();
  };
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onHide);
  const unwatch = (): void => {
    offWorld();
    offGame();
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onHide);
  };
  live = { room, scene: null, sound, view: room.view(), life: room.life.view(), memory, house, court, unwatch, subs: new Set() };
  room.onChange = notify;
  // Покои освободились (сцена, разговор) — впущенный гонец входит.
  room.life.onChange = () => {
    notify();
    live?.court.call();
  };
  room.life.onRemember = (m) => {
    if (!live) return;
    live.memory.life = m;
    saveMemory(live.memory);
  };
  room.onUse = (door) => openDoor(door);
  room.onEar = (ear, dt) => {
    sound.update(dt, ear);
    // Мурчание кота — громкость по уху.
    const c = room.life.cat;
    sound.purr(c?.visible ? c.purring * room.hear([c.x, c.y + 0.2, c.z]).gain : 0);
  };
  room.onCue = (c) => sound.cue(c);
  room.onLifeCue = (c, at) => {
    const h = at ? room.hear(at) : { gain: 1, pan: 0 };
    sound.life(c, h.gain, h.pan);
  };
  room.life.onSpeak = (who, seconds) => {
    const p = room.life.personOf(who);
    const h = p ? room.hear(p.rig.at('head')) : { gain: 1, pan: 0 };
    sound.speak(who, seconds, h.gain, h.pan);
  };
  if (!scene.enterInside(room)) {
    room.dispose();
    live = null;
    return null;
  }
  live.scene = scene;
  cityAudio.hush('chambers', true);
  void sound.start();
  // Вход — когда донесения мира свежие: до того двор не судит, что «уже было», а что «после входа» (ПК-1, причина 1).
  void (async () => {
    try {
      await useWorld.getState().loadReports();
    } catch {
      /* мира нет — донесения какие есть */
    }
    if (live?.court === court) court.enter();
  })();
  if (probe()) Object.assign(window as unknown as { __chambers?: ChambersRoom; __court?: Court }, { __chambers: room, __court: court });
  notify();
  return live;
}

/** Спуститься в город: сцена — снова город, комната и звук уходят. */
function fall(): void {
  const l = live;
  if (!l) return;
  live = null;
  l.unwatch();
  l.court.presence();
  l.court.dispose();
  l.scene?.leaveInside(l.room);
  l.sound.stop();
  l.room.dispose();
  cityAudio.hush('chambers', false);
  if (probe()) {
    delete (window as unknown as { __chambers?: ChambersRoom }).__chambers;
    delete (window as unknown as { __court?: Court }).__court;
  }
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

function useLife(): LifeView | null {
  return useSyncExternalStore(
    (f) => {
      live?.subs.add(f);
      return () => live?.subs.delete(f);
    },
    () => live?.life ?? null,
  );
}

/** Что разговору видно о мире: час по свету города, мораль, война, кот, вино, имена дома, рычаг взрослых сцен. */
function talkBase(): Omit<TalkCtx, 'who' | 'why' | 'mem' | 'roll'> {
  const g = useGame.getState().s;
  const w = useWorld.getState();
  const l = live!;
  const sky = l.room.skyNow();
  return {
    daypart: daypartOf(sky.night, sky.sunY, sky.sunX),
    morale: g.morale,
    besieged: !!w.siege || marchesOnUs(w.marches, w.info?.homeId).length > 0,
    campaign: !!w.camp,
    cat: l.life.cat,
    wine: l.life.wine,
    adult: adultScenes(),
    // Супруга и слуги зовут по имени, без прозвища («Бертран», а не «Бертран Хромой»).
    ruler: firstName(g.realm.ruler.name) ?? 'Правитель',
    faith: g.faith.id ?? 'catholic',
    wife: l.house.wife,
    maid: l.house.maid,
    servant: l.house.servant,
    heir: firstName(g.realm.heir.name),
  };
}

/** Что видно двору — партия и мир, как их отдают сторы, на эту минуту. */
function courtSource(): CourtSource {
  const w = useWorld.getState();
  return { s: useGame.getState().s, letters: w.letters, siege: w.siege, reports: w.reports, marching: w.rivals.marching, world: worldNow(), ready: w.ready };
}

/** Минута на трёх часах: партии, мира и игрока (отлучка — без ускорения). */
function courtNow(): Moment {
  return { game: useGame.getState().s.time, world: worldNow(), real: serverNow() };
}

/** Открыть весть гонца или строку доклада — дверью игры, поверх покоев: закрыл окно — снова в покоях. */
export function goNews(d: NewsDoor): void {
  const realm = useRealm.getState();
  const g = useGame.getState();
  switch (d.to) {
    case 'mail':
      realm.openMail(d.key);
      break;
    case 'report':
      realm.openChronicle(d.id);
      break;
    case 'chronicle':
      realm.openChronicle(null);
      useRealm.setState({ chronTopic: d.topic });
      break;
    case 'siege':
      g.openSiege();
      break;
    case 'map':
      g.openMap();
      break;
    case 'store': {
      const b = buildingOfType(g.s, 'storage');
      if (b) g.openBuilding(b.id);
      break;
    }
    case 'stab':
      realm.show('stability');
      break;
  }
}

/** Имя без прозвища: первое слово (у составных имён — «Кей-Хосров» — дефис внутри слова). */
const firstName = (n: string | null): string | null => (n ? n.split(' ')[0] : null);

const TRINKET_BY_ID = Object.fromEntries(TRINKETS.map((t) => [t.id, t])) as Record<TrinketId, (typeof TRINKETS)[number]>;

/** Кнопка выхода из дела: сидя и лёжа — «Встать», у окна и огня — «Отойти». */
const LEAVE: Record<SpotId, string> = { desk: 'Встать', bed: 'Встать', window: 'Отойти', windowE: 'Отойти', windowW: 'Отойти', hearth: 'Отойти', arms: 'Отойти', door: 'Отойти', chest: 'Закрыть', chestS: 'Закрыть' };

/**
 * Подписи-указатели первого входа (как в промыслах, docs/minigames.md, 18.1): над пальцем движения, у взгляда и о мебели.
 * Гаснут по делу — пошёл, посмотрел, сделал дело — или через `COACH_MS`; что игрок уже видел, помнит устройство.
 */
export const COACH = {
  walk: 'Веди пальцем — идти и поворачивать',
  look: 'Веди — смотреть',
  act: 'Коснись кресла, кровати, окна, камина — или постучи в дверь',
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

/**
 * Подсказки первого взятия меча в стойку (Г-11): как ходить, рубить, бить сильно и закрываться. Видел — помнит устройство;
 * стоят, пока игрок не ударил и не закрылся, но не дольше `SWORD_COACH_MS`; касание закрывает сразу.
 */
export const SWORD_COACH = [
  'Слева — шаг, как прежде',
  'Справа быстро махни пальцем — меч рубит по этой линии; чем быстрее мах, тем сильнее',
  'Три удара в разные стороны подряд — сильный удар',
  'Дважды коснись у края экрана — блок в ту сторону',
] as const;
const SWORD_COACH_MS = 30000;
const SWORD_KEY = 'tribe.chambers.sword';

function swordSeen(): boolean {
  try {
    return localStorage.getItem(SWORD_KEY) === '1';
  } catch {
    return true;
  }
}

function swordDone(): void {
  try {
    localStorage.setItem(SWORD_KEY, '1');
  } catch {
    /* память устройства недоступна — подскажем ещё раз */
  }
}

export function Chambers() {
  const hide = useChambers((c) => c.hide);
  const ruler = useGame((g) => g.s.realm.ruler.name ?? 'Без имени');
  const faith = useGame((g) => g.s.faith.id ?? 'catholic');
  const layer = useRef<HTMLDivElement>(null);
  const tags = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(() => live !== null);
  const [coach, setCoach] = useState(() => !coachSeen());
  const [swordCoach, setSwordCoach] = useState(false);
  const [heavyFlash, setHeavyFlash] = useState(0);
  const [, bump] = useState(0);
  const view = useView();
  const lv = useLife();
  // Разговор (Г-7): кто подошёл и ждёт слова — окно стоит, пока разговор не кончился (последняя реплика — ещё миг).
  // Каждый подход — свой номер (`LifeView.talk.n`, Г-9): тот же человек с тем же «зачем» начинает новый разговор, даже
  // если плашка прошлого ещё не погасла.
  const [talk, setTalk] = useState<{ who: Who; why: Why; n: number } | null>(null);
  const lvTalk = lv?.talk ?? null;
  useEffect(() => {
    if (lvTalk && talk?.n !== lvTalk.n) setTalk({ ...lvTalk });
  }, [lvTalk?.n]); // eslint-disable-line react-hooks/exhaustive-deps
  // Гонец и советник (Г-10): плашки последней реплики у них нет — ушёл к делу (взяли письмо, «Ступай», «Позже»), и окно гаснет.
  const courtTalk = talk && (talk.who === 'herald' || talk.who === 'advisor');
  useEffect(() => {
    if (courtTalk && !lvTalk) setTalk(null);
  }, [courtTalk, lvTalk]);
  // Плашка разговора закрывает низ экрана: глаз держит собеседника над ней (Р-1, `room.setPlate`) — высоту мерим сами.
  const roomNow = live?.room ?? null;
  useEffect(() => {
    if (!roomNow) return;
    const plate = root.current?.querySelector<HTMLElement>('.ch-talk') ?? null;
    if (!talk || !plate) {
      roomNow.setPlate(null);
      return;
    }
    const measure = (): void => {
      const bottom = (layer.current ?? root.current)?.getBoundingClientRect().bottom ?? window.innerHeight;
      roomNow.setPlate(Math.max(0, bottom - plate.getBoundingClientRect().top));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(plate);
    return () => ro.disconnect();
  }, [roomNow, talk?.n, !!talk, !!lv?.night]); // eslint-disable-line react-hooks/exhaustive-deps
  // Пока говорят и пока ночь — ноги стоят (смотреть можно): держит режиссёр жизни (`life.holdsLegs`).
  const night = lv?.night ?? null;
  // Ночь гасит плашку реплики сразу (`plate.Plate.gone`): утром внизу — ничего.
  useEffect(() => {
    if (night) setTalk(null);
  }, [!!night]); // eslint-disable-line react-hooks/exhaustive-deps

  // Комната встаёт, когда город готов: пока он собирается, слой показывает подъём в покои.
  useEffect(() => {
    let t = 0;
    let up: Live | null = null;
    const tryRise = (): void => {
      const l = rise();
      // Перерисовка — только когда комната встала, а не каждые 400 мс (Г-9: она перезаводила срок последней реплики).
      if (l && l !== up) {
        up = l;
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

  // Бой мечом (Г-11): подсказки при первой стойке, вспышка «Сильный удар» на каждый сильный по чучелу.
  const fighting = !!view?.fight;
  useEffect(() => {
    if (!fighting || swordSeen()) return;
    swordDone();
    setSwordCoach(true);
    const t = window.setTimeout(() => setSwordCoach(false), SWORD_COACH_MS);
    return () => window.clearTimeout(t);
  }, [fighting]);
  const heavies = view?.fight?.heavies ?? 0;
  useEffect(() => {
    if (!heavies) return;
    setHeavyFlash(heavies);
    const t = window.setTimeout(() => setHeavyFlash(0), 1100);
    return () => window.clearTimeout(t);
  }, [heavies]);

  const room = live?.room ?? null;
  const rect = (): DOMRect => (layer.current ?? document.body).getBoundingClientRect();
  const v = view;
  const held = v?.held ? TRINKET_BY_ID[v.held] : null;

  return (
    <div ref={root} className="ch" data-ready={ready ? '1' : '0'}>
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

      {v && (!held || v.fight) && !talk && !night && (
        <>
          {/* Палец движения — рисунок: касание ловит вся левая половина (`prologue/controls.Sticks`), а ведёт палец ручку этого
              кружка (`room.attachPad`) — второго кружка под пальцем нет (Г-12). */}
          <div className="ch-pad" ref={(el) => room?.attachPad(el)} aria-hidden="true">
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

      {held && !v?.fight && (
        <div className="ch-hand">
          <div className="ch-hand-text">
            <b>{held.name}</b>
            <small>{held.id === 'goblet' && (lv?.wine ?? 0) > 0.02 ? 'Вино с юга — полон кубок' : held.hint}</small>
          </div>
          {v?.drink && (
            <button className="ch-put ch-drink" onClick={() => room?.drink()}>
              Выпить
            </button>
          )}
          {v?.stance && (
            <button className="ch-put ch-stance" onClick={() => room?.stance()}>
              В стойку
            </button>
          )}
          <button className="ch-put" onClick={() => room?.drop()}>
            Положить
          </button>
        </div>
      )}

      {/* Бой мечом (Г-11): выносливость, счёт по чучелу, «Повесить на стену». */}
      {v?.fight && !talk && !night && (
        <div className="ch-fight">
          <div className="ch-fight-row">
            <div className={`ch-stamina${v.fight.tired ? ' tired' : ''}`} role="meter" aria-label="Выносливость" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v.fight.stamina * 100)}>
              <i style={{ width: `${Math.round(v.fight.stamina * 100)}%` }} />
            </div>
            <span className="ch-hits">{hitsWords(v.fight.hits)}</span>
          </div>
          <button className="ch-put ch-hang" disabled={v.fight.stowing} onClick={() => room?.hangSword()}>
            Повесить на стену
          </button>
        </div>
      )}
      {v?.fight && heavyFlash > 0 && (
        <div key={heavyFlash} className="ch-heavy" aria-live="polite">
          Сильный удар
        </div>
      )}
      {v?.fight && swordCoach && !(v.fight.struck && v.fight.blocked) && !talk && !night && (
        <button className="ch-sword-coach" onClick={() => setSwordCoach(false)}>
          {SWORD_COACH.map((line) => (
            <span key={line}>{line}</span>
          ))}
        </button>
      )}

      {/* Клубок — коту (Г-7): кот в покоях, правитель стоит, разговора нет. Кинуть — куда смотришь, и в окно (Р-1); не чаще
          раза в десять секунд: кнопка говорит, когда снова. */}
      {v && lv?.cat && !held && !talk && !night && v.mode === 'free' && (
        <button className="ch-ball" disabled={lv.fetching || lv.ballIn > 0} onClick={() => room?.life.throwBall()}>
          {ballWords(lv)}
        </button>
      )}

      {/* Стук гонца (ПК-1): «Впустить» и «Позже» — поверх покоев, сцену не закрывают. */}
      {live?.court.knocking && !night && <KnockBar court={live.court} />}

      {talk && live && !night && talk.who === 'herald' && <HeraldPlate key={talk.n} life={live.room.life} court={live.court} faith={faith} onDone={() => setTalk(null)} />}
      {talk && live && !night && talk.who === 'advisor' && <AdvisorPlate key={talk.n} life={live.room.life} court={live.court} faith={faith} onDone={() => setTalk(null)} />}

      {talk && live && !night && !courtTalk && (
        <Talk
          key={talk.n}
          life={live.room.life}
          who={talk.who}
          why={talk.why}
          base={talkBase}
          memory={() => live!.memory.talk}
          remember={(m) => {
            if (!live) return;
            live.memory.talk = m;
            saveMemory(live.memory);
          }}
          onDone={() => setTalk(null)}
        />
      )}

      {/* Ночь вдвоём (Г-7): только затемнение — сердце и тихая музыка в темноте, утром её уже нет. */}
      {night && live && <Night k={night.k} who={night.who} name={night.who === 'wife' ? live.house.wife.name : live.house.maid} />}

      {!ready && <div className="ch-wait">Поднимаемся в покои…</div>}
      <div className="ch-veil" aria-hidden="true" />
    </div>
  );
}

/** Подпись кнопки клубка: можно — «Кинуть клубок»; кот за ним в окне — ждём; рано — через сколько секунд. */
export function ballWords(lv: Pick<LifeView, 'fetching' | 'ballIn'>): string {
  if (lv.fetching) return 'Кот несёт клубок…';
  if (lv.ballIn > 0) return `Клубок — через ${realPlain(lv.ballIn)}`;
  return 'Кинуть клубок';
}

/** Счёт ударов по чучелу: «Чучело: 0 ударов», «1 удар», «3 удара», «12 ударов». */
export function hitsWords(n: number): string {
  const d = n % 10;
  const h = n % 100;
  const w = d === 1 && h !== 11 ? 'удар' : d >= 2 && d <= 4 && (h < 12 || h > 14) ? 'удара' : 'ударов';
  return `Чучело: ${n} ${w}`;
}

/** Для тестов: живая комната и уборка. */
export const __chambers = {
  live: (): ChambersRoom | null => live?.room ?? null,
  court: (): Court | null => live?.court ?? null,
  fall,
  rise,
};

/** Затемнение ночи: темнеет (до 0,2 доли), в темноте — сердце и «Позже…», утро проступает (после 0,8). */
function Night({ k, who, name }: { k: number; who: Who; name: string }) {
  const dark = k < 0.2 ? k / 0.2 : k > 0.82 ? Math.max(0, 1 - (k - 0.82) / 0.18) : 1;
  const heart = k > 0.22 && k < 0.78;
  const morning = k > 0.62;
  return (
    <div className="ch-night" style={{ opacity: dark }} aria-live="polite">
      <div className={`ch-heart${heart ? ' on' : ''}`} aria-hidden="true">
        <svg viewBox="0 0 32 29" width="72" height="66">
          <path d="M16 28.5S1 19.6 1 9.6C1 4.8 4.7 1 9.3 1c2.8 0 5.3 1.4 6.7 3.6C17.4 2.4 19.9 1 22.7 1 27.3 1 31 4.8 31 9.6c0 10-15 18.9-15 18.9z" />
        </svg>
      </div>
      <p className={`ch-night-text${morning ? ' on' : ''}`}>
        Позже…
        <small>{who === 'wife' ? `${name} ушла к себе до света.` : `${name} ушла тихо, до света.`}</small>
      </p>
    </div>
  );
}
