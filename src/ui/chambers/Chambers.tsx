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
import { useWorld, marchesOnUs, worldNow } from '@/world/store';
import { useRealm } from '@/ui/realm/open';
import type { LifeView, Who, Why } from '@/render/chambers/life';
import { Talk } from './TalkWindow';
import { daypartOf, household, type TalkCtx } from './talk';
import { loadMemory, saveMemory, type ChambersMemory } from './memory';
import { adultScenes } from './adult';
import { Court } from './court';
import { AdvisorPlate, HeraldPlate } from './CourtWindow';
import type { NewsDoor, WorldNews } from './tidings';

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
  /** Гонец и советник (Г-10): очередь важных вестей и доклад после отлучки. */
  court: Court;
  /** Отписка двора от стора мира. */
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
  const room = new ChambersRoom(keep, armsOr(s.profile.arms), scene.quality, () => asCity(activeScene())?.cityShare()?.uniforms.cityTex.value ?? null, memory.life);
  const sound = new ChambersSound();
  const court = new Court(room.life, {
    world: worldNews,
    advisor: () => {
      const g = useGame.getState().s;
      return { log: g.log, time: g.time, gold: g.gold, inbox: g.inbox.length, world: worldNews() };
    },
    memory: () => memory.advisor,
    remember: (m) => {
      memory.advisor = m;
      saveMemory(memory);
    },
    open: goNews,
    later: (f, ms) => void setTimeout(f, ms),
  });
  court.onChange = notify;
  // Мир переменился — нет ли важной вести для гонца (письмо, пролом, предложение у стен, итог боя).
  const unwatch = useWorld.subscribe((w, was) => {
    if (w.letters !== was.letters || w.siege !== was.siege || w.camp !== was.camp || w.reports !== was.reports) court.look();
  });
  live = { room, scene: null, sound, view: room.view(), life: room.life.view(), memory, house, court, unwatch, subs: new Set() };
  room.onChange = notify;
  room.life.onChange = notify;
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
  // Донесения — свежие: советнику вести по ним строки, гонцу — заметить новый бой (пульс перечитывает непустой список).
  // Советник встаёт к докладу, когда список пришёл; нет мира (тесты, стенд без мира) — докладывает по тому, что есть.
  const greet = (): void => {
    if (live?.court === court) court.greet();
  };
  try {
    void useWorld.getState().loadReports().then(greet, greet);
  } catch {
    greet();
  }
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

/** Вести мира — как их отдаёт стор мира, на эту минуту. */
function worldNews(): WorldNews {
  const w = useWorld.getState();
  return { letters: w.letters, siege: w.siege, camp: w.camp, reports: w.reports, now: worldNow() };
}

/** Открыть весть гонца или строку доклада — дверью игры, поверх покоев: закрыл окно — снова в покоях. */
export function goNews(d: NewsDoor): void {
  const realm = useRealm.getState();
  const g = useGame.getState();
  switch (d.to) {
    case 'mail':
      realm.openMail(d.key);
      break;
    case 'inbox':
      realm.openMail(null);
      break;
    case 'report':
      realm.openChronicle(d.id);
      break;
    case 'chronicle':
      realm.openChronicle(null, d.topic);
      break;
    case 'siege':
      g.openSiege();
      break;
    case 'camp':
      g.openCamp();
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

export function Chambers() {
  const hide = useChambers((c) => c.hide);
  const ruler = useGame((g) => g.s.realm.ruler.name ?? 'Без имени');
  const faith = useGame((g) => g.s.faith.id ?? 'catholic');
  const layer = useRef<HTMLDivElement>(null);
  const tags = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(() => live !== null);
  const [coach, setCoach] = useState(() => !coachSeen());
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
      // Гонец ждал, пока кончится сцена или разговор, — позвать снова.
      live?.court.call();
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

      {v && !held && !talk && !night && (
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
            <small>{held.id === 'goblet' && (lv?.wine ?? 0) > 0.02 ? 'Вино с юга — полон кубок' : held.hint}</small>
          </div>
          {v?.drink && (
            <button className="ch-put ch-drink" onClick={() => room?.drink()}>
              Выпить
            </button>
          )}
          <button className="ch-put" onClick={() => room?.drop()}>
            Положить
          </button>
        </div>
      )}

      {/* Клубок — коту (Г-7): кот в покоях, правитель стоит, разговора нет. */}
      {v && lv?.cat && !held && !talk && !night && v.mode === 'free' && (
        <button className="ch-ball" onClick={() => room?.life.throwBall()}>
          Клубок
        </button>
      )}

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

/** Для тестов: живая комната и уборка. */
export const __chambers = {
  live: (): ChambersRoom | null => live?.room ?? null,
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
