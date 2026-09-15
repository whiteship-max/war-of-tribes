import { useEffect, useState } from 'react';
import { useGame } from '@/game/store';
import { tutorialActive } from '@/game/data/tutorial';
import { useWorld, worldNow } from '@/world/store';
import { formatLeft } from '@/world/geo';
import { RHUMB_WORDS } from '@/world/data/letters';
import type { LetterView } from '@/world/types';
import type { GameState } from '@/game/types';
import { Icon } from '@/ui/icons/Icon';
import { Cost } from '@/ui/parts/Cost';
import { useLockWords } from '@/ui/parts/defenseLock';

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
                {/* Имя жмётся многоточием, отсчёт — никогда: в одной строке они
                    делили место, и на длинном имени срок съедался первым, а он
                    и есть то, ради чего в столбик смотрят. */}
                <i className="who">{l.fromName}</i>
                <em>{formatLeft(Math.max(0, (l.until - worldNow()) / 1000))}</em>
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
 * Кто прислал письмо и где он.
 *
 * Строка эта — единственное место в письме, где имя стоит нарочно и на виду:
 * из тела письма его пришлось бы вычитывать, а из подписей выбора оно убрано
 * совсем (см. правило длинных имён в `world/data/letters.ts`). Имя переносится
 * на вторую строку и никогда не обрезается — длину его никто не обещал.
 *
 * Лупа рядом ведёт на карту. Есть она ровно тогда, когда есть что показать:
 * клетку мир отдаёт только разведанную. Неразведанный двор не молчит — вместо
 * лупы стоит румб и расстояние, столько и знает тот, к кому приехал гонец.
 * Выключенной кнопки тут нет: кнопка, которая не нажимается, — это обещание,
 * которого никто не давал.
 */
function LetterFromLine({ letter, onSpot }: { letter: LetterView; onSpot: () => void }) {
  const from = letter.from;
  const where = from && !from.cell ? `${RHUMB_WORDS[from.rhumb]}, ${from.cells} кл. — место не разведано` : null;
  return (
    <div className="letter-from">
      <span className="who">
        {letter.fromName}
        {where && <small>{where}</small>}
      </span>
      {from?.cell && (
        <button className="spot" onClick={onSpot} aria-label="Показать на карте">
          🔍
        </button>
      )}
    </div>
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
  const spot = useWorld((g) => g.spotLetter);
  const answer = useWorld((g) => g.answerLetter);
  const openMap = useGame((g) => g.openMap);
  const openDefense = useGame((g) => g.openDefense);
  const lock = useLockWords();
  const left = formatLeft(Math.max(0, (letter.until - worldNow()) / 1000));

  return (
    <div className="modal-backdrop" onClick={() => show(null)}>
      <div className="modal letter-card" onClick={(e) => e.stopPropagation()}>
        <div className="m-ico">
          <Icon name={`letter-${letter.kind}`} glyph={letter.icon} />
        </div>
        <h2>{letter.title}</h2>
        <LetterFromLine letter={letter} onSpot={() => spot(letter.id)} />
        <p>{letter.body}</p>
        {/*
          Что просят — и сколько этого есть. Тем же `Cost`, что стоит у стройки
          и у ковки: одна форма на весь вопрос «хватает или нет».

          Раньше здесь стояло только «дань: еда 40» в теле письма, а склад из-под
          письма было не посмотреть — и «заплатить» нажимали наугад. Число в
          строке «из» — тот же склад, по которому мир гасит кнопку: он приезжает
          в слепке деревни целиком, вместе со спрятанным в тайнике.
        */}
        <Cost cost={letter.cost} />
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
                {/* Заперта ли расстановка — словами общего замка: «расставить» после
                    отметки было бы обещанием, которое экран тут же отзовёт. */}
                <small>{lock.frozen ? lock.short : ['Расставить тех, кто дома', lock.short].filter(Boolean).join(' · ')}</small>
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
