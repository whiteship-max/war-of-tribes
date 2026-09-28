// Отчёт о бое. Строится из журнала, а не из чисел рядом: событие, которого нет
// в журнале, сюда не попадёт. Две кнопки — мгновенный итог и просмотр; выбор
// запоминается, а при несопоставимых силах мгновенный подставляется сам.
//
// «Смотреть бой» открывает ролик — проигрыватель того же журнала. Он всегда
// доступен повторно: раз кадры выводятся из журнала, повтор ничего не стоит и
// обязан совпасть с первым показом до кадра. Журнал по фазам остаётся под
// кнопками: ролик показывает, текст объясняет.
import { useEffect, useMemo, useState, type ComponentType } from 'react';
import { createPortal } from 'react-dom';
import { useGame } from '@/game/store';
import { useWorld } from '@/world/store';
import {
  PHASE_NAME,
  describeEvent,
  summarize,
  type Side,
} from '@/battle';
import { setBattleWatch } from '@/game/battle/actions';
import { battleMusic } from '@/sound/web';
import { RESOURCE_IDS, RESOURCE_META } from '@/game/constants';
import { fallenText } from '@/game/sim/expedition';
import { UNITS } from '@/world/data/units';
import { formatCoord } from '@/world/geo';
import type { BattleRecord, Loot, Report, UnitStack } from '@/world/types';
import { Icon } from '@/ui/icons/Icon';

/** Силы несопоставимы — смотреть нечего: мгновенный итог по умолчанию. */
export const LOPSIDED = 3;

const unitsText = (units: UnitStack): string =>
  UNITS.filter((u) => (units[u.id] ?? 0) > 0)
    .map((u) => `${u.icon} ${units[u.id]}`)
    .join(' · ') || '—';

const lootText = (loot: Loot | null): string => {
  if (!loot) return '';
  const parts = RESOURCE_IDS.filter((r) => loot[r]).map(
    (r) => `${RESOURCE_META[r].icon} ${Math.abs(loot[r] as number)}`,
  );
  if (loot.gold) parts.push(`💰 ${Math.abs(loot.gold)}`);
  return parts.join(' · ');
};

/** Насколько силы были несопоставимы: отношение большей стороны к меньшей. */
export function lopsidedness(rec: BattleRecord): number {
  const a = rec.result.sides.attacker.total.initial;
  const d = rec.result.sides.defender.total.initial;
  const lo = Math.max(1, Math.min(a, d));
  return Math.max(a, d) / lo;
}

const other = (side: Side): Side => (side === 'attacker' ? 'defender' : 'attacker');

type ReplayProps = { rec: BattleRecord; onDone: () => void };

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
 * нажатия (`battleMusic.arm()`), а `import()` жест теряет.
 *
 * Не `lazy`, а своя загрузка — потому что кусок может не приехать: игра работает без
 * сети, и бой без сети случается. Упавший `lazy` без границы ошибок уронил бы всё
 * приложение; здесь он честно говорит, что ролика нет, а отчёт под ним остаётся.
 */
const loadReplay = () => import('@/ui/battle/BattleReplay');

function Replay({ rec, onDone }: ReplayProps) {
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
    return <Play rec={rec} onDone={onDone} />;
  }
  return createPortal(
    <div className="replay">
      <div className="replay-caption">
        {play === 'wait' ? 'Ролик загружается…' : 'Ролик не загрузился — нет связи. Итог и журнал остались в отчёте.'}
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
    <div className="bl">
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
                <div className={`bl-line${'side' in e && e.side === rec.us ? ' mine' : ''}`} key={i}>
                  {describeEvent(e, rec.us)}
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

  // Отчёт открывают и мимо списка походов — из тоста или после перезагрузки.
  // Тогда список ещё пуст, и без этого панель врала бы «отчёт не хранится».
  useEffect(() => {
    if (reports.length === 0) void loadReports();
  }, [reports.length, loadReports]);
  const rec = report?.battle ?? null;
  // Звери у ворот (`BattleRecord.beasts`): ролику рисовать их нечем — фигуры волка в сцене боя нет (долг графики,
  // docs/PROMISES_DEBT.md), — поэтому ни «Смотреть бой», ни выбора итога; журнал показан сразу.
  const beasts = rec?.beasts !== undefined;
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
        <h2>Отчёт</h2>
        <div className="desc">
          {reports.length === 0 ? 'Открываем отчёт…' : 'Этот отчёт уже не хранится: место заняли новые.'}
        </div>
      </div>
    );
  }

  return (
    <div className="panel">
      <ReportBody report={report} />
      {rec && beasts && (
        <>
          <p className="note">
            Ролика нет: фигуры волка в сцене боя пока нет. Стая бьётся родом лёгкой конницы — в журнале она названа
            конницей.
          </p>
          <h3>Как это было</h3>
          <Journal rec={rec} />
        </>
      )}
      {rec && !beasts && (
        <>
          <div className="wm-actions">
            <button
              className={`btn${watch ? ' ghost' : ''}`}
              onClick={() => {
                setWatch(false);
                act((g) => setBattleWatch(g, false));
              }}
            >
              <Icon name="ui-bolt" glyph="⚡" /> Мгновенный итог
            </button>
            <button
              className={`btn${watch ? '' : ' ghost'}`}
              onClick={() => {
                // Единственный жест, на котором звук вообще может открыться:
                // в вебвью Telegram он сам не заиграет, а другого нажатия перед
                // роликом нет. Открыть контекст надо прямо здесь, в обработчике.
                battleMusic.arm();
                setWatch(true);
                act((g) => setBattleWatch(g, true));
                setPlaying(true);
              }}
            >
              ▶️ Смотреть бой
            </button>
          </div>
          {playing && (
            <Replay key={report.id} rec={rec} onDone={() => setPlaying(false)} />
          )}
          {lopsided && !watch && (
            <p className="note">
              Силы были несопоставимы — смотреть тут нечего, поэтому сразу итог. Журнал никуда не делся.
            </p>
          )}
          {watch && (
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

/** Итог словами: три категории исхода, потери обеих сторон, ключевые события. */
export function ReportBody({ report }: { report: Report }) {
  const s = useGame((g) => g.s);
  const rec = report.battle;
  const sum = rec ? summarize(rec.result, rec.us) : null;
  const ours = rec ? rec.result.sides[rec.us].total : null;
  const foes = rec ? rec.result.sides[other(rec.us)].total : null;

  return (
    <>
      <h2>
        {sum ? sum.title : report.title} <small>{formatCoord(report.target)}</small>
      </h2>
      {/* Где это было — именем. У своего города это имя, которое назвал игрок. */}
      <div className="desc one-line">{report.target.name}</div>
      <div className="desc">{report.text}</div>

      {sum && ours && foes && (
        <>
          <div className="mod-list">
            <div className="mod">
              <span className="ico">🛡️</span>
              <span className="name">Наши силы</span>
              <span className="val">
                {ours.initial} → {ours.final}
              </span>
            </div>
            <div className="mod">
              <span className="ico">⚔️</span>
              <span className="name">Противник</span>
              <span className="val">
                {foes.initial} → {foes.final}
              </span>
            </div>
            <div className="mod total">
              <span className="ico">⚖️</span>
              <span className="name">Размен</span>
              <span className={`val ${foes.losses >= ours.losses ? '' : 'neg'}`}>
                {ours.losses} за {foes.losses}
              </span>
            </div>
          </div>
          <p className={`note${sum.verdict === 'defeat' || sum.verdict === 'pyrrhic' ? ' bad' : ''}`}>
            {sum.reason}
          </p>

          <h3>Почему так вышло</h3>
          <div className="bl">
            {sum.keys.length === 0 ? (
              <div className="bl-line muted">Ничего решающего не случилось — перемололи друг друга.</div>
            ) : (
              sum.keys.map((k, i) => (
                <div className={`bl-line${k.good ? ' mine' : ' foe'}`} key={i}>
                  <Icon name={k.art} glyph={k.icon} /> {k.text}
                </div>
              ))
            )}
          </div>
        </>
      )}

      <div className="mod-list">
        <div className="mod">
          <span className="ico">👣</span>
          <span className="name">Ушли</span>
          <span className="val">{unitsText(report.sent)}</span>
        </div>
        {/*
          Бой у рогаток лагеря: сколько из вышедших вообще дрались. Без этой
          строки проигрыш сотни против пятерых читался бы как несправедливый —
          а дрались в нём трое. Число записал мир в минуту боя, тем же расчётом,
          которым панель вылазки обещала его до нажатия.
        */}
        {/* Сторон у лагеря две, и строк по сторонам — столько, сколько с них лезли. */}
        {report.rearThrough && (report.rearThrough.passed < report.rearThrough.went || (report.through && report.through.passed < report.through.went)) && (
          <div className="mod">
            <span className="ico">⛺</span>
            <span className="name">Пробились с тыла, бойцов строя</span>
            <span className="val">
              {report.rearThrough.passed} из {report.rearThrough.went}
            </span>
          </div>
        )}
        {report.through && (report.through.passed < report.through.went || (report.rearThrough && report.rearThrough.passed < report.rearThrough.went)) && (
          <div className="mod">
            <span className="ico">⛺</span>
            <span className="name">Пробились {report.rearThrough ? 'со стороны города' : 'к рогаткам'}, бойцов строя</span>
            <span className="val">
              {report.through.passed} из {report.through.went}
            </span>
          </div>
        )}
        <div className="mod">
          <span className="ico"><Icon name="ui-grave" glyph="🪦" /></span>
          <span className="name">Не вернулись</span>
          <span className="val">{Object.keys(report.lost).length > 0 ? unitsText(report.lost) : 'нет'}</span>
        </div>
        {(report.hidden ?? 0) > 0 && (
          <div className="mod">
            <span className="ico">🧰</span>
            <span className="name">Уцелело в тайнике</span>
            <span className="val">{report.hidden}</span>
          </div>
        )}
        {report.loot && (
          <div className="mod total">
            <span className="ico"><Icon name="ui-loot" glyph="📦" /></span>
            <span className="name">Добыча</span>
            <span className="val">{lootText(report.loot)}</span>
          </div>
        )}
        {/*
          Город взят: какие постройки потеряли уровень, поимённо. Строка та же,
          что легла в летопись, и из того же списка, который применило племя.
        */}
        {report.fallen && report.fallen.length > 0 && (
          <div className="mod">
            <span className="ico">🏚️</span>
            <span className="name">Постройки</span>
            <span className="val">{fallenText(s, report.fallen)}</span>
          </div>
        )}
      </div>
    </>
  );
}
