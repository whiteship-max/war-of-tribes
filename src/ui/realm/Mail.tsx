// «Решения» — почта державы (docs/realm.md, раздел 2.5): всё, что пришло и ждёт
// ответа, одним списком. Донесение открывается, ответ выбирается, исход виден
// тут же. Первым лежит то, что раньше всего разрешится само.
//
// Экран не знает, откуда пришло донесение: событие посёлка и письмо мира
// сведены в один вид (`dispatch.ts`), и отвечает он одной дверью
// (`answerDispatch`). Прежних окон — модалки события и столбика писем в
// деревне — больше нет: второй способ сказать то же самое разошёлся бы с первым.
import { useEffect, useState } from 'react';
import { useGame } from '@/game/store';
import { partyNow } from '@/net/clock';
import { useWorld, worldNow } from '@/world/store';
import { buildingOfType } from '@/game/derived';
import { RHUMB_WORDS } from '@/world/data/letters';
import type { LetterView } from '@/world/types';
import { Icon } from '@/ui/icons/Icon';
import { useUiNew } from '@/ui/uimode';
import { Cost } from '@/ui/parts/Cost';
import { useRaidWords } from '@/ui/parts/raidWords';
import { dispatches, leftWords, type Dispatch } from './dispatch';
import { useRealm } from './open';
import { mailKeys, useSeen } from './unread';

/**
 * Единственная дверь ответа: отдаёт ответ хозяину донесения и возвращает исход
 * словами. Событие закрывает партия (`sim/mail.resolveEvent`), письмо — мир
 * (`answerLetter`); исход письма — та строка, что ляжет в летопись.
 */
async function answerDispatch(d: Dispatch, choiceId: string): Promise<string | null> {
  if (d.source === 'event') return d.eventId ? useGame.getState().resolve(Number(choiceId), d.eventId) : null;
  if (!d.letterId) return null;
  const err = await useWorld.getState().answerLetter(d.letterId, choiceId === 'yes' ? 'yes' : 'no');
  if (err) return null;
  return d.choices.find((c) => c.id === choiceId)?.hint ?? null;
}

export function Mail() {
  const s = useGame((g) => g.s);
  // Новый интерфейс говорит своими словами (docs/ui_texts.md, пачка 14): «вести», «город», «новое» — точкой.
  const next = useUiNew();
  const letters = useWorld((w) => w.letters);
  const open = useRealm((r) => r.mail);
  const openMail = useRealm((r) => r.openMail);
  const seen = useSeen((u) => u.seen);
  const mark = useSeen((u) => u.mark);
  const [done, setDone] = useState<{ title: string; text: string } | null>(null);
  const [, retick] = useState(0);

  const list = dispatches(s, letters, { tribe: partyNow(), world: worldNow() });
  const live = mailKeys(
    s.inbox,
    letters.map((l) => l.id),
  );
  const current = list.find((d) => d.key === open) ?? null;

  // Срок идёт сам: замерший счётчик читается как сломанный экран.
  useEffect(() => {
    if (list.length === 0) return;
    const t = setInterval(() => retick((v) => v + 1), 1000);
    return () => clearInterval(t);
  }, [list.length]);

  // Открытое — прочитано. Отметка ставится по факту показа, а не по нажатию:
  // в донесение приводит и лупа письма, вернувшаяся с карты.
  const shown = current?.key ?? null;
  useEffect(() => {
    if (shown && !useSeen.getState().seen.includes(shown)) mark(shown, live);
    // `live` меняется вместе с почтой, а отметка нужна только при смене
    // открытого: брать его в зависимости значило бы метить на каждом кадре.
  }, [shown, mark]);

  if (done) {
    if (next) {
      return (
        <div className="nx-mail">
          <div className="nx-mhead">
            <span className="nx-mmed">
              <Icon name="ui-check" glyph="✔️" />
            </span>
            <div className="nx-mtitle">
              <b>{done.title}</b>
            </div>
          </div>
          <p className="nx-mtext">{done.text}</p>
          <button className="nx-mback" onClick={() => setDone(null)}>
            К вестям
          </button>
        </div>
      );
    }
    return (
      <div className="panel dispatch">
        <h3>{done.title}</h3>
        <p className="dispatch-done">{done.text}</p>
        <button className="btn wide" onClick={() => setDone(null)}>
          {next ? 'К вестям' : 'К донесениям'}
        </button>
      </div>
    );
  }

  if (current) {
    const Card = next ? DispatchCardNew : DispatchCard;
    return (
      <Card
        d={current}
        letter={letters.find((l) => l.id === current.letterId) ?? null}
        onBack={() => openMail(null)}
        onAnswer={async (id) => {
          const text = await answerDispatch(current, id);
          openMail(null);
          if (text) setDone({ title: current.title, text });
        }}
      />
    );
  }

  if (list.length === 0) {
    if (next) {
      return (
        <div className="panel dispatch-empty">
          <div className="big">
            <Icon name="ui-mail" glyph="✉️" />
          </div>
          <b className="nx-empty">Вестей нет</b>
          <div className="note">Сюда приходят вести из города и от соседей. У каждой свой срок: без ответа она решится сама.</div>
        </div>
      );
    }
    return (
      <div className="panel dispatch-empty">
        <div className="big">✉️</div>
        <div className="note">
          Донесений нет. Здесь копится то, что ждёт решения вождя: вести из посёлка и письма соседей. У каждого
          донесения свой срок, и без ответа оно решится само.
        </div>
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="mail-list">
        {list.map((d) => {
          const fresh = !seen.includes(d.key);
          return (
            <button key={d.key} className={`mail-row${fresh ? ' fresh' : ''}`} onClick={() => openMail(d.key)}>
              <span className="ic">
                <Icon name={d.iconName} glyph={d.icon} />
              </span>
              <span className="txt">
                <b>{d.title}</b>
                <small>
                  <i className="who">{d.from ?? (d.warning ? 'Дозор' : next ? 'Город' : 'Посёлок')}</i>
                  {d.left !== null && <em>{leftWords(d.left)}</em>}
                </small>
              </span>
              {fresh && (next ? <span className="nx-new" aria-label="новое" /> : <span className="new">новое</span>)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Открытое донесение. Показывает всегда три вещи: что предлагают, что даст
 * каждый ответ и **что будет, если промолчать**. Молчание — такой же исход, как
 * ответ, и прятать его значило бы оставить игрока с последствием, о котором
 * нигде не сказано.
 */
function DispatchCard({
  d,
  letter,
  onBack,
  onAnswer,
}: {
  d: Dispatch;
  letter: LetterView | null;
  onBack: () => void;
  onAnswer: (id: string) => void;
}) {
  const spot = useWorld((w) => w.spotLetter);
  const openMap = useGame((g) => g.openMap);
  const openBuilding = useGame((g) => g.openBuilding);
  const s = useGame((g) => g.s);
  const statue = buildingOfType(s, 'statue');
  // Окно этого отряда — словами общего окна; письмо и отряд связаны `marchId`.
  const raids = useRaidWords();
  const raid = letter?.kind === 'raid' ? (raids.find((w) => w.win.march.id === letter.marchId) ?? null) : null;

  return (
    <div className="panel dispatch">
      <div className="dispatch-ico">
        <Icon name={d.iconName} glyph={d.icon} />
      </div>
      <h3>{d.title}</h3>
      {letter && <FromLine letter={letter} onSpot={() => spot(letter.id)} />}
      <p>{d.text}</p>
      {/* Что просят одним числом на всё донесение — тем же `Cost`, что у стройки. */}
      <Cost cost={d.cost} />
      {d.left !== null && (
        <p className="dispatch-left">
          {d.leftText}: <b>{leftWords(d.left)}</b>
        </p>
      )}
      <p className="dispatch-silence">{d.silence}</p>
      <div className="options">
        {d.choices.map((c) => {
          const priced = Object.values(c.cost).some((n) => (n ?? 0) > 0);
          return (
            <button key={c.id} className="opt" disabled={c.block !== null} onClick={() => onAnswer(c.id)}>
              <span>{c.label}</span>
              {(c.block ?? c.hint) && <small>{c.block ?? c.hint}</small>}
              {priced && <Cost cost={c.cost} />}
            </button>
          );
        })}
        {/* Предупреждение решается не здесь, и об этом сказано словами: два
            ответа — перехватить в поле или собрать дружину к воротам. У частокола
            строй раскладывает правило боя, и расставлять там нечего. */}
        {letter?.kind === 'raid' && (
          <>
            <button className="opt" onClick={() => openMap()}>
              <span>На карту</span>
              <small>Перехватить в поле, пока они идут</small>
            </button>
            <button className="opt" disabled={!statue} onClick={() => statue && openBuilding(statue.id)}>
              <span>Дружина</span>
              {/* Успевает ли полный сбор — словами общего окна. */}
              <small>{['Собрать к воротам в Статуе', raid?.short].filter(Boolean).join(' · ')}</small>
            </button>
          </>
        )}
        <button className="btn ghost wide" onClick={onBack}>
          {d.choices.length > 0 ? 'Отложить' : 'К донесениям'}
        </button>
      </div>
    </div>
  );
}

/**
 * Открытая весть нового вида (docs/ui_audit.md, 6.4 и 13): шапка — значок повода, заголовок, кто прислал (лупа — к
 * месту на карте); срок — строкой со значком; текст; что просят — `Cost`; ответы — строками 56: что сделать, что это
 * даст, чего стоит, почему нельзя; что будет без ответа — строкой внизу. Слова и числа — те же, что у прежней
 * карточки: их считает хозяин вести (`dispatch.ts`), здесь только вид.
 */
function DispatchCardNew({
  d,
  letter,
  onBack,
  onAnswer,
}: {
  d: Dispatch;
  letter: LetterView | null;
  onBack: () => void;
  onAnswer: (id: string) => void;
}) {
  const spot = useWorld((w) => w.spotLetter);
  const openMap = useGame((g) => g.openMap);
  const openBuilding = useGame((g) => g.openBuilding);
  const s = useGame((g) => g.s);
  const statue = buildingOfType(s, 'statue');
  const raids = useRaidWords();
  const raid = letter?.kind === 'raid' ? (raids.find((w) => w.win.march.id === letter.marchId) ?? null) : null;
  const from = letter?.from ?? null;
  const where = letter && from && !from.cell ? `${RHUMB_WORDS[from.rhumb]}, ${from.cells} кл., не разведано` : null;
  const asks = Object.values(d.cost).some((n) => (n ?? 0) > 0);
  // Набег идёт сам и сроком беды — красным; остальное ждёт ответа — охрой.
  const urgent = letter?.kind === 'raid' || d.warning;

  return (
    <div className="nx-mail">
      <div className="nx-mhead">
        <span className={`nx-mmed${urgent ? ' urgent' : ''}`}>
          <Icon name={d.iconName} glyph={d.icon} />
        </span>
        <div className="nx-mtitle">
          <b>{d.title}</b>
          <small>
            {letter ? letter.fromName : (d.from ?? (d.warning ? 'Дозор' : 'Город'))}
            {where ? ` · ${where}` : ''}
          </small>
        </div>
        {from?.cell && (
          <button className="nx-mspot" onClick={() => letter && spot(letter.id)} aria-label="Показать на карте">
            <Icon name="ui-spyglass" glyph="🔍" />
          </button>
        )}
      </div>
      {d.left !== null && (
        <div className={`nx-mdue${urgent ? ' urgent' : ''}`}>
          <Icon name="ui-time" glyph="⏳" />
          <span>{d.leftText}</span>
          <b>{leftWords(d.left)}</b>
        </div>
      )}
      <p className="nx-mtext">{d.text}</p>
      {asks && (
        <div className="nx-mcost">
          <small>Просят</small>
          <Cost cost={d.cost} />
        </div>
      )}
      <div className="nx-answers">
        {d.choices.map((c) => {
          const priced = Object.values(c.cost).some((n) => (n ?? 0) > 0);
          return (
            <button key={c.id} className="nx-ans" disabled={c.block !== null} onClick={() => onAnswer(c.id)}>
              <b>{c.label}</b>
              {(c.block ?? c.hint) && <small className={c.block ? 'bad' : ''}>{c.block ?? c.hint}</small>}
              {priced && <Cost cost={c.cost} />}
            </button>
          );
        })}
        {/* Набег решается не здесь: перехватить в поле — на карте, собрать дружину к воротам — в Статуе. */}
        {letter?.kind === 'raid' && (
          <>
            <button className="nx-ans" onClick={() => openMap()}>
              <b>На карту</b>
              <small>Перехватить в поле, пока они идут</small>
            </button>
            <button className="nx-ans" disabled={!statue} onClick={() => statue && openBuilding(statue.id)}>
              <b>Дружина</b>
              <small>{['Собрать к воротам в Статуе', raid?.short].filter(Boolean).join(' · ')}</small>
            </button>
          </>
        )}
      </div>
      <p className="nx-msilence">{d.silence}</p>
      <button className="nx-mback" onClick={onBack}>
        {d.choices.length > 0 ? 'Отложить' : 'К вестям'}
      </button>
    </div>
  );
}

/**
 * Кто прислал письмо и где он. Имя переносится и не обрезается — длину его никто
 * не обещал. Лупа ведёт на карту и есть ровно тогда, когда есть что показать:
 * клетку мир отдаёт только разведанную; неразведанный двор назван румбом и
 * расстоянием. Уйдёшь с карты — письмо откроется здесь же (`open.ts`).
 */
function FromLine({ letter, onSpot }: { letter: LetterView; onSpot: () => void }) {
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
