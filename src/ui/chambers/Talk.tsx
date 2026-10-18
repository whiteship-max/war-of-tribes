// Окно разговора в покоях (docs/city_v3.md, Г-7): кто говорит, его реплика (проступает по буквам, касание — сразу
// целиком) и три-пять ответов правителя. Просьба — сцена в покоях (`life.order`), прощание — человек уходит; крестик —
// помолчать: человек остаётся, касание по нему — снова к разговору. Пока окно открыто, ноги правителя стоят
// (`room.frozen`), смотреть можно; закрылось — палец движения снова ведёт.
import { useEffect, useRef, useState } from 'react';
import type { ChambersLife, Who, Why } from '@/render/chambers/life';
import { opening, reply, TEMPER_NAME, type OptionId, type TalkCtx, type TalkMemory, type TalkTurn } from './talk';

/** Буквы в секунду: реплика проступает, как говорится. */
const CPS = 46;
/** Сколько последняя реплика стоит на экране, когда разговор кончился, с. */
const LINGER = 1.7;

/** Сколько секунд говорить реплику (голос без слов — столько же). */
export const speechSeconds = (line: string): number => Math.min(5.5, 0.6 + line.length / 15);

/** Своя доля хода 0…1: из памяти и номера хода — разговор не повторяется один в один, а случайности устройства нет. */
export function rollOf(mem: TalkMemory, n: number): number {
  const s = mem.visits * 7.13 + n * 13.37 + mem.servant.cat + mem.servant.wine * 3 + mem.wife.visits * 5 + mem.maid.pours * 11;
  const x = Math.sin(s * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

export interface TalkProps {
  life: ChambersLife;
  who: Who;
  why: Why;
  /** Всё, что разговору видно о мире, кроме памяти и броска. */
  base: () => Omit<TalkCtx, 'who' | 'why' | 'mem' | 'roll'>;
  memory: () => TalkMemory;
  remember: (m: TalkMemory) => void;
  /** Разговор кончился (просьба, прощание, крестик). */
  onDone: () => void;
}

const ROLE: Record<Who, string> = { servant: 'старый слуга', maid: 'служанка', wife: 'супруга' };

export function Talk({ life, who, why, base, memory, remember, onDone }: TalkProps) {
  const [turn, setTurn] = useState<TalkTurn | null>(null);
  const [shown, setShown] = useState(0);
  const n = useRef(0);
  const done = useRef(false);
  const ctx = (): TalkCtx => ({ ...base(), who, why, mem: memory(), roll: rollOf(memory(), n.current) });

  const show = (t: TalkTurn): void => {
    n.current++;
    remember(t.mem);
    setTurn(t);
    setShown(0);
    life.say(who, speechSeconds(t.line));
  };

  // Подошёл — первая реплика.
  useEffect(() => {
    done.current = false;
    show(opening(ctx()));
    // Новый разговор — по новому «кто и зачем».
  }, [who, why]); // eslint-disable-line react-hooks/exhaustive-deps

  // Реплика проступает по буквам (не цикл кадра — редкий таймер окна).
  useEffect(() => {
    if (!turn || shown >= turn.line.length) return;
    const t = window.setTimeout(() => setShown((s) => Math.min(turn.line.length, s + 2)), 2000 / CPS);
    return () => window.clearTimeout(t);
  }, [turn, shown]);

  // Конец разговора: реплика стоит, потом окно закрывается.
  useEffect(() => {
    if (!turn?.end) return;
    const t = window.setTimeout(onDone, (Math.max(LINGER, speechSeconds(turn.line) * 0.7) + 0.2) * 1000);
    return () => window.clearTimeout(t);
  }, [turn, onDone]);

  const choose = (id: OptionId): void => {
    if (done.current) return;
    const r = reply(ctx(), id);
    if (r.end) done.current = true;
    if (r.order) life.order(r.order);
    show(r);
  };

  const close = (): void => {
    done.current = true;
    life.endTalk();
    onDone();
  };

  if (!turn) return null;
  const c = base();
  const name = who === 'wife' ? c.wife.name : who === 'maid' ? c.maid : c.servant;
  const role = who === 'wife' ? `${ROLE.wife}, ${TEMPER_NAME[c.wife.temper]}` : ROLE[who];
  const full = shown >= turn.line.length;
  return (
    <div className="ch-talk" role="dialog" aria-label={`Разговор: ${name}`}>
      <div className="ch-talk-head">
        <b>{name}</b>
        <small>{role}</small>
        {!turn.end && (
          <button className="ch-talk-x" onClick={close} aria-label="Помолчать">
            ×
          </button>
        )}
      </div>
      <p className="ch-talk-line" onClick={() => setShown(turn.line.length)}>
        {turn.line.slice(0, shown)}
        <span className="ch-talk-rest" aria-hidden="true">
          {turn.line.slice(shown)}
        </span>
      </p>
      {!turn.end && (
        <div className={`ch-talk-opts${full ? ' on' : ''}`}>
          {turn.options.map((o) => (
            <button key={o.id} disabled={!full} onClick={() => choose(o.id)}>
              {o.text}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
