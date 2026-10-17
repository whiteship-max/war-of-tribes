// Ролик осады поверх сцены (docs/gfx.md, ГФ-2): вся осада или короткий ролик её эпизода (пролом, вылазка, сдача).
//
// Как ролик боя (`TwReplay`), компонент ничего не решает: переводит запись осады из донесения в то, что показать (дверями
// мира, `./siege.ts`), заводит проигрыватель на одолженной канве и раскладывает то, что пришло. Сверху — фаза и проломы
// (на секунде ролика — столько, сколько стоит рухнувших кусков стены: тот же счёт, что журнал фаз), подпись эпизода —
// словами мира (строка журнала фазы, имена машин, донесение). Карточка итога — числа донесения, своей арифметики нет
// (CLAUDE.md, правило 18). «Пропустить» — к следующему эпизоду, «Итог» — карточка сразу; камеру можно взять пальцем,
// «Камера ролика» возвращает её режиссуре. Части — набора `ui/kit`.
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import * as THREE from 'three';
import { activeScene } from '@/render/Scene';
import { configureRenderer } from '@/render/lighting';
import { pixelRatio } from '@/render/loop';
import { gfx, levelNow, sceneGfx } from '@/render/gfx';
import { holdReplayCanvas } from './canvas';
import { SIDE_VARS } from '@/side';
import { SKIP } from '@/battle/replay';
import { battleMusic } from '@/sound/web';
import { cityAudio } from '@/sound/city';
import { Btn } from '@/ui/kit/Btn';
import { Row } from '@/ui/kit/Row';
import { TipLayer } from '@/ui/next/TipLayer';
import { lootText } from '@/ui/parts/reportWords';
import type { Report } from '@/world/types';
import type { SiegeRecord } from '@/world/siegerecord';
import { MACHINE_NAME } from '@/world/machines';
import type { Episode, SiegeReel } from '@/render/siege/reel';
import type { SiegePlayer } from '@/render/siege/player';
import { freeTurn } from '@/orientation';
import { END_WORDS, captionOf, showOfSiege, type SiegeClip } from './siege';
import { townShare } from './townShare';
import './tw.css';

const NEXT = { id: 'next', label: SKIP.label } as const;
const RESULT = { id: 'result', label: 'Итог' } as const;
const DIRECTOR = { id: 'director', label: 'Камера ролика' } as const;
const SPEEDS = [1, 2, 4] as const;
const AGAIN = { id: 'again', label: 'Смотреть снова' } as const;
const TO_REPORT = { id: 'report', label: 'К донесению' } as const;
const SIDES_STYLE = SIDE_VARS as CSSProperties;

/** Музыка эпизода: бой и пролом — во весь голос, стройка и починка — барабаны, ожидание — тише. */
const MUSIC: Record<Episode['kind'], 'drums' | 'harmony' | 'full'> = {
  pitch: 'harmony',
  fire: 'full',
  machines: 'drums',
  repair: 'drums',
  breach: 'full',
  volley: 'full',
  plague: 'harmony',
  short: 'harmony',
  sortie: 'full',
  relief: 'full',
  assault: 'full',
  gates: 'harmony',
  terms: 'harmony',
  hunger: 'harmony',
  storm: 'full',
  broken: 'full',
  wasted: 'harmony',
  paid: 'harmony',
  ransom: 'harmony',
  left: 'harmony',
  fate: 'full',
};

export interface SiegeReplayProps {
  rec: SiegeRecord;
  report?: Report;
  /** Короткий ролик эпизода; нет — вся осада. */
  clip?: SiegeClip | null;
  onDone: () => void;
  /** Стенд: кадр стоит на этой секунде ролика, ход не идёт. В игре — нет. */
  freeze?: number | null;
  /** Стенд: сразу карточка итога. */
  ended?: boolean;
}

export function SiegeReplay({ rec, report, clip = null, onDone, freeze = null, ended: endedAtStart = false }: SiegeReplayProps) {
  const show = useMemo(() => showOfSiege(rec, report), [rec, report]);
  const [ep, setEp] = useState<Episode | null>(null);
  const [breaches, setBreaches] = useState(0);
  const [loaded, setLoaded] = useState<'wait' | 'ok' | 'fail'>('wait');
  const [rate, setRate] = useState<number>(1);
  const [ended, setEnded] = useState(false);
  const [taken, setTaken] = useState(false);
  const done = useRef(onDone);
  done.current = onDone;
  const layer = useRef<HTMLDivElement>(null);
  const player = useRef<SiegePlayer | null>(null);
  const shown = useRef('');

  useEffect(() => freeTurn('ролик осады'), []);

  useEffect(() => {
    const scene = activeScene();
    document.body.classList.add('replaying');
    let own: THREE.WebGLRenderer | null = null;
    let ownWrap: HTMLDivElement | null = null;
    let renderer: THREE.WebGLRenderer;
    if (scene) renderer = scene.lend(true);
    else {
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
    void import('@/render/siege/play')
      .then(async (m) => {
        if (!alive || !layer.current) return;
        // Уровень — тот же, что у города и ролика боя (`gfx.levelNow`); по устройству его сторожит и сам ролик.
        const quality = levelNow(location.search);
        const asked = sceneGfx(gfx(), location.search).asked;
        const pick = clip ? (reel: SiegeReel): Episode | null => reel.episodes.find((e) => e.kind === clip.kind && e.k === clip.k) ?? null : undefined;
        // За стеной — город игры (П-6): тот же план, текстуры и земля, что в окне города; ролик ждёт его сборки.
        const p = await m.playSiege(renderer, show, quality, layer.current, {
          share: townShare(scene),
          ...(asked ? {} : { watch: quality }),
          ...(pick ? { clip: pick } : {}),
          onLower: (q) => {
            if (!scene) return;
            scene.lowerTo(q);
            scene.resize();
            player.current?.fit();
          },
          onFrame: (t, e) => {
            const pl = player.current;
            const b = pl ? m.breachesAt(pl.reel, t) : 0;
            battleMusic.set(MUSIC[e.kind]);
            const key = `${e.kind}|${e.k}|${b}`;
            if (key === shown.current) return;
            shown.current = key;
            setEp(e);
            setBreaches(b);
          },
          onEnd: () => setEnded(true),
        });
        // Пока город собирался, ролик могли закрыть.
        if (!alive) {
          p.dispose();
          return;
        }
        player.current = p;
        p.cam.onTake = () => setTaken(true);
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
        console.error('ролик осады:', e);
        if (alive) setLoaded('fail');
      });
    return () => {
      alive = false;
      player.current = null;
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
  }, [show, clip, freeze, endedAtStart]);

  const pick = (id: string): void => {
    const p = player.current;
    if (id === 'next') {
      if (p?.skipNext()) return;
      p?.finish();
      setEnded(true);
    } else if (id === 'result') {
      p?.finish();
      setEnded(true);
    } else if (id === 'report') done.current();
    else if (id === 'director') {
      p?.cam.release();
      setTaken(false);
    } else if (id === 'again') {
      setEnded(false);
      p?.seek(p.from);
      p?.start();
    }
  };
  const go = (n: number): void => {
    setRate(n);
    if (player.current) player.current.speed = n;
  };

  const k = ep?.k ?? 0;
  const walls = show.wall > 0;
  return createPortal(
    <div className="replay replay-tw replay-siege" ref={layer} style={SIDES_STYLE}>
      <div className="tw-top">
        <div className="tw-bar">
          <div className="tw-side">
            <span className="tw-name">{show.us === 'atk' ? 'Наш лагерь' : 'Наш город'}</span>
          </div>
          <div className="tw-phase">
            <b>{k > 0 ? `Фаза ${k}` : 'Осада'}</b>
            {walls && (
              <small className="siege-breach" title="Проломов в стене — по журналу фаз">
                {'▮'.repeat(breaches)}
                {'▯'.repeat(Math.max(0, 3 - breaches))} пролом{breaches === 1 ? '' : breaches > 1 && breaches < 5 ? 'а' : 'ов'}
              </small>
            )}
          </div>
          <div className="tw-side them">
            <span className="tw-name">{show.us === 'atk' ? 'Город' : 'Лагерь'}</span>
          </div>
        </div>
        <div className="tw-speed">
          {SPEEDS.map((n) => (
            <Btn key={n} kind={rate === n ? 'main' : 'plain'} onClick={() => go(n)}>
              ×{n}
            </Btn>
          ))}
        </div>
      </div>
      {loaded === 'fail' && <div className="replay-caption">Ролик не открылся. Итог осады — в донесении.</div>}
      {loaded !== 'fail' && !ended && ep && <div className="replay-caption">{captionOf(rec, ep, report)}</div>}
      {ended && <SiegeCard rec={rec} report={report} onPick={pick} />}
      {!ended && (
        <div className="tw-foot">
          <div className="replay-controls">
            {[NEXT, RESULT].map((c) => (
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
 * Карточка итога осады: чем кончилась, сколько фаз, проломов и какие машины — из записи осады теми же дверями, что ролик;
 * добыча и уведённые — донесение (`lootText`).
 */
function SiegeCard({ rec, report, onPick }: { rec: SiegeRecord; report?: Report; onPick: (id: string) => void }) {
  const show = showOfSiege(rec, report);
  const built = show.machines.filter((m) => m.ready !== null);
  const loot = report ? lootText(report.loot) : '';
  return (
    <div className="tw-card">
      <h3>{END_WORDS[rec.end.how]}</h3>
      {report && <p className="note">{report.text}</p>}
      <div className="tw-card-rows">
        <Row label="Фаз осады" value={show.phases.length} />
        {show.wall > 0 && <Row label="Проломов к концу" value={`${show.end.breaches} из 3`} />}
        {built.length > 0 && (
          <Row
            label="Машины"
            value={built
              .map((m) => `${MACHINE_NAME[m.id].toLowerCase()}${m.burned !== null ? ' (сожгли)' : m.spent ? ' (на штурм)' : ''}`)
              .join(', ')}
          />
        )}
        {loot && <Row label={report?.won ? 'Добыча' : 'Унесли'} value={loot} />}
        {report?.led !== undefined && report.led > 0 && <Row label={report.won ? 'Увели невольниками' : 'Увели наших'} value={report.led} />}
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
