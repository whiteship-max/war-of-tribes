// Черты армии в «Дружине» (ДР-4, docs/siege_v2.md, «Решения ДР-4», Ш10): до трёх строк — шрамы и привычки по журналу боёв;
// касание раскрывает, как черта получена, что даёт, как уходит и в счёт ли она в войне с соседями. Своей арифметики нет: черты —
// `sim/scars`, правила — `game/scarrules`, слова — `game/scarwords`. Каталога нет, как у черт агентов: видны только полученные.
import { useState } from 'react';
import { useGame } from '@/game/store';
import { scarsNow, warScarsNow } from '@/game/sim/scars';
import { SCAR_BY_ID, type ScarId } from '@/game/scarrules';
import { EFFECT_WORDS, SURE_WORDS, WAR_BLIND, activeWords, edgeLines, gainWords, loseWords } from '@/game/scarwords';
import { Icon } from '@/ui/icons/Icon';
import { signed } from './signed';

/** В счёт ли черта в войне с соседями (Ш6): у сервера свой журнал — бои войны. */
function warWords(id: ScarId, mine: boolean, war: boolean): string {
  if (WAR_BLIND.includes(SCAR_BY_ID[id].theme)) return 'Не действует: ночи, зимы и голода у боя войны сервер не судит.';
  if (mine && war) return 'В счёт: заслужена в боях войны, их видел сервер.';
  if (mine) return 'Не в счёт: получена в боях, которых сервер не видел.';
  return 'Держится: сервер помнит её по боям войны, а своими боями дружина её уже избыла.';
}

/** Первая буква — заглавная: слова черт — середина фразы летописи, а в разборе они начинают строку. */
const cap = (t: string): string => t.charAt(0).toUpperCase() + t.slice(1);

/** Одна черта: строка и разбор касанием. */
function ScarRow({ id, mine, war }: { id: ScarId; mine: boolean; war: boolean }) {
  const [open, setOpen] = useState(false);
  const def = SCAR_BY_ID[id];
  return (
    <div className={`dr-scar${def.good ? ' good' : ' bad'}${mine ? '' : ' war-only'}`}>
      <button type="button" className="dr-scar-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="ic">
          <Icon name="ui-star" state={def.good ? undefined : 'off'} />
        </span>
        <span className="dr-scar-name">
          <b>{def.name}</b>
          <small>
            {def.good ? 'добрая' : 'дурная'} · {activeWords(id)}
            {mine ? '' : ' · только в войне'}
          </small>
        </span>
        <Icon name={open ? 'ui-up' : 'ui-down'} />
      </button>
      {open && (
        <dl className="dr-scar-why">
          <dt>Как получена</dt>
          <dd>{cap(gainWords(id))}.</dd>
          <dt>Что даёт</dt>
          <dd>
            {cap(EFFECT_WORDS[id])}.
            {edgeLines(id, (n) => signed(n, 2)).map((line) => (
              <span key={line} className="dr-scar-num">
                {cap(line)} (в отметках)
              </span>
            ))}
          </dd>
          <dt>{def.good ? 'От чего уйдёт' : 'Как снять'}</dt>
          <dd>
            {cap(loseWords(id))}.{def.lose === 'sureOrGeneral' || def.lose === 'sureFed' ? ` ${cap(SURE_WORDS)}.` : ''}
          </dd>
          <dt>Война с соседями</dt>
          <dd>{warWords(id, mine, war)}</dd>
        </dl>
      )}
    </div>
  );
}

/** Раздел «Черты»: свои черты и те, что держатся только в войне; нет — одна строка о том, откуда они берутся. */
export function ScarList() {
  const s = useGame((g) => g.s);
  const mine = scarsNow(s).map((h) => h.id);
  const war = warScarsNow(s).map((h) => h.id);
  const only = war.filter((id) => !mine.includes(id));
  if (mine.length === 0 && only.length === 0) {
    return (
      <p className="note">
        Черт нет. Армия получает их своими боями — в лесу, у реки, в холмах, у стен, ночью, зимой, на голодный желудок — и так же их
        теряет. Разом — не больше трёх.
      </p>
    );
  }
  return (
    <section className="dr-scars" aria-label="Черты армии">
      {mine.map((id) => (
        <ScarRow key={id} id={id} mine war={war.includes(id)} />
      ))}
      {only.map((id) => (
        <ScarRow key={`war-${id}`} id={id} mine={false} war />
      ))}
    </section>
  );
}
