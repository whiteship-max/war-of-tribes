// Ролик боя в стиле Total War поверх сцены (docs/battle_tw.md; ГФ-1 — docs/gfx.md). Ролик один (`BattleReplay`).
//
// Компонент ничего не решает: заводит проигрыватель на одолженной канве и раскладывает то, что пришло. Подпись и музыка —
// у раскадровки (`frameAt`) на той же секунде боя: время у роликов одно, и строка журнала одна. Сверху — мораль армий и
// фаза с кругом, как у боя EU4 (`hudAt`, мораль — из журнала); внизу — шкала сил обеих сторон (`reel/strength`: от того,
// с чем начали, к ровно итогу боя). Карточка итога в конце — числа итога боя и донесения, своей арифметики у неё нет
// (CLAUDE.md, правило 18). Части — набора `ui/kit` (docs/ui_v2.md, раздел 2): полоса, кнопка, строка; у каждого числа —
// подсказка с разбором (`TipLayer` того же слоя, что у игры). Кнопки приходят данными (`TW_CONTROLS`, `SPEEDS`), а не
// разметкой — правило прежнего ролика.
//
// «Пропустить» — к следующему такту смысла (сшибка, перелом, развязка, поле после боя), «Итог» — карточка итога сразу
// (docs/gfx.md, «Управление»). Камерой правит игрок: ввод — на слое ролика, а не на холсте, где сидит ввод сцены города;
// взял камеру — кнопка «Камера ролика» возвращает её режиссёру.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import * as THREE from 'three';
import { activeScene } from '@/render/Scene';
import { configureRenderer } from '@/render/lighting';
import { pixelRatio } from '@/render/loop';
import { gfx, levelNow, sceneGfx } from '@/render/gfx';
import { holdReplayCanvas } from './canvas';
import { SIDE_COLOR, SIDE_VARS } from '@/side';
import { PHASE_NAME, summarize, type Side } from '@/battle';
import { SKIP, frameAt, type Frame } from '@/battle/replay';
import { castOfRecord } from '@/game/battle/cast';
import { beastSummary, beastWords } from '@/game/battle/beasts';
import { battleMusic } from '@/sound/web';
import { cityAudio } from '@/sound/city';
import { soundOn, subscribeSound } from '@/sound/settings';
import { lootText, unitsText } from '@/ui/parts/reportWords';
import { Bar } from '@/ui/kit/Bar';
import { Btn } from '@/ui/kit/Btn';
import { Row } from '@/ui/kit/Row';
import { TipLayer } from '@/ui/next/TipLayer';
import type { TipContent, TipRow } from '@/ui/next/tip';
import type { BattleRecord, Report } from '@/world/types';
import type { TwHud } from '@/render/reel/hud';
import { strengthAt, type SideStrength } from '@/render/reel/strength';
import type { TwPlayer } from '@/render/tw/player';
import type { BattleFx } from '@/sound/battlefx';
import { freeTurn } from '@/orientation';
import { barrageCaption, barrageShares } from './barrage';
import { coatsOfRecord } from './coats';
import './tw.css';

/**
 * Кнопки ролика: «Пропустить» — к следующему такту смысла (в прологе обстрела — к бою), «Итог» — карточка итога сразу.
 * Подпись «Пропустить» — та же, что у раскадровки (`SKIP`): слово одно на игру.
 */
const NEXT = { id: 'next', label: SKIP.label } as const;
const RESULT = { id: 'result', label: 'Итог' } as const;
const TW_CONTROLS = [NEXT, RESULT] as const;
/** Камеру взял палец — эта кнопка возвращает её режиссёру (`reel/director`). */
const DIRECTOR = { id: 'director', label: 'Камера ролика' } as const;
/** Скорость хода на полосе: как у Total War — обычная, вдвое и вчетверо. */
const SPEEDS = [1, 2, 4] as const;
/** Кнопки карточки итога: пересмотреть или в донесение. */
const AGAIN = { id: 'again', label: 'Смотреть снова' } as const;
const TO_REPORT = { id: 'report', label: 'К донесению' } as const;
/**
 * Звук в ролике — «тише» на этот просмотр, а не второй рычаг: включён ли звук вообще, решает одна настройка («Музыка»,
 * `ui/parts/Settings.tsx`). Выключена она — кнопка погашена и говорит, где включить; настройку отсюда не пишет никто.
 */
const SOUND = { id: 'sound', on: '🔊', off: '🔇', why: 'Звук выключен в настройках' } as const;

/**
 * Цвет стороны — переменными на корне ролика (`side.SIDE_VARS`): знамя и мораль на полосе, шкала сил, метки сторон в
 * карточке итога — наши в золоте, чужие в красном, одной дверью с фигурами, картой и донесением (`tw.css`).
 */
const SIDES_STYLE = SIDE_VARS as CSSProperties;
/** Шкала сил: наша доля — золотом, их — красным (`side.ts`). */
const SPLIT = { fill: SIDE_COLOR.ours, rest: SIDE_COLOR.foe };

const other = (s: Side): Side => (s === 'attacker' ? 'defender' : 'attacker');

/** Разбор силы стороны: начали, пало к этой секунде — в строю. Числа — шкалы сил, своей арифметики у подсказки нет. */
function strengthRows(s: SideStrength): { rows: TipRow[]; sum: TipRow } {
  return {
    rows: [{ label: 'Начали бой', value: String(s.initial) }, ...(s.lost > 0 ? [{ label: 'Пало', value: `−${s.lost}`, tone: 'bad' as const }] : [])],
    sum: { label: 'В строю', value: String(s.men) },
  };
}

export interface TwReplayProps {
  rec: BattleRecord;
  report?: Report;
  onDone: () => void;
  /** Стенд (`tw/stand.mountTwStandUi`): кадр стоит на этой секунде ролика, ход не идёт. В игре — нет. */
  freeze?: number | null;
  /** Стенд: сразу карточка итога. */
  ended?: boolean;
}

export function TwReplay({ rec, report, onDone, freeze = null, ended: endedAtStart = false }: TwReplayProps) {
  const us = rec.us;
  const them = other(us);
  const cast = useMemo(() => castOfRecord(rec.result, rec.us, rec.troops, rec.militia, rec.place, rec.beasts), [rec]);
  const [frame, setFrame] = useState<Frame>(() => frameAt(cast, 0));
  const [hud, setHud] = useState<TwHud | null>(null);
  const [force, setForce] = useState<Record<Side, SideStrength>>(() => strengthAt(cast, rec.result, 0));
  const [loaded, setLoaded] = useState<'wait' | 'ok' | 'fail'>('wait');
  // Скорость ролика — своё имя, не `speed`: «скорость» в игре — часы партии (`game/pace`), и путать их нельзя.
  const [rate, setRate] = useState<number>(1);
  const [ended, setEnded] = useState(false);
  // Камеру взял палец: кнопка «Камера ролика» возвращает её режиссёру.
  const [taken, setTaken] = useState(false);
  // Идёт ли пролог обстрела перед штурмом: подпись и фаза — его, «Пропустить» — к бою.
  const [barrage, setBarrage] = useState(false);
  const shown = useRef('');
  const done = useRef(onDone);
  done.current = onDone;
  const layer = useRef<HTMLDivElement>(null);
  const player = useRef<TwPlayer | null>(null);
  const fx = useRef<BattleFx | null>(null);
  const audible = useSyncExternalStore(subscribeSound, soundOn);
  const [muted, setMuted] = useState(false);
  const mute = useRef(false);
  mute.current = muted;

  // Ролик — в любой ориентации (решение владельца 04.10.2026): закрепление вертикали снято, на выходе — снова.
  useEffect(() => freeTurn('ролик боя'), []);

  useEffect(() => {
    const scene = activeScene();
    document.body.classList.add('replaying');
    let own: THREE.WebGLRenderer | null = null;
    let ownWrap: HTMLDivElement | null = null;
    let renderer: THREE.WebGLRenderer;
    if (scene) {
      renderer = scene.lend(true);
    } else {
      ownWrap = document.createElement('div');
      ownWrap.className = 'canvas-wrap';
      const canvas = document.createElement('canvas');
      ownWrap.appendChild(canvas);
      (document.querySelector('.app') ?? document.body).appendChild(ownWrap);
      own = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
      own.setPixelRatio(pixelRatio());
      configureRenderer(own);
      renderer = own;
    }
    renderer.info.autoReset = false;
    battleMusic.start();
    cityAudio.hush('battle', true);
    let alive = true;
    let dispose: () => void = () => undefined;
    let release: () => void = () => undefined;
    // Звук боя качается вместе с роликом, а не после него: рог построения не ждёт второй докачки.
    const sound = import('@/sound/battlefx');
    // Ролик не приехал — звук ему не нужен, и отказ его докачки не должен лететь в консоль необработанным.
    sound.catch(() => undefined);
    // Страница скрыта — кадров нет, и гул смолкает, а не тянет последний кадр.
    const onHide = (): void => {
      if (document.hidden) fx.current?.rest();
    };
    document.addEventListener('visibilitychange', onHide);
    void import('@/render/tw/play')
      .then((m) => {
        if (!alive || !layer.current) return;
        // Уровень — тот же, что у города, и опущенный сторожем, если телефон не потянул (`gfx.levelNow`, docs/perf.md):
        // ролик рисует в холст города с его плотностью, и фигур ему не больше, чем тянет этот телефон. Уровень по устройству
        // сторожит и сам ролик (`TwPlayerOptions.watch`, правило города): не держит кадра — гаснет лишнее, плотность падает
        // у холста города (`Scene.lowerTo`), и уровень помнится неделю. Уровень задал игрок или адрес — сторожа нет.
        const quality = levelNow(location.search);
        const asked = sceneGfx(gfx(), location.search).asked;
        let clock: InstanceType<typeof m.CueClock> | null = null;
        let lastT = 0;
        const p = m.playTw(
          renderer,
          {
            result: rec.result,
            us: rec.us,
            troops: rec.troops,
            militia: rec.militia,
            place: rec.place,
            beasts: rec.beasts,
            site: rec.site,
            breach: barrageShares(rec.shots, rec.breach),
            ...(rec.openings ? { openings: rec.openings } : {}),
            coats: coatsOfRecord(rec, report),
          },
          quality,
          layer.current,
          {
            ...(asked ? {} : { watch: quality }),
            onLower: (q) => {
              if (!scene) return;
              scene.lowerTo(q);
              scene.resize();
              player.current?.fit();
            },
            onFrame: (t, castT) => {
              const f = frameAt(cast, castT);
              battleMusic.set(mute.current ? 'silence' : f.music);
              // Звук боя: что пришло с прошлого кадра, гул на кадре, ухо — камера. Проигрыватель ещё строится — молчим.
              const pl = player.current;
              if (pl && fx.current && clock) {
                const e = pl.cam.camera.matrixWorld.elements;
                const r = Math.hypot(e[0], e[2]) || 1;
                const cam = pl.cam.camera.position;
                fx.current.frame(clock.take(t), m.ambienceAt(pl.plan, pl.stage.frame), { x: cam.x, y: cam.y, z: cam.z, rx: e[0] / r, rz: e[2] / r }, Math.max(0, Math.min(0.25, t - lastT)));
              }
              lastT = t;
              const h = m.hudAt(cast, rec.result, castT);
              const s = strengthAt(cast, rec.result, castT);
              const mor = (v: number | null): string => (v === null ? '-' : v.toFixed(2));
              const pre = pl?.barrage ?? false;
              const key = `${pre}|${f.caption ?? ''}|${h.phase}|${h.round}|${s.attacker.men}|${s.defender.men}|${mor(h.morale.attacker)}|${mor(h.morale.defender)}`;
              if (key === shown.current) return;
              shown.current = key;
              setFrame(f);
              setHud(h);
              setForce(s);
              setBarrage(pre);
            },
            onEnd: () => {
              fx.current?.rest();
              setEnded(true);
            },
          },
        );
        player.current = p;
        p.cam.onTake = () => setTaken(true);
        clock = new m.CueClock(m.cuesOf(p.plan));
        // Звук боя — своей докачкой, после первого кадра. Контекст открыло нажатие «Смотреть бой» (`battleMusic.arm`):
        // машинка берёт у него выход и сама ничего не открывает; звук выключен — молчит и не грузит ни узла.
        void sound
          .then((sfx) => {
            if (!alive) return;
            const f = sfx.battleFx(quality === 'low');
            f.arm();
            f.setMuted(mute.current);
            fx.current = f;
          })
          .catch(() => undefined);
        // Размер своего холста, аспект по ResizeObserver и мёртвый контекст — `./canvas`.
        release = holdReplayCanvas(renderer, scene, () => p.fit(), () => done.current());
        if (endedAtStart) {
          p.finish();
          setEnded(true);
        } else if (freeze !== null) p.seek(freeze);
        else p.start();
        dispose = () => p.dispose();
        setLoaded('ok');
      })
      .catch((e: unknown) => {
        // Причина — в консоль: «не открылся» без неё не отличить сеть от ошибки в коде ролика.
        console.error('ролик TW:', e);
        if (alive) setLoaded('fail');
      });
    return () => {
      alive = false;
      player.current = null;
      document.removeEventListener('visibilitychange', onHide);
      fx.current?.stop();
      fx.current = null;
      release();
      dispose();
      battleMusic.stop();
      cityAudio.hush('battle', false);
      if (scene) {
        scene.lend(false);
        scene.renderOnce();
      }
      if (own) {
        own.dispose();
        try {
          own.forceContextLoss();
        } catch {
          /* старый драйвер не отдаёт контекст — заберёт сборщик */
        }
      }
      ownWrap?.remove();
      document.body.classList.remove('replaying');
    };
  }, [cast, rec, report, freeze, endedAtStart]);

  const pick = (id: string): void => {
    const p = player.current;
    if (id === 'next') {
      // «Пропустить» — к следующему такту; дальше некуда (поле после боя) — итог.
      if (p?.skipNext()) return;
      p?.finish();
      fx.current?.rest();
      setEnded(true);
    } else if (id === 'result') {
      p?.finish();
      fx.current?.rest();
      setEnded(true);
    } else if (id === 'report') done.current();
    else if (id === 'director') {
      p?.cam.release();
      setTaken(false);
    } else if (id === 'again') {
      setEnded(false);
      p?.seek(0);
      p?.start();
    }
  };
  // Звук включили, пока шёл ролик: машинка берёт выход у уже открытого контекста — включение и было жестом.
  useEffect(() => {
    if (audible) fx.current?.arm();
  }, [audible]);

  const hush = (): void => {
    const next = !muted;
    setMuted(next);
    fx.current?.setMuted(next);
  };
  const go = (n: number): void => {
    setRate(n);
    if (player.current) player.current.speed = n;
  };

  const sideName = { [us]: 'Наши', [them]: rec.beasts === them ? 'Волки' : 'Враг' } as Record<Side, string>;
  /** Мораль армии на полосе сверху: доля полной морали по журналу (`hudAt`); у записи без морали фаз — только имя. */
  const morale = (side: Side) => {
    const m = hud?.morale[side] ?? null;
    if (m === null) return <span className="tw-name">{sideName[side]}</span>;
    const pct = Math.round(m * 100);
    return (
      <Bar
        value={pct}
        max={100}
        label={side === us ? sideName[side] : undefined}
        text={side === us ? undefined : sideName[side]}
        paint={{ fill: side === us ? SIDE_COLOR.ours : SIDE_COLOR.foe, rest: 'rgba(255, 255, 255, 0.15)' }}
        tip={() => ({
          title: `Мораль: ${sideName[side]}`,
          body: 'Доля полной морали армии по журналу боя. Тает от потерь и ударов во фланг; у кого кончится раньше — тот бежит.',
          sum: { label: 'Мораль', value: `${pct} %` },
        })}
      />
    );
  };
  const strengthTip = (): TipContent => ({
    title: 'Силы на поле',
    body: 'Сколько бойцов в строю. Тает по журналу боя; к концу боя — ровно итог донесения.',
    ...strengthRows(force[us]),
    more: { title: sideName[them], ...strengthRows(force[them]) },
  });

  return createPortal(
    <div className="replay replay-tw" ref={layer} style={SIDES_STYLE}>
      <div className="tw-top">
        <div className="tw-bar">
          <div className="tw-side">{morale(us)}</div>
          <div className="tw-phase">
            <b>{barrage ? 'Обстрел' : PHASE_NAME[hud?.phase ?? frame.phase]}</b>
            {!barrage && (hud?.round ?? 1) > 1 && <small>круг {hud!.round}</small>}
          </div>
          <div className="tw-side them">{morale(them)}</div>
        </div>
        <div className="tw-speed">
          {SPEEDS.map((n) => (
            <Btn key={n} kind={rate === n ? 'main' : 'plain'} onClick={() => go(n)}>
              ×{n}
            </Btn>
          ))}
          <Btn key={SOUND.id} why={audible ? null : SOUND.why} label={audible ? (muted ? 'Включить звук боя' : 'Тише') : SOUND.why} onClick={hush}>
            {audible && !muted ? SOUND.on : SOUND.off}
          </Btn>
        </div>
      </div>
      {loaded === 'fail' && <div className="replay-caption">Ролик не открылся. Итог боя — в донесении.</div>}
      {loaded !== 'fail' && !ended && barrage && <div className="replay-caption">{barrageCaption(rec)}</div>}
      {loaded !== 'fail' && !ended && !barrage && frame.caption && <div className="replay-caption">{beastWords(frame.caption, rec.beasts, us)}</div>}
      {ended && <ResultCard rec={rec} report={report} onPick={pick} />}
      {!ended && (
        <div className="tw-foot">
          <Bar
            value={force[us].men}
            max={force[us].men + force[them].men}
            label={`${sideName[us]} ${force[us].men}`}
            text={`${force[them].men} ${sideName[them]}`}
            paint={SPLIT}
            tip={strengthTip}
          />
          <div className="replay-controls">
            {TW_CONTROLS.map((c) => (
              <Btn key={c.id} onClick={() => pick(c.id)}>
                {c.label}
              </Btn>
            ))}
            {taken && (
              <Btn key={DIRECTOR.id} kind="link" onClick={() => pick(DIRECTOR.id)}>
                {DIRECTOR.label}
              </Btn>
            )}
          </div>
        </div>
      )}
      <TipLayer />
    </div>,
    document.body,
  );
}

/**
 * Карточка итога: исход словами итога боя (`summarize`), силы и размен — итог боя, кто не вернулся, добыча и пленные —
 * донесение (`Report.lost`, `loot`, `led`, `held`) теми же словами, что в нём (`reportWords`). Донесения нет (стенд) —
 * только итог боя. Силы — строками с разбором: начали, пало, в строю — те же числа, что у шкалы сил на последнем кадре.
 */
function ResultCard({ rec, report, onPick }: { rec: BattleRecord; report?: Report; onPick: (id: string) => void }) {
  const us = rec.us;
  const them = other(us);
  const sum = beastSummary(summarize(rec.result, us), rec.beasts, us);
  const ours = rec.result.sides[us].total;
  const foes = rec.result.sides[them].total;
  const loot = report ? lootText(report.loot) : '';
  const won = report ? report.won : sum.verdict === 'victory' || sum.verdict === 'pyrrhic';
  const foeName = rec.beasts === them ? 'Стая' : 'Враг';
  const forceTip = (title: string, t: typeof ours) => (): TipContent => ({ title, ...strengthRows({ men: t.final, initial: t.initial, lost: t.losses }) });
  return (
    <div className="tw-card">
      <h3>{sum.title}</h3>
      <p className={`note${sum.verdict === 'defeat' || sum.verdict === 'pyrrhic' ? ' bad' : ''}`}>{sum.reason}</p>
      <div className="tw-card-rows">
        <Row
          label={
            <>
              <i className="tw-mark" />
              Наши силы
            </>
          }
          value={`${ours.initial} → ${ours.final}`}
          tip={forceTip('Наши силы', ours)}
        />
        <Row
          label={
            <>
              <i className="tw-mark them" />
              {foeName}
            </>
          }
          value={`${foes.initial} → ${foes.final}`}
          tip={forceTip(foeName, foes)}
        />
        <Row
          label="Потери"
          value={`${ours.losses} за ${foes.losses}`}
          tone={foes.losses >= ours.losses ? undefined : 'bad'}
          tip={() => ({
            title: 'Потери',
            body: 'Сколько пало у нас и сколько мы выбили у них — по итогу боя.',
            rows: [
              { label: 'Наши', value: `−${ours.losses}`, tone: 'bad' },
              { label: foeName, value: `−${foes.losses}`, tone: 'good' },
            ],
          })}
        />
        {report && Object.keys(report.lost).length > 0 && <Row label="Не вернулись" value={unitsText(report.lost)} />}
        {loot && <Row label={won ? 'Добыча' : 'Унесли'} value={loot} />}
        {report?.led !== undefined && report.led > 0 && <Row label={won ? 'Увели невольниками' : 'Увели наших'} value={report.led} />}
        {report?.held !== undefined && report.held > 0 && <Row label="Наши в плену, ждут выкупа" value={report.held} />}
      </div>
      <div className="replay-controls">
        <Btn onClick={() => onPick(AGAIN.id)}>{AGAIN.label}</Btn>
        <Btn kind="main" onClick={() => onPick(TO_REPORT.id)}>
          {TO_REPORT.label}
        </Btn>
      </div>
    </div>
  );
}
