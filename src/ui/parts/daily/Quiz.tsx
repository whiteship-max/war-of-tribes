import { useMemo, useState } from 'react';
import { quizExplain, quizQuestion, type QuizSide } from '@/game/daily/quiz';
import { TROOP_BY_ID, TROOP_IDS } from '@/game/data/troops';
import { haptic } from '@/telegram/webapp';

/**
 * ⚔️ Кто победит. Две дружины, игрок выбирает чью.
 *
 * Правильный ответ не придуман и нигде не записан: обе стороны прогоняются
 * настоящей боевой симуляцией, и победила та, которая победила. Поэтому
 * викторина не может разойтись с балансом — после любой правки чисел она
 * начинает учить новым числам сама.
 *
 * Ни мощи, ни процентов шансов на карточках нет: правило «прогноза исхода нет
 * нигде» действует и здесь. Показав силу числом, задачу свели бы к вычитанию, и
 * кольцо контрров стало бы ни при чём.
 */
export function Quiz({ seed, onDone }: { seed: number; onDone: (won: boolean) => void }) {
  // Перебор боёв стоит десятки миллисекунд — считаем один раз на сид, а не на
  // каждый кадр стора: он дёргается каждый `TICK_MS`.
  const q = useMemo(() => quizQuestion(seed), [seed]);
  const [picked, setPicked] = useState<'ours' | 'theirs' | null>(null);
  const why = useMemo(() => (picked ? quizExplain(q) : null), [picked, q]);

  const answer = (side: 'ours' | 'theirs'): void => {
    if (picked) return;
    const won = side === q.answer;
    haptic(won ? 'success' : 'error');
    setPicked(side);
    onDone(won);
  };

  const cls = (side: 'ours' | 'theirs'): string => {
    if (!picked) return '';
    if (side === q.answer) return ' right';
    return side === picked ? ' wrong' : '';
  };

  return (
    <>
      <div className="mg-head">
        <b>{picked ? (picked === q.answer ? 'Верно' : 'Не угадал') : 'Чья возьмёт?'}</b>
        <span className="mg-clock">{q.ours.men} × {q.theirs.men}</span>
      </div>

      <div className="mg-quiz">
        <button className={`mg-side${cls('ours')}`} onClick={() => answer('ours')} disabled={picked !== null}>
          <span className="mg-side-name">Наши</span>
          <Stack side={q.ours} />
          <small>нападают</small>
        </button>
        <button className={`mg-side${cls('theirs')}`} onClick={() => answer('theirs')} disabled={picked !== null}>
          <span className="mg-side-name">Враг</span>
          <Stack side={q.theirs} />
          <small>обороняется</small>
        </button>
      </div>

      {why && (
        <div className="mg-why">
          <b>{why.title}</b>
          {why.reason}
          {why.lines.map((line, i) => (
            <div key={i}>{line}</div>
          ))}
        </div>
      )}
      {!picked && (
        <div className="note">
          Силы почти равны, решают рода войск. Нажми на ту сторону, что удержит поле.
        </div>
      )}
    </>
  );
}

/** Состав строками «иконка вид × число». Слова и иконки — из конфига войск. */
function Stack({ side }: { side: QuizSide }) {
  return (
    <>
      {TROOP_IDS.filter((id) => (side.troops[id] ?? 0) > 0).map((id) => (
        <span className="mg-stack" key={id}>
          {TROOP_BY_ID[id].icon} {TROOP_BY_ID[id].name} × {side.troops[id]}
        </span>
      ))}
    </>
  );
}
