import { useEffect, useState } from 'react';
import { useGame } from '@/game/store';
import { tutorialActive } from '@/game/data/tutorial';
import { useWorld, worldNow } from '@/world/store';
import { formatLeft } from '@/world/geo';
import type { LetterView } from '@/world/types';
import type { GameState } from '@/game/types';
import { Icon } from '@/ui/icons/Icon';

/**
 * Столбик писем слева внизу и открытое письмо.
 *
 * Живёт он в деревне, а не на карте, и причин две. Первая: у карты весь левый
 * низ занят — ряд якорей камеры, нижние кнопки и строка подсказки, — и на
 * 390 px четвёртой стопке там просто негде встать, не накрыв собой то, чем
 * ходят. Вторая важнее: письмо-предупреждение о набеге ведёт **на карту**, и
 * кнопка «На карту», нажатая с карты, не значила бы ничего. Письма читают
 * дома, решают по ним — на карте.
 *
 * Порядок в столбике — не «по приходу», а по сроку: первым лежит то, что
 * раньше всего разрешится само. У решений это одно и то же (срок у всех
 * ровно сутки от прихода), а предупреждение о набеге живёт минуты и обязано
 * лечь сверху. Считает этот порядок мир, а не разметка.
 */
/**
 * Виден ли столбик прямо сейчас. Считает это одна функция, и спрашивают её
 * двое: сам столбик и строка тревог — она гасит свою строку о набеге там, где
 * то же самое уже написано в письме, и показывает её там, где письма нет
 * (на карте). Двух правд о том, где видны письма, между ними быть не должно.
 */
export function lettersVisible(s: GameState, eventResult: string | null, mapOpen: boolean): boolean {
  return !mapOpen && !tutorialActive(s) && !s.activeEvent && !eventResult;
}

export function Letters() {
  const s = useGame((g) => g.s);
  const eventResult = useGame((g) => g.eventResult);
  const letters = useWorld((g) => g.letters);
  const openId = useWorld((g) => g.openLetter);
  const show = useWorld((g) => g.showLetter);
  const mapOpen = useGame((g) => g.mapOpen);
  const [, retick] = useState(0);

  // Пока на столе лежит письмо, отсчёт до срока должен идти сам: замерший
  // счётчик читается как сломанный экран, а не как «время ещё есть».
  useEffect(() => {
    if (letters.length === 0) return;
    const t = setInterval(() => retick((v) => v + 1), 1000);
    return () => clearInterval(t);
  }, [letters.length]);

  // Обучение ведёт новичка по своему пути, и лишний слой поверх «дырки» в
  // затемнении ему только мешает; модалки делят один слой, и вторая поверх
  // первой — это уже не выбор, а завал. Письма подождут: они и заведены для
  // того, чтобы ждать.
  if (!lettersVisible(s, eventResult, mapOpen)) return null;
  if (letters.length === 0) return null;
  const open = letters.find((l) => l.id === openId) ?? null;

  return (
    <>
      <div className="letters">
        {letters.map((l, i) => (
          <button
            key={l.id}
            className={`letter${i === 0 ? ' first' : ''}${l.kind === 'raid' ? ' raid' : ''}`}
            onClick={() => show(l.id)}
            data-tut={`letter-${l.kind}`}
          >
            <span className="ic">
              <Icon name={`letter-${l.kind}`} glyph={l.icon} />
            </span>
            <span className="txt">
              <b>{l.title}</b>
              <small>
                {l.fromName} · {formatLeft(Math.max(0, (l.until - worldNow()) / 1000))}
              </small>
            </span>
          </button>
        ))}
      </div>
      {open && <LetterCard letter={open} />}
    </>
  );
}

/**
 * Открытое письмо. Оно всегда показывает три вещи: что предлагают, что даст
 * каждый ответ и **что будет, если промолчать**. Последнее — не украшение:
 * молчание здесь такой же исход, как «да» и «нет», и прятать его значило бы
 * оставить игрока с последствием, о котором нигде не сказано.
 */
function LetterCard({ letter }: { letter: LetterView }) {
  const show = useWorld((g) => g.showLetter);
  const answer = useWorld((g) => g.answerLetter);
  const openMap = useGame((g) => g.openMap);
  const openDefense = useGame((g) => g.openDefense);
  const left = formatLeft(Math.max(0, (letter.until - worldNow()) / 1000));

  return (
    <div className="modal-backdrop" onClick={() => show(null)}>
      <div className="modal letter-card" onClick={(e) => e.stopPropagation()}>
        <div className="m-ico">
          <Icon name={`letter-${letter.kind}`} glyph={letter.icon} />
        </div>
        <h2>{letter.title}</h2>
        <p>{letter.body}</p>
        <p className="letter-left">
          {/* У решения ждёт гонец, у предупреждения — идёт отряд. Одна строка
              на оба случая врала бы в одном из них. */}
          {letter.kind === 'raid' ? 'Отряд будет у ворот через: ' : 'Гонец ждёт ответа: '}
          <b>{left}</b>
        </p>
        <p className="letter-silence">{letter.silence}</p>
        <div className="options">
          {letter.choices.map((c) => (
            <button
              key={c.id}
              className="opt"
              disabled={!c.can}
              onClick={() => void answer(letter.id, c.id)}
            >
              <span>{c.label}</span>
              <small>{c.can ? c.hint : c.reason}</small>
            </button>
          ))}
          {/* Предупреждение решается не здесь, и об этом сказано словами: две
              двери — перехватить в поле или встретить у частокола. */}
          {letter.kind === 'raid' && (
            <>
              <button
                className="opt"
                onClick={() => {
                  show(null);
                  openMap();
                }}
              >
                <span>На карту</span>
                <small>Перехватить в поле, пока они идут</small>
              </button>
              <button
                className="opt"
                onClick={() => {
                  show(null);
                  openDefense();
                }}
              >
                <span>Оборона</span>
                <small>Расставить тех, кто дома</small>
              </button>
            </>
          )}
          <button className="btn ghost wide" onClick={() => show(null)}>
            {letter.choices.length > 0 ? 'Отложить' : 'Закрыть'}
          </button>
        </div>
      </div>
    </div>
  );
}
