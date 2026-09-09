// Отчёт о бое. Строится из журнала, а не из чисел рядом: событие, которого нет
// в журнале, сюда не попадёт. Две кнопки — мгновенный итог и просмотр; выбор
// запоминается, а при несопоставимых силах мгновенный подставляется сам.
//
// «Смотреть бой» открывает ролик — проигрыватель того же журнала. Он всегда
// доступен повторно: раз кадры выводятся из журнала, повтор ничего не стоит и
// обязан совпасть с первым показом до кадра. Журнал по фазам остаётся под
// кнопками: ролик показывает, текст объясняет.
import { useEffect, useMemo, useState } from 'react';
import { useGame } from '@/game/store';
import { useWorld } from '@/world/store';
import {
  PHASE_NAME,
  describeEvent,
  summarize,
  type BattleEvent,
  type PhaseId,
  type Side,
} from '@/battle';
import { setBattleWatch } from '@/game/battle/actions';
import { BattleReplay } from '@/ui/battle/BattleReplay';
import { battleMusic } from '@/sound/web';
import { RESOURCE_IDS, RESOURCE_META } from '@/game/constants';
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

/** Журнал по фазам: заголовок фазы, под ним её события. */
function Journal({ rec }: { rec: BattleRecord }) {
  const byPhase = useMemo(() => {
    const map = new Map<PhaseId, BattleEvent[]>();
    for (const e of rec.result.log) {
      if (e.id === 'phase-start') continue;
      const list = map.get(e.phase) ?? [];
      list.push(e);
      map.set(e.phase, list);
    }
    return map;
  }, [rec]);

  return (
    <div className="bl">
      {rec.result.phases.map((span) => {
        const events = byPhase.get(span.phase) ?? [];
        const ours = Math.round(span.losses[rec.us]);
        const theirs = Math.round(span.losses[other(rec.us)]);
        return (
          <div className="bl-phase" key={span.phase}>
            <div className="bl-head">
              <b>{PHASE_NAME[span.phase]}</b>
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
      {rec && (
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
            <BattleReplay key={report.id} rec={rec} onDone={() => setPlaying(false)} />
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
  const rec = report.battle;
  const sum = rec ? summarize(rec.result, rec.us) : null;
  const ours = rec ? rec.result.sides[rec.us].total : null;
  const foes = rec ? rec.result.sides[other(rec.us)].total : null;

  return (
    <>
      <h2>
        {sum ? sum.title : report.title} <small>{formatCoord(report.target)}</small>
      </h2>
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
      </div>
    </>
  );
}
