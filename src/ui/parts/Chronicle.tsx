import { useState } from 'react';
import type { LogEntry } from '@/game/types';
import { useGame } from '@/game/store';
import { DAY_LENGTH } from '@/game/constants';
import { dayOf, seasonOf, yearOf } from '@/game/derived';
import { SEASON_META } from '@/game/data/seasons';
import { LOG_MAX_DAYS } from '@/game/sim/log';
import { count, plural } from './plural';
import { Icon } from '@/ui/icons/Icon';

/**
 * Летопись: свёрнута по умолчанию и раскрывается ступенями.
 *
 * Причина сворачивать простая: летопись — это хвост партии, а не её лицо. Она
 * стояла первым, что видно на «Заданиях», и отодвигала вниз то, ради чего туда
 * заходят. Причина раскрывать ступенями — та же, по которой она теперь и
 * хранится по возрасту: «сутки», «неделя», «месяц» — это мера, понятная игроку,
 * а «ещё двадцать строк» не значит ничего.
 *
 * Дальше месяца ступеней нет, потому что дальше месяца ничего и не хранится
 * (`LOG_MAX_DAYS` в sim/log.ts): показывать нечего, и об этом сказано словами,
 * а не молчанием.
 */
const STEPS: { days: number; name: string; next: string | null }[] = [
  { days: 1, name: 'сутки', next: 'неделю' },
  { days: 7, name: 'неделю', next: 'месяц' },
  { days: LOG_MAX_DAYS, name: 'месяц', next: null },
];

/** Записи не старше `days` игровых дней. Летопись отсортирована новыми вперёд. */
const within = (log: LogEntry[], now: number, days: number): LogEntry[] =>
  log.filter((e) => now - e.at < days * DAY_LENGTH);

/** «сегодня», «вчера», «3 дня назад» — возраст словами, чтобы не считать в уме. */
function ago(days: number): string {
  if (days <= 0) return 'сегодня';
  if (days === 1) return 'вчера';
  return `${count(days, 'день', 'дня', 'дней')} назад`;
}

/**
 * Отметка дня — как в книге летописца: год, время года и день партии («Год 3, лето · день 121»). Сезон и год
 * выводятся из времени записи (`seasonOf`, `yearOf`), своего счёта у летописи нет.
 */
const dateWords = (at: number): string =>
  `Год ${yearOf(at)}, ${SEASON_META[seasonOf(at)].name.toLowerCase()} · день ${dayOf(at)}`;

export function Chronicle() {
  const s = useGame((g) => g.s);
  // null — свёрнута. Иначе номер ступени: сутки, неделя, месяц.
  const [step, setStep] = useState<number | null>(null);

  const now = s.time;
  const today = dayOf(now);
  const day1 = within(s.log, now, STEPS[0].days).length;

  if (step === null) {
    return (
      <>
        <h3>Летопись</h3>
        <button className="btn ghost wide chron-toggle" onClick={() => setStep(0)}>
          <span><Icon name="ui-book" glyph="📖" /> Показать за сутки</span>
          <i>{day1 > 0 ? `${day1} ${plural(day1, 'запись', 'записи', 'записей')}` : 'тихо'}</i>
        </button>
      </>
    );
  }

  const cur = STEPS[step];
  const shown = within(s.log, now, cur.days);
  // Сколько прибавится на следующей ступени — число стоит прямо на кнопке:
  // игрок решает, разворачивать ли, зная цену.
  const more = step + 1 < STEPS.length ? within(s.log, now, STEPS[step + 1].days).length - shown.length : 0;

  // Записи одного дня идут под одной отметкой: на 375 px «Д121» в каждой строке
  // съедает четверть ширины и повторяется по десять раз подряд.
  const days: { day: number; at: number; entries: LogEntry[] }[] = [];
  for (const e of shown) {
    const d = dayOf(e.at);
    const last = days[days.length - 1];
    if (last && last.day === d) last.entries.push(e);
    else days.push({ day: d, at: e.at, entries: [e] });
  }

  return (
    <>
      <h3>
        Летопись <span className="muted">за {cur.name}</span>
      </h3>
      <div className="log">
        {days.map((g) => (
          <div className="log-day" key={g.day}>
            <div className="log-date">
              {dateWords(g.at)} <i>{ago(today - g.day)}</i>
            </div>
            {g.entries.map((e, i) => (
              <div key={i} className={e.kind}>
                {e.text}
                {/* Повторы склеены счётчиком. Читать только `n ?? 1`: у записей
                    старых партий поля нет, и `e.n > 1` дало бы тихую ложь. */}
                {(e.n ?? 1) > 1 && <i className="log-times"> ×{e.n}</i>}
              </div>
            ))}
          </div>
        ))}
        {shown.length === 0 && <div className="log-empty">За {cur.name} записей нет.</div>}
      </div>

      {cur.next !== null && (
        <button className="btn ghost wide chron-toggle" onClick={() => setStep(step + 1)}>
          <span>Показать за {cur.next}</span>
          <i>{more > 0 ? `+${more}` : 'пусто'}</i>
        </button>
      )}
      {cur.next === null && (
        <div className="note">Летопись хранит месяц.</div>
      )}
      <button className="btn ghost wide chron-toggle" onClick={() => setStep(null)}>
        <span>Свернуть летопись</span>
      </button>
    </>
  );
}
