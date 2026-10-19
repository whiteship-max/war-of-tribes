// Летопись — вкладка «Вестей» (ВС-2, docs/ui_v2.md, 5.8). «Вести» — единое место отчётности: что ждёт ответа — вкладками
// почты, что уже было — здесь, по дням, с фильтром по роду. Событие с донесением — строка-дверь целиком (`kit/Table`):
// касание открывает донесение тут же, в «Вестях», а из него — ролик боя или осады.
//
// Прежде летопись жила в «Заданиях» ступенями «сутки — неделя — месяц» и строки её не открывались ничем: бой был виден,
// а донесение о нём искали в «Походах» на карте.
import { useEffect, useState } from 'react';
import { useGame } from '@/game/store';
import { useWorld } from '@/world/store';
import { dayOf, seasonOf, yearOf } from '@/game/derived';
import { SEASON_META } from '@/game/data/seasons';
import { Icon } from '@/ui/icons/Icon';
import { Table, type Col, type TableRow } from '@/ui/kit/Table';
import { count } from '@/ui/parts/plural';
import { byDay, chronEvents, TOPIC_BY_ID, TOPICS, type ChronEvent, type ChronTopic } from './annals';
import { useRealm } from './open';

/** Дней видно сразу; остальные — «Ещё». Летопись хранит месяц (`sim/log.LOG_MAX_DAYS`), а заходят прочесть вчерашнее. */
export const DAYS_SHOWN = 3;

/** Отметка дня — как в книге летописца: «Год 3, лето · день 121». Сезон и год — из времени записи, своего счёта нет. */
const dateWords = (at: number): string => `Год ${yearOf(at)}, ${SEASON_META[seasonOf(at)].name.toLowerCase()} · день ${dayOf(at)}`;

/** «сегодня», «вчера», «3 дня назад» — возраст словами. */
function ago(days: number): string {
  if (days <= 0) return 'сегодня';
  if (days === 1) return 'вчера';
  return `${count(days, 'день', 'дня', 'дней')} назад`;
}

/** Итог события с донесением: бой — победа или поражение, без боя (разведка, сделка) — просто «Донесение». */
function outcome(ev: ChronEvent): { text: string; tone: string } | null {
  const r = ev.report;
  if (!r) return null;
  if (r.battle || r.enemyPower !== null || r.siege) return r.won ? { text: 'Победа', tone: 'good' } : { text: 'Поражение', tone: 'bad' };
  return { text: 'Донесение', tone: 'muted' };
}

export function Chronicle() {
  const s = useGame((g) => g.s);
  const reports = useWorld((w) => w.reports);
  const loadReports = useWorld((w) => w.loadReports);
  const openChronicle = useRealm((r) => r.openChronicle);
  const asked = useRealm((r) => r.chronTopic);
  const [topic, setTopic] = useState<ChronTopic | 'all'>(() => asked ?? 'all');
  // Летопись открыли на роде (доклад советника, Г-10): встать на нём, даже если она уже открыта, — и погасить просьбу.
  useEffect(() => {
    if (!asked) return;
    setTopic(asked);
    useRealm.setState({ chronTopic: null });
  }, [asked]);
  const [all, setAll] = useState(false);

  // Донесения — свежие на каждый заход: бой мог кончиться, пока «Вести» были закрыты.
  useEffect(() => {
    void loadReports();
  }, [loadReports]);

  const events = chronEvents(s.log, reports);
  const present = TOPICS.filter((t) => events.some((e) => e.topic === t.id));
  const shown = topic === 'all' ? events : events.filter((e) => e.topic === topic);
  const days = byDay(shown, dayOf);
  const visible = all ? days : days.slice(0, DAYS_SHOWN);
  const hidden = days.slice(DAYS_SHOWN).reduce((n, d) => n + d.items.length, 0);
  const today = dayOf(s.time);

  return (
    <div className="chron">
      {/* Фильтр — только роды, что в летописи есть: пустой фильтр — кнопка в никуда. */}
      {present.length > 1 && (
        <div className="chron-chips" role="group" aria-label="Род событий">
          {[{ id: 'all' as const, label: 'Все' }, ...present].map((t) => (
            <button
              key={t.id}
              type="button"
              className={`chron-chip${topic === t.id ? ' on' : ''}`}
              aria-pressed={topic === t.id}
              onClick={() => {
                setTopic(t.id);
                setAll(false);
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}
      {days.length === 0 && (
        <p className="note">{topic === 'all' ? 'Летопись пуста.' : `${TOPIC_BY_ID[topic].label}: за месяц ничего.`}</p>
      )}
      {visible.map((d) => (
        <section key={d.day} className="chron-day">
          <Table
            label={dateWords(d.at)}
            cols={dayCols(dateWords(d.at), ago(today - d.day))}
            rows={chronRows(d.items, openChronicle)}
          />
        </section>
      ))}
      {days.length > DAYS_SHOWN && (
        <button type="button" className="nx-mback chron-more" onClick={() => setAll(!all)}>
          {all ? 'Свернуть' : `Ещё ${count(hidden, 'событие', 'события', 'событий')}`}
        </button>
      )}
      {/* Дальше месяца летопись не хранит (`LOG_MAX_DAYS`, sim/log.ts) — сказано словами, а не молчанием. */}
      <p className="note">Летопись хранит месяц.</p>
    </div>
  );
}

/** Столбцы дня: шапка таблицы — сама отметка дня, справа — возраст; ниже — событие и его итог. */
const dayCols = (date: string, age: string): readonly Col[] => [
  { key: 'what', title: date },
  { key: 'res', title: age, align: 'right', w: '80px' },
];

/**
 * Строки дня: событие со значком рода, строки того же последствия под ним, итог справа. Событие с донесением — строка-дверь
 * целиком: касание открывает донесение в «Вестях» (`open` — `useRealm.openChronicle`).
 */
export function chronRows(items: readonly ChronEvent[], open: (report: string) => void): TableRow[] {
  return items.map((ev) => {
    const r = ev.report;
    const res = outcome(ev);
    const t = TOPIC_BY_ID[ev.topic];
    return {
      key: ev.key,
      go: r ? () => open(r.id) : undefined,
      goLabel: r ? `Донесение: ${r.title}` : undefined,
      cells: {
        what: (
          <span className={`kit-name chron-ev ${ev.head.kind}`}>
            <Icon name={t.icon.name} glyph={t.icon.glyph} />
            <span className="kit-two">
              <b>
                {ev.head.text}
                {/* Повторы склеены счётчиком; у старых записей поля нет — `n ?? 1`. */}
                {(ev.head.n ?? 1) > 1 && <i className="chron-times"> ×{ev.head.n}</i>}
              </b>
              {ev.rest.map((x, i) => (
                <small key={i}>{x.text}</small>
              ))}
            </span>
          </span>
        ),
        res: res ? <span className={res.tone}>{res.text}</span> : null,
      },
    };
  });
}
