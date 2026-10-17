// Отчёт о бое. Строится из журнала, а не из чисел рядом: событие, которого нет
// в журнале, сюда не попадёт. Две кнопки — мгновенный итог и просмотр; выбор
// запоминается, а при несопоставимых силах мгновенный подставляется сам.
//
// «Смотреть бой» открывает ролик — проигрыватель того же журнала. Он всегда
// доступен повторно: раз кадры выводятся из журнала, повтор ничего не стоит и
// обязан совпасть с первым показом до кадра. Журнал по фазам остаётся под
// кнопками: ролик показывает, текст объясняет.
import { Suspense, lazy, useEffect, useMemo, useState, type CSSProperties, type ComponentType } from 'react';
import { createPortal } from 'react-dom';
import { useGame } from '@/game/store';
import { useWorld } from '@/world/store';
import { PHASE_NAME, describeEvent, type Side } from '@/battle';
import { setBattleWatch } from '@/game/battle/actions';
import { beastWords } from '@/game/battle/beasts';
import { battleMusicDoor } from '@/sound/door';
import type { BattleRecord, Report } from '@/world/types';
import { Icon } from '@/ui/icons/Icon';
import { SIDE_VARS } from '@/side';
import type { SiegeRecord } from '@/world/siegerecord';
import type { SiegeClip } from '@/ui/battle/siege';

/** Итог — в куске нового интерфейса (`ui/next/ReportNew`), как окно постройки: первая загрузка его не несёт. */
const ReportBodyNew = lazy(() => import('@/ui/next').then((m) => ({ default: m.ReportBodyNew })));

/** Силы несопоставимы — смотреть нечего: мгновенный итог по умолчанию. */
export const LOPSIDED = 3;


/** Насколько силы были несопоставимы: отношение большей стороны к меньшей. */
export function lopsidedness(rec: BattleRecord): number {
  const a = rec.result.sides.attacker.total.initial;
  const d = rec.result.sides.defender.total.initial;
  const lo = Math.max(1, Math.min(a, d));
  return Math.max(a, d) / lo;
}

const other = (side: Side): Side => (side === 'attacker' ? 'defender' : 'attacker');

/** Журнал боя метит строки цветом стороны: наши — золотом, чужие — красным (одна дверь, `side.ts`; `.bl-line`). */
const SIDES_STYLE = SIDE_VARS as CSSProperties;

type ReplayProps = { rec: BattleRecord; report?: Report; onDone: () => void };

/**
 * Ролик о бое едет отдельным куском и только по «Смотреть бой».
 *
 * По умолчанию его не смотрит никто (`battleWatch` выключен), а весил он в чанке
 * игры около тринадцати килобайт: проигрыватель журнала, сцена поля, строй, стрелы.
 * Режим, в который игрок может не зайти ни разу, не имеет права стоить ему ни байта
 * на старте — то же правило, что у предыстории (`App.tsx`). Держит это приёмка
 * сборки (`scripts/build.mjs`): куска ролика нет или его имена грузятся сразу —
 * сборка падает.
 *
 * Музыка боя сюда не переезжает: её контекст открывается прямо в обработчике
 * нажатия (`battleMusicDoor.arm()`, дверь звука из первой загрузки), а `import()` жест
 * теряет; сам движок с музыкой — докачкой после нажатия (П-3).
 *
 * Не `lazy`, а своя загрузка — потому что кусок может не приехать: игра работает без
 * сети, и бой без сети случается. Упавший `lazy` без границы ошибок уронил бы всё
 * приложение; здесь он честно говорит, что ролика нет, а отчёт под ним остаётся.
 */
const loadReplay = () => import('@/ui/battle/BattleReplay');

function Replay({ rec, report, onDone }: ReplayProps) {
  const [play, setPlay] = useState<ComponentType<ReplayProps> | 'wait' | 'lost'>('wait');
  useEffect(() => {
    let live = true;
    loadReplay().then(
      (m) => live && setPlay(() => m.BattleReplay),
      () => live && setPlay('lost'),
    );
    return () => {
      live = false;
    };
  }, []);
  if (typeof play !== 'string') {
    const Play = play;
    return <Play rec={rec} report={report} onDone={onDone} />;
  }
  return createPortal(
    <div className="replay">
      <div className="replay-caption">
        {play === 'wait' ? 'Ролик открывается…' : 'Нет связи, ролик не открылся. Итог и журнал боя на месте.'}
      </div>
      <div className="replay-controls">
        <button className="btn" onClick={onDone}>
          {play === 'wait' ? 'Пропустить' : 'Закрыть'}
        </button>
      </div>
    </div>,
    document.body,
  );
}

type SiegeProps = { rec: SiegeRecord; report: Report; clip: SiegeClip | null; onDone: () => void };

/**
 * Ролик осады (docs/gfx.md, ГФ-2) — своим ленивым куском по «Смотреть осаду» и ролику эпизода, как ролик боя: в первую
 * загрузку не едет, не приехал — говорит это, а донесение под ним остаётся.
 */
function SiegeWatch({ rec, report, clip, onDone }: SiegeProps) {
  const [play, setPlay] = useState<ComponentType<SiegeProps> | 'wait' | 'lost'>('wait');
  useEffect(() => {
    let live = true;
    import('@/ui/battle/SiegeReplay').then(
      (m) => live && setPlay(() => m.SiegeReplay as ComponentType<SiegeProps>),
      () => live && setPlay('lost'),
    );
    return () => {
      live = false;
    };
  }, []);
  if (typeof play !== 'string') {
    const Play = play;
    return <Play rec={rec} report={report} clip={clip} onDone={onDone} />;
  }
  return createPortal(
    <div className="replay">
      <div className="replay-caption">{play === 'wait' ? 'Ролик открывается…' : 'Нет связи, ролик не открылся. Донесение на месте.'}</div>
      <div className="replay-controls">
        <button className="btn" onClick={onDone}>
          {play === 'wait' ? 'Пропустить' : 'Закрыть'}
        </button>
      </div>
    </div>,
    document.body,
  );
}

/** Кнопки ролика осады: вся осада и короткие ролики её эпизодов (пролом, бой, развязка). */
function SiegeButtons({ report }: { report: Report & { siege: SiegeRecord } }) {
  // Короткие ролики считает перевод записи (`ui/battle/siege.ts`) дверями мира и землёй боя — он едет своим куском, как
  // ролик: в первую загрузку ни земля боя, ни вход сцены осады не попадают. Не приехал — есть кнопка всей осады.
  const [clips, setClips] = useState<SiegeClip[]>([]);
  useEffect(() => {
    let live = true;
    import('@/ui/battle/siege').then(
      (m) => live && setClips(m.clipsOfSiege(report.siege)),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [report.siege]);
  const [playing, setPlaying] = useState<SiegeClip | 'all' | null>(null);
  return (
    <>
      <div className="nx-rbtns">
        <button
          className="btn"
          onClick={() => {
            battleMusicDoor.arm();
            setPlaying('all');
          }}
        >
          ▶️ Смотреть осаду
        </button>
      </div>
      {clips.length > 1 && (
        <div className="nx-rbtns siege-clips">
          {clips.map((c) => (
            <button
              className="btn ghost"
              key={`${c.kind}:${c.k}`}
              onClick={() => {
                battleMusicDoor.arm();
                setPlaying(c);
              }}
            >
              ▶ {c.label}
            </button>
          ))}
        </div>
      )}
      {playing && <SiegeWatch key={typeof playing === 'string' ? playing : `${playing.kind}:${playing.k}`} rec={report.siege} report={report} clip={playing === 'all' ? null : playing} onDone={() => setPlaying(null)} />}
    </>
  );
}

/**
 * Журнал по фазам: заголовок фазы, под ним её события. Фаза встречается в бою не один раз — сеча
 * идёт кругами (`PhaseSpan.round`), — поэтому событие ложится в ту фазу, в чьи тики попало, а не
 * в первую с тем же именем.
 */
function Journal({ rec }: { rec: BattleRecord }) {
  const bySpan = useMemo(
    () =>
      rec.result.phases.map((span) =>
        rec.result.log.filter((e) => e.id !== 'phase-start' && e.phase === span.phase && e.tick >= span.from && e.tick <= span.to),
      ),
    [rec],
  );

  return (
    <div className="bl" style={SIDES_STYLE}>
      {rec.result.phases.map((span, i) => {
        const events = bySpan[i];
        const ours = Math.round(span.losses[rec.us]);
        const theirs = Math.round(span.losses[other(rec.us)]);
        return (
          <div className="bl-phase" key={`${span.phase}:${span.round ?? 1}`}>
            <div className="bl-head">
              <b>
                {PHASE_NAME[span.phase]}
                {span.round ? `, круг ${span.round}` : ''}
              </b>
              <span className="bl-cost">
                мы −{ours} · они −{theirs}
              </span>
            </div>
            {events.length === 0 ? (
              <div className="bl-line muted">без событий</div>
            ) : (
              events.map((e, i) => (
                <div className={`bl-line${'side' in e ? (e.side === rec.us ? ' mine' : ' foe') : ''}`} key={i}>
                  {beastWords(describeEvent(e, rec.us), rec.beasts, rec.us)}
                </div>
              ))
            )}
          </div>
        );
      })}
    </div>
  );
}

export function ReportPanel({ id }: { id: string }) {
  const reports = useWorld((g) => g.reports);
  const loadReports = useWorld((g) => g.loadReports);
  const s = useGame((g) => g.s);
  const act = useGame((g) => g.act);
  const report = reports.find((r) => r.id === id) ?? null;
  // Итог — `ReportBodyNew` (свой кусок); ролик, журнал и выбор «итог или бой» — здесь.

  // Отчёт открывают и мимо списка походов — из тоста или после перезагрузки.
  // Тогда список ещё пуст, и без этого панель врала бы «отчёт не хранится».
  useEffect(() => {
    if (reports.length === 0) void loadReports();
  }, [reports.length, loadReports]);
  // Звери у ворот (`BattleRecord.beasts`) идут той же веткой, что люди, — с роликом: фигура волка в сцене боя есть
  // всегда (сцена ролика одна — нынешняя, docs/city.md, «Город — единственный вид»).
  const rec = report?.battle ?? null;
  // Несопоставимые силы — смотреть нечего, подставляем итог, что бы ни выбрали раньше.
  const lopsided = rec ? lopsidedness(rec) >= LOPSIDED : false;
  const [watch, setWatch] = useState(() => Boolean(s.battleWatch) && !lopsided);
  // Ролик идёт поверх всего экрана, поэтому его состояние местное: снаружи на
  // него ничего не ведёт, а отчёт под ним никуда не девается — «Пропустить»
  // возвращает ровно в него.
  const [playing, setPlaying] = useState(false);

  if (!report) {
    return (
      <div className="panel">
        <h2>Донесение</h2>
        <div className="desc">
          {reports.length === 0 ? 'Открываем донесение…' : 'Донесение не сохранилось.'}
        </div>
      </div>
    );
  }

  return (
    <div className="panel">
      <Suspense fallback={null}>
        <ReportBodyNew report={report} />
      </Suspense>
      {report.siege && <SiegeButtons report={report as Report & { siege: SiegeRecord }} />}
      {rec && (
        <>
          <div className="nx-rbtns">
            <button
              className={`btn${watch ? ' ghost' : ''}`}
              onClick={() => {
                setWatch(false);
                act((g) => setBattleWatch(g, false));
              }}
            >
              <Icon name="ui-bolt" glyph="⚡" /> Сразу итог
            </button>
            <button
              className={`btn${watch ? '' : ' ghost'}`}
              onClick={() => {
                // Единственный жест, на котором звук вообще может открыться:
                // в вебвью Telegram он сам не заиграет, а другого нажатия перед
                // роликом нет. Открыть контекст надо прямо здесь, в обработчике.
                battleMusicDoor.arm();
                setWatch(true);
                act((g) => setBattleWatch(g, true));
                setPlaying(true);
              }}
            >
              ▶️ Смотреть бой
            </button>
          </div>
          {playing && (
            <Replay key={report.id} rec={rec} report={report} onDone={() => setPlaying(false)} />
          )}
          {lopsided && !watch && (
            <p className="note">
              Силы были несопоставимы, смотреть нечего. Журнал ниже.
            </p>
          )}
          {/* Журнал — при «Смотреть бой» и при несопоставимых силах: тогда смотреть нечего, и строка выше обещает журнал ниже
              (находка О7: прежде при «Сразу итог» обещание было, а журнала не было; UI-7, docs/ui_v2.md, 5.6). */}
          {(watch || lopsided) && (
            <>
              <h3>Как это было</h3>
              <Journal rec={rec} />
            </>
          )}
        </>
      )}
    </div>
  );
}
