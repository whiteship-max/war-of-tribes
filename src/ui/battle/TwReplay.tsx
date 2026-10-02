// Ролик боя в стиле Total War поверх сцены (docs/battle_tw.md) — за переключателем `?battle=tw` (`look.ts`);
// без него «Смотреть бой» играет прежний ролик (`BattleReplay`).
//
// Компонент ничего не решает, как и прежний: заводит проигрыватель на одолженной канве и раскладывает то, что пришло.
// Подпись, люди и музыка — у прежней раскадровки (`frameAt`) на той же секунде боя: время у роликов одно (решение 5), и
// строка журнала одна. Полоса сверху — как у боя EU4: знамёна сторон, люди, мораль армий и фаза с кругом (`hudAt` куска
// ролика TW, мораль — из журнала). Карточка итога в конце — числа итога боя и отчёта, своей арифметики у неё нет
// (CLAUDE.md, правило 18). Кнопки приходят данными (`TW_CONTROLS`, `SPEEDS`), а не разметкой — правило прежнего ролика.
//
// Камерой правит игрок: ввод — на слое ролика, а не на холсте, где сидит ввод сцены города.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import * as THREE from 'three';
import { activeScene } from '@/render/Scene';
import { configureRenderer } from '@/render/lighting';
import { pixelRatio } from '@/render/loop';
import { PALETTE } from '@/render/palette';
import { PHASE_NAME, summarize, type Side } from '@/battle';
import { SKIP, frameAt, type Frame } from '@/battle/replay';
import { castOfRecord } from '@/game/battle/cast';
import { beastSummary, beastWords } from '@/game/battle/beasts';
import { battleMusic, villageMusic } from '@/sound/web';
import { soundOn, subscribeSound } from '@/sound/settings';
import { lootText, unitsText } from '@/ui/parts/reportWords';
import type { BattleRecord, Report } from '@/world/types';
import type { TwHud } from '@/render/tw/hud';
import type { TwPlayer } from '@/render/tw/player';
import type { BattleFx } from '@/sound/battlefx';
import './tw.css';

/** Кнопки ролика TW: «Пропустить», как у прежнего, и «Общий вид» — вернуть камеру режиссуре. */
const OVERVIEW = { id: 'overview', label: 'Общий вид' } as const;
const TW_CONTROLS = [OVERVIEW, SKIP] as const;
/** Скорость хода на полосе: как у Total War — обычная, вдвое и вчетверо. */
const SPEEDS = [1, 2, 4] as const;
/** Кнопки карточки итога: пересмотреть или в отчёт. */
const AGAIN = { id: 'again', label: 'Смотреть снова' } as const;
const TO_REPORT = { id: 'report', label: 'К отчёту' } as const;
const CARD_CONTROLS = [AGAIN, TO_REPORT] as const;
/**
 * Звук в ролике — «тише» на этот просмотр, а не второй рычаг: включён ли звук вообще, решает одна настройка («Музыка»,
 * `ui/parts/Settings.tsx`). Выключена она — кнопка погашена и говорит, где включить; настройку отсюда не пишет никто.
 */
const SOUND = { id: 'sound', on: '🔊', off: '🔇', why: 'Звук выключен в настройках' } as const;

const css = (hex: number): string => `#${hex.toString(16).padStart(6, '0')}`;
/** Знамя стороны на полосе — цвет стороны в бою: наши в синем, чужие в красном (правило ролика). */
const FLAG = { ours: css(PALETTE.paintBlue), theirs: css(PALETTE.paintRed) };

const other = (s: Side): Side => (s === 'attacker' ? 'defender' : 'attacker');

export function TwReplay({ rec, report, onDone }: { rec: BattleRecord; report?: Report; onDone: () => void }) {
  const us = rec.us;
  const them = other(us);
  const cast = useMemo(() => castOfRecord(rec.result, rec.us, rec.troops, rec.militia, rec.place, rec.beasts), [rec]);
  const [frame, setFrame] = useState<Frame>(() => frameAt(cast, 0));
  const [hud, setHud] = useState<TwHud | null>(null);
  const [loaded, setLoaded] = useState<'wait' | 'ok' | 'fail'>('wait');
  const [speed, setSpeed] = useState<number>(1);
  const [ended, setEnded] = useState(false);
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
    villageMusic.duck(true);
    let alive = true;
    let dispose: () => void = () => undefined;
    let onResize: () => void = () => undefined;
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
        const quality = scene?.quality ?? 'medium';
        let clock: InstanceType<typeof m.CueClock> | null = null;
        let lastT = 0;
        const p = m.playTw(
          renderer,
          { result: rec.result, us: rec.us, troops: rec.troops, militia: rec.militia, place: rec.place, beasts: rec.beasts },
          quality,
          layer.current,
          {
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
              const mor = (v: number | null): string => (v === null ? '-' : v.toFixed(2));
              const key = `${f.caption ?? ''}|${h.phase}|${h.round}|${f.side.attacker.men}|${f.side.defender.men}|${mor(h.morale.attacker)}|${mor(h.morale.defender)}`;
              if (key === shown.current) return;
              shown.current = key;
              setFrame(f);
              setHud(h);
            },
            onEnd: () => {
              fx.current?.rest();
              setEnded(true);
            },
          },
        );
        player.current = p;
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
        p.fit();
        p.start();
        onResize = () => p.fit();
        window.addEventListener('resize', onResize);
        dispose = () => p.dispose();
        setLoaded('ok');
      })
      .catch((e: unknown) => {
        // Причина — в консоль: «не загрузился» без неё не отличить сеть от ошибки в коде ролика.
        console.error('ролик TW:', e);
        if (alive) setLoaded('fail');
      });
    return () => {
      alive = false;
      player.current = null;
      document.removeEventListener('visibilitychange', onHide);
      fx.current?.stop();
      fx.current = null;
      window.removeEventListener('resize', onResize);
      dispose();
      battleMusic.stop();
      villageMusic.duck(false);
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
  }, [cast, rec]);

  const pick = (id: string): void => {
    if (id === 'skip' || id === 'report') done.current();
    else if (id === 'overview') player.current?.cam.release();
    else if (id === 'again') {
      setEnded(false);
      player.current?.seek(0);
      player.current?.start();
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
    setSpeed(n);
    if (player.current) player.current.speed = n;
  };

  const sideName = { [us]: 'Наши', [them]: rec.beasts === them ? 'Волки' : 'Противник' } as Record<Side, string>;
  const bar = (side: Side) => {
    const m = hud?.morale[side] ?? null;
    return (
      <div className={`tw-side${side === us ? '' : ' them'}`}>
        <span className="tw-flag" style={{ background: side === us ? FLAG.ours : FLAG.theirs }} />
        <span className="tw-name">{sideName[side]}</span>
        <span className="tw-men">{frame.side[side].men}</span>
        {m !== null && (
          <span className="tw-morale" title="Мораль армии">
            <i style={{ width: `${Math.round(m * 100)}%` }} />
          </span>
        )}
      </div>
    );
  };

  return createPortal(
    <div className="replay replay-tw" ref={layer}>
      <div className="tw-top">
        <div className="tw-bar">
          {bar(us)}
          <div className="tw-phase">
            <b>{PHASE_NAME[hud?.phase ?? frame.phase]}</b>
            {(hud?.round ?? 1) > 1 && <small>круг {hud!.round}</small>}
          </div>
          {bar(them)}
        </div>
        <div className="tw-speed">
          {SPEEDS.map((n) => (
            <button className={`btn${speed === n ? '' : ' ghost'}`} key={n} onClick={() => go(n)}>
              ×{n}
            </button>
          ))}
          <button
            className="btn ghost"
            key={SOUND.id}
            disabled={!audible}
            title={audible ? undefined : SOUND.why}
            aria-label={audible ? (muted ? 'Включить звук боя' : 'Тише') : SOUND.why}
            onClick={hush}
          >
            {audible && !muted ? SOUND.on : SOUND.off}
          </button>
        </div>
      </div>
      {loaded === 'fail' && <div className="replay-caption">Ролик не загрузился — итог боя в отчёте.</div>}
      {loaded !== 'fail' && !ended && frame.caption && <div className="replay-caption">{beastWords(frame.caption, rec.beasts, us)}</div>}
      {ended && <ResultCard rec={rec} report={report} onPick={pick} />}
      {!ended && (
        <div className="replay-controls">
          {TW_CONTROLS.map((c) => (
            <button className="btn" key={c.id} onClick={() => pick(c.id)}>
              {c.label}
            </button>
          ))}
        </div>
      )}
    </div>,
    document.body,
  );
}

/**
 * Карточка итога: исход словами итога боя (`summarize`), силы и размен — итог боя, кто не вернулся, добыча и пленные —
 * отчёт (`Report.lost`, `loot`, `led`, `held`) теми же словами, что в нём (`reportWords`). Отчёта нет (стенд) — только итог
 * боя.
 */
function ResultCard({ rec, report, onPick }: { rec: BattleRecord; report?: Report; onPick: (id: string) => void }) {
  const us = rec.us;
  const sum = beastSummary(summarize(rec.result, us), rec.beasts, us);
  const ours = rec.result.sides[us].total;
  const foes = rec.result.sides[other(us)].total;
  const loot = report ? lootText(report.loot) : '';
  const won = report ? report.won : sum.verdict === 'victory' || sum.verdict === 'pyrrhic';
  return (
    <div className="tw-card">
      <h3>{sum.title}</h3>
      <p className={`note${sum.verdict === 'defeat' || sum.verdict === 'pyrrhic' ? ' bad' : ''}`}>{sum.reason}</p>
      <div className="mod-list">
        <div className="mod">
          <span className="name">Наши силы</span>
          <span className="val">
            {ours.initial} → {ours.final}
          </span>
        </div>
        <div className="mod">
          <span className="name">{rec.beasts === other(us) ? 'Стая' : 'Противник'}</span>
          <span className="val">
            {foes.initial} → {foes.final}
          </span>
        </div>
        <div className="mod total">
          <span className="name">Потери</span>
          <span className={`val ${foes.losses >= ours.losses ? '' : 'neg'}`}>
            {ours.losses} за {foes.losses}
          </span>
        </div>
        {report && Object.keys(report.lost).length > 0 && (
          <div className="mod">
            <span className="name">Не вернулись</span>
            <span className="val">{unitsText(report.lost)}</span>
          </div>
        )}
        {loot && (
          <div className="mod">
            <span className="name">{won ? 'Добыча' : 'Унесли'}</span>
            <span className="val">{loot}</span>
          </div>
        )}
        {report?.led !== undefined && report.led > 0 && (
          <div className="mod">
            <span className="name">{won ? 'Увели невольниками' : 'Увели наших'}</span>
            <span className="val">{report.led}</span>
          </div>
        )}
        {report?.held !== undefined && report.held > 0 && (
          <div className="mod">
            <span className="name">Наши в плену, ждут выкупа</span>
            <span className="val">{report.held}</span>
          </div>
        )}
      </div>
      <div className="replay-controls">
        {CARD_CONTROLS.map((c) => (
          <button className="btn" key={c.id} onClick={() => onPick(c.id)}>
            {c.label}
          </button>
        ))}
      </div>
    </div>
  );
}
