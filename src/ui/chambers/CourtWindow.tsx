// Гонец и советник в покоях (docs/city_v3.md, ПК-1) — плашки поверх комнаты, тем же видом, что разговор Г-7 (`TalkWindow`):
// кто говорит, его слова проступают по буквам (касание — сразу целиком), голос — речь без слов на столько же секунд.
//
// Гонец стучит — справа внизу «Впустить» и «Позже» (`KnockBar`): сцену это не закрывает, ходить можно. Впустили — входит,
// кланяется и рассказывает все вести разом; «Открыть» у каждой ведёт к её месту, «Ступай» — уходит. Советник докладывает
// по одной вести: касание — следующая, «Открыть» — место этой. Слова — в минуту рассказа (`Court.tellings`), не раньше.
import { useEffect, useRef, useState } from 'react';
import type { ChambersLife } from '@/render/chambers/life';
import type { FaithId } from '@/game/types';
import { useGame } from '@/game/store';
import { councilSeat } from '@/game/derived';
import { titleOf } from '@/game/sim/council';
import type { Court } from './court';
import { advisorOpening, lowerFirst, says, type TidingKind } from './tidings';
import { speechSeconds } from './plate';

/** Буквы в секунду — как у разговора (`TalkWindow`). */
const CPS = 46;
/** Слова, проступающие по буквам; `skip` — показать целиком. */
function useTyped(text: string): { shown: number; full: boolean; skip: () => void } {
  const [shown, setShown] = useState(0);
  useEffect(() => setShown(0), [text]);
  useEffect(() => {
    if (shown >= text.length) return;
    const t = window.setTimeout(() => setShown((s) => Math.min(text.length, s + 2)), 2000 / CPS);
    return () => window.clearTimeout(t);
  }, [text, shown]);
  return { shown, full: shown >= text.length, skip: () => setShown(text.length) };
}

/** Чем весть подписана под именем гонца. */
const NEWS_WORD: Record<TidingKind, string> = {
  march: 'на нас идут',
  siege: 'осада',
  revolt: 'мятеж',
  disaster: 'беда',
  out: 'со склада',
  battle: 'донесение о бое',
  ask: 'ждут ответа',
  build: 'стройка',
};

/** Стук гонца: справа внизу «Впустить» и «Позже»; покои живут дальше. */
export function KnockBar({ court }: { court: Court }) {
  if (!court.knocking) return null;
  return (
    <div className="ch-knock" role="group" aria-label="Гонец за дверью">
      <small>Стучат: гонец с вестью</small>
      <button className="ch-knock-in" onClick={() => court.admit()}>
        Впустить
      </button>
      <button onClick={() => court.postpone()}>Позже</button>
    </div>
  );
}

export function HeraldPlate({ life, court, faith, onDone }: { life: ChambersLife; court: Court; faith: FaithId; onDone: () => void }) {
  // Слова — в минуту, когда он встал перед правителем: что переменилось, пока поднимался, он уже знает.
  const [lines] = useState(() => court.heraldLines());
  const first = lines[0];
  const line = first ? says(`{T}, ${lowerFirst(first.text)}${lines.length > 1 ? ` И ещё ${lines.length === 2 ? 'одна весть' : `${lines.length - 1} вести`}:` : ''}`, faith) : says('{T}, вести, с которыми я шёл, уже в «Вестях».', faith);
  const typed = useTyped(line);
  const said = useRef(false);
  useEffect(() => {
    if (said.current || !line) return;
    said.current = true;
    life.say('herald', speechSeconds(line));
  }, [line, life]);
  if (!court.carrying) return null;
  return (
    <div className="ch-talk ch-court" role="dialog" aria-label="Гонец с вестью">
      <div className="ch-talk-head">
        <b>Гонец</b>
        <small>{first ? NEWS_WORD[first.t.kind] : 'весть'}</small>
        <button
          className="ch-talk-x"
          onClick={() => {
            life.endTalk();
            onDone();
          }}
          aria-label="Помолчать"
        >
          ×
        </button>
      </div>
      <p className="ch-talk-line" onClick={typed.skip}>
        {line.slice(0, typed.shown)}
        <span className="ch-talk-rest" aria-hidden="true">
          {line.slice(typed.shown)}
        </span>
      </p>
      {lines.length > 1 && (
        <div className="ch-report" role="list">
          {lines.slice(1).map((l) => (
            <button key={l.t.id} role="listitem" className={`ch-report-row ${l.outcome ? 'info' : 'bad'}`} onClick={() => court.heraldDone(l.door)}>
              <i aria-hidden="true" />
              <span>{l.text}</span>
              <b aria-hidden="true">›</b>
            </button>
          ))}
        </div>
      )}
      <div className="ch-talk-opts on">
        {first && <button className="ch-court-take" onClick={() => court.heraldDone(first.door)}>Открыть</button>}
        <button onClick={() => court.heraldDone()}>Ступай</button>
      </div>
    </div>
  );
}

/** Имя советника по вере державы: один на двор, при новом правителе — тот же. */
export const ADVISOR_NAME: Record<FaithId, string> = { catholic: 'Мэтр Годфруа', orthodox: 'Боярин Ставр', islam: 'Визирь Абу Сахль', pagan: 'Старейшина Вилкас' };

/** Касание молчащего советника: доклада нет — так и говорит. */
const QUIET = '{T}, за тобой нового нет. Всё прочее — в «Вестях».';

export function AdvisorPlate({ life, court, faith, onDone }: { life: ChambersLife; court: Court; faith: FaithId; onDone: () => void }) {
  // С докладом приходит старший советник совета Ратуши — Староста (Бургомистр), если место занято (РТ-1); нет — советник покоев.
  const chief = useGame((g) => councilSeat(g.s, 'steward'));
  const title = useGame((g) => titleOf(g.s, 'steward'));
  const rep = court.report;
  // Доклад кончился — плашка гаснет вслед за разговором, а не отвечает «нового нет».
  const [had] = useState(() => rep !== null);
  const cur = rep?.lines[rep.at] ?? null;
  // Первая весть — с приветствием; дальше — сами вести, по одной.
  const text = says(!rep ? QUIET : rep.at === 0 ? `${advisorOpening(rep.lines)} ${lowerFirst(cur?.text ?? '')}` : (cur?.text ?? ''), faith);
  const typed = useTyped(text);
  const said = useRef('');
  useEffect(() => {
    if (said.current === text) return;
    said.current = text;
    life.say('advisor', speechSeconds(text));
  }, [text, life]);
  const done = (): void => {
    life.endTalk();
    onDone();
  };
  if (had && !rep) return null;
  return (
    <div className="ch-talk ch-court" role="dialog" aria-label="Доклад советника">
      <div className="ch-talk-head">
        <b>{chief ? chief.name : ADVISOR_NAME[faith]}</b>
        <small>{rep ? `${chief ? title.toLowerCase() : 'советник'}, весть ${rep.at + 1} из ${rep.lines.length}` : chief ? title.toLowerCase() : 'советник'}</small>
        <button className="ch-talk-x" onClick={done} aria-label="Помолчать">
          ×
        </button>
      </div>
      <p
        className="ch-talk-line"
        onClick={() => {
          // Касание: слова не дописаны — дописать; дописаны — следующая весть.
          if (!typed.full) typed.skip();
          else if (rep) court.next();
          else done();
        }}
      >
        {text.slice(0, typed.shown)}
        <span className="ch-talk-rest" aria-hidden="true">
          {text.slice(typed.shown)}
        </span>
      </p>
      <div className="ch-talk-opts on">
        {cur && <button className="ch-court-take" onClick={() => court.openLine()}>Открыть</button>}
        {rep ? <button onClick={() => court.next()}>{rep.at + 1 < rep.lines.length ? 'Дальше' : 'Довольно'}</button> : <button onClick={done}>Хорошо</button>}
      </div>
    </div>
  );
}
