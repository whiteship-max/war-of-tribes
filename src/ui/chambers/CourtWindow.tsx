// Гонец и советник в покоях (docs/city_v3.md, Г-10) — плашки поверх комнаты, тем же видом, что разговор Г-7 (`TalkWindow`):
// кто говорит, его слова проступают по буквам (касание — сразу целиком), голос — речь без слов на столько же секунд.
//
// Гонец протягивает письмо с печатью: «Взять письмо» (или касание письма в его руке) — весть открывается, гонец уходит;
// «Позже» — уходит без письма, весть ждёт в «Вестях». Советник докладывает строками — каждая ведёт в своё донесение;
// «Ступай» — уходит. Крестик у обоих — помолчать: человек стоит, касание по нему — снова к делу.
import { useEffect, useRef, useState } from 'react';
import type { ChambersLife } from '@/render/chambers/life';
import type { FaithId } from '@/game/types';
import type { Court } from './court';
import { advisorOpening, says, type News } from './tidings';
import { speechSeconds } from './plate';

/** Буквы в секунду — как у разговора (`TalkWindow`). */
const CPS = 46;
/** Через сколько после первой фразы проступает следующая строка доклада, мс. */
const LINE_MS = 650;

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
const NEWS_WORD: Record<News['kind'], string> = {
  raid: 'весть о набеге',
  siege: 'весть об осаде',
  breach: 'весть со стены',
  offer: 'условия',
  pact: 'посольство',
  battle: 'донесение о бое',
};

export function HeraldPlate({ life, court, faith, onDone }: { life: ChambersLife; court: Court; faith: FaithId; onDone: () => void }) {
  const news = court.carrying;
  const line = news ? says(news.line, faith) : '';
  const typed = useTyped(line);
  const said = useRef(false);
  useEffect(() => {
    if (said.current || !line) return;
    said.current = true;
    life.say('herald', speechSeconds(line));
  }, [line, life]);
  if (!news) return null;
  return (
    <div className="ch-talk ch-court" role="dialog" aria-label="Гонец с письмом">
      <div className="ch-talk-head">
        <b>Гонец</b>
        <small>{NEWS_WORD[news.kind]}</small>
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
      <div className={`ch-talk-opts on`}>
        <button className="ch-court-take" onClick={() => life.takeLetter()}>
          <span className="ch-seal" aria-hidden="true" />
          Взять письмо
        </button>
        <button onClick={() => court.decline()}>Позже — оставь в «Вестях»</button>
      </div>
    </div>
  );
}

/** Имя советника по вере державы: один на двор, при новом правителе — тот же. */
export const ADVISOR_NAME: Record<FaithId, string> = { catholic: 'Мэтр Годфруа', orthodox: 'Боярин Ставр', islam: 'Визирь Абу Сахль', pagan: 'Старейшина Вилкас' };

export function AdvisorPlate({ life, court, faith, onDone }: { life: ChambersLife; court: Court; faith: FaithId; onDone: () => void }) {
  const rep = court.report;
  const lines = rep?.lines ?? [];
  const open = says(advisorOpening(lines), faith);
  const typed = useTyped(open);
  // Строки доклада — одна за другой, как он читает их со свитка; второй подход — сразу все.
  const [count, setCount] = useState(() => (rep && rep.opened.size > 0 ? lines.length : 0));
  const said = useRef(-1);
  useEffect(() => {
    if (!typed.full || count >= lines.length) return;
    const t = window.setTimeout(() => setCount((n) => n + 1), count === 0 ? 250 : LINE_MS);
    return () => window.clearTimeout(t);
  }, [typed.full, count, lines.length]);
  useEffect(() => {
    // Голос — на первую фразу и на каждую новую строку.
    const text = count === 0 ? open : lines[count - 1]?.text;
    if (!text || said.current === count) return;
    said.current = count;
    life.say('advisor', speechSeconds(text) * (count === 0 ? 1 : 0.8));
  }, [count, open, lines, life]);
  if (!rep) return null;
  return (
    <div className="ch-talk ch-court" role="dialog" aria-label="Доклад советника">
      <div className="ch-talk-head">
        <b>{ADVISOR_NAME[faith]}</b>
        <small>советник, с докладом</small>
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
      <p
        className="ch-talk-line"
        onClick={() => {
          typed.skip();
          setCount(lines.length);
        }}
      >
        {open.slice(0, typed.shown)}
        <span className="ch-talk-rest" aria-hidden="true">
          {open.slice(typed.shown)}
        </span>
      </p>
      <div className="ch-report" role="list">
        {lines.slice(0, count).map((l) => (
          <button key={l.key} role="listitem" className={`ch-report-row ${l.tone}${rep.opened.has(l.key) ? ' read' : ''}`} onClick={() => court.openLine(l.key)}>
            <i aria-hidden="true" />
            <span>{l.text}</span>
            <b aria-hidden="true">›</b>
          </button>
        ))}
      </div>
      <div className="ch-talk-opts on">
        <button onClick={() => court.dismiss()}>Ступай</button>
      </div>
    </div>
  );
}
