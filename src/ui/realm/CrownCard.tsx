// Окно вести державы (СБ-2, docs/stability.md, «СБ-2»): заставка-сцена, заголовок, кто пишет и когда, текст слогом
// летописи, ответы кнопками с ценой. Касание ответа раскрывает «что изменится» — стабильность, недовольство, очки, склад,
// вера, следствия, — решение — второй кнопкой: на телефоне наведения нет, и выбор вслепую здесь невозможен. Слова и числа
// — от хозяина вести (`dispatch.ts`, `crownView.ts`), здесь только вид.
import { useState } from 'react';
import { Icon } from '@/ui/icons/Icon';
import { Cost } from '@/ui/parts/Cost';
import type { RealmBranch } from '@/game/types';
import type { CrownKind } from '@/game/crownrules';
import { CrownScene } from './CrownScene';
import { BRANCH_ICON } from './branches';
import { leftWords, type Dispatch } from './dispatch';
import './crown.css';

/** Нрав вести словами — плашкой на заставке. */
const KIND_WORD: Record<CrownKind, string> = { good: 'Добрая весть', bad: 'Дурная весть', choice: 'Выбор', chain: 'Следствие' };

/** Цена очками — значками ветвей рядом с ценой склада. */
function Points({ points }: { points?: Partial<Record<RealmBranch, number>> }) {
  const list = Object.entries(points ?? {}).filter(([, n]) => (n ?? 0) > 0) as [RealmBranch, number][];
  if (list.length === 0) return null;
  return (
    <span className="cr-pts">
      {list.map(([b, n]) => (
        <span key={b}>
          <Icon name={BRANCH_ICON[b]} />
          {n}
        </span>
      ))}
    </span>
  );
}

export function CrownCard({ d, onBack, onAnswer }: { d: Dispatch; onBack: () => void; onAnswer: (id: string) => void }) {
  const [picked, setPicked] = useState<string | null>(null);
  const c = d.crown!;
  return (
    <div className="cr">
      <figure className={`cr-frame ${c.kind}`}>
        <CrownScene scene={c.scene} />
        <figcaption>{KIND_WORD[c.kind]}</figcaption>
      </figure>
      <header className="cr-head">
        <h2>{d.title}</h2>
        <small>
          {d.from} · {c.date}
        </small>
      </header>
      {d.left !== null && (
        <div className="nx-mdue">
          <Icon name="ui-time" />
          <span>{d.leftText}</span>
          <b>{leftWords(d.left)}</b>
        </div>
      )}
      <p className="cr-text">{d.text}</p>
      <div className="cr-opts">
        {d.choices.map((o) => {
          const on = picked === o.id;
          const priced = Object.values(o.cost).some((n) => (n ?? 0) > 0) || Object.values(o.points ?? {}).some((n) => (n ?? 0) > 0);
          return (
            <div key={o.id} className={`cr-opt${on ? ' on' : ''}${o.block ? ' off' : ''}`}>
              <button type="button" className="cr-pick" aria-expanded={on} onClick={() => setPicked(on ? null : o.id)}>
                <b>{o.label}</b>
                {priced && (
                  <span className="cr-price">
                    <Cost cost={o.cost} />
                    <Points points={o.points} />
                  </span>
                )}
                <i className="cr-mark" aria-hidden="true" />
              </button>
              {on && (
                <div className="cr-more">
                  <small>Что изменится</small>
                  {(o.lines ?? []).length === 0 ? (
                    <p className="cr-none">Ничего: всё останется как было.</p>
                  ) : (
                    <ul>
                      {(o.lines ?? []).map((l, i) => (
                        <li key={i} className={l.tone}>
                          <Icon name={l.icon} />
                          <span>{l.text}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {o.block ? (
                    <p className="cr-block">{o.block}</p>
                  ) : (
                    <button type="button" className="cr-go" onClick={() => onAnswer(o.id)}>
                      Так и решим
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {picked === null && <p className="cr-tip">Касание ответа покажет, что изменится; решение — второй кнопкой.</p>}
      {d.silence && <p className="nx-msilence">{d.silence}</p>}
      <button className="nx-mback" onClick={onBack}>
        Отложить
      </button>
    </div>
  );
}

/** Итог ответа на весть державы: та же заставка, исход словами летописи и что изменилось. */
export function CrownDone({ d, text, note, onBack }: { d: Dispatch; text: string; note: string; onBack: () => void }) {
  return (
    <div className="cr">
      <figure className={`cr-frame ${d.crown!.kind}`}>
        <CrownScene scene={d.crown!.scene} />
      </figure>
      <header className="cr-head">
        <h2>{d.title}</h2>
      </header>
      <p className="cr-text">{text}</p>
      {note && <p className="cr-note">{note}</p>}
      <button className="nx-mback" onClick={onBack}>
        К вестям
      </button>
    </div>
  );
}
