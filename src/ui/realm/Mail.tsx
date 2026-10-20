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
import { activeBoons } from '@/game/derived';
import { boonWords } from '@/game/data/boons';
import { realSeconds } from '@/game/pace';
import type { GameState } from '@/game/types';
import { RHUMB_WORDS } from '@/world/data/letters';
import type { LetterView } from '@/world/types';
import { Icon } from '@/ui/icons/Icon';
import { Cost } from '@/ui/parts/Cost';
import { useRaidWords } from '@/ui/parts/raidWords';
import { dispatches, filterMail, leftWords, mailGroups, type Dispatch, type MailFilter } from './dispatch';
import { endWords, type ProposalAct } from '@/world/proposals';
import { Table, type Col } from '@/ui/kit/Table';
import { Tabs, type TabDef } from '@/ui/kit/SheetPage';
import { goTo } from '@/ui/kit/nav';
import { WINDOW } from '@/ui/kit/sources';
import { useRealm, type MailTab } from './open';
import { Chronicle } from './Chronicle';
import { ReportPanel } from '@/ui/panels/ReportPanel';
import { mailKeys, rivalKeys, useSeen } from './unread';

/**
 * Единственная дверь ответа: отдаёт ответ хозяину донесения и возвращает исход
 * словами. Событие закрывает партия (`sim/mail.resolveEvent`), письмо — мир
 * (`answerLetter`); исход письма — та строка, что ляжет в летопись.
 */
async function answerDispatch(d: Dispatch, choiceId: string): Promise<string | null> {
  if (d.source === 'event') return d.eventId ? useGame.getState().resolve(Number(choiceId), d.eventId) : null;
  // Предложение соседа (ДП-1): ответ судит сервер войны; итог — словами стороны, отказ — словами сервера.
  if (d.source === 'rival') {
    if (!d.dealId) return null;
    const err = await useWorld.getState().answerProposal(d.dealId, choiceId as ProposalAct);
    if (err) return err;
    const p = useWorld.getState().rivals.proposals.find((x) => x.id === d.dealId);
    return p?.end ? endWords(p) : (d.choices.find((c) => c.id === choiceId)?.hint ?? null);
  }
  if (!d.letterId) return null;
  const err = await useWorld.getState().answerLetter(d.letterId, choiceId === 'yes' ? 'yes' : 'no');
  if (err) return null;
  return d.choices.find((c) => c.id === choiceId)?.hint ?? null;
}

/** Столбцы списка: весть со значком и точкой новой, кто прислал — строкой под ней, срок — до того, как решится сама. */
const MAIL_COLS: readonly Col[] = [
  { key: 'what', title: 'Весть' },
  { key: 'left', title: 'Срок', align: 'right', w: '88px' },
];

export function Mail() {
  const s = useGame((g) => g.s);
  // Слова — пачки 14 (docs/ui_texts.md): «вести», «город»; «новое» — точкой.
  const letters = useWorld((w) => w.letters);
  const rivals = useWorld((w) => w.rivals);
  const open = useRealm((r) => r.mail);
  const openMail = useRealm((r) => r.openMail);
  const seen = useSeen((u) => u.seen);
  const mark = useSeen((u) => u.mark);
  const [done, setDone] = useState<{ title: string; text: string } | null>(null);
  // Вкладка — в хранилище державы: ссылка «Летопись» из «Заданий» открывает «Вести» сразу на ней (ВС-2).
  const tab = useRealm((r) => r.mailTab);
  const setTab = useRealm((r) => r.setMailTab);
  const report = useRealm((r) => r.report);
  const openChronicle = useRealm((r) => r.openChronicle);
  const [, retick] = useState(0);

  const list = dispatches(s, letters, { tribe: partyNow(), world: worldNow() }, rivals);
  const live = mailKeys(
    s.inbox,
    letters.map((l) => l.id),
    rivalKeys(rivals),
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
    return (
        <div className="nx-mail">
          <div className="nx-mhead">
            <span className="nx-mmed">
              <Icon name="ui-check" />
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

  if (current) {
    return (
      <DispatchCardNew
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

  // Донесение из летописи — тут же, в «Вестях»: итог, потери, «Смотреть бой» и «Смотреть осаду» (ВС-2). Ролики идут
  // поверх всего экрана своим слоем (`body.replaying`), «К донесению» возвращает сюда.
  if (report) {
    return (
      <div className="mail-report">
        <button type="button" className="nx-mback" onClick={() => openChronicle(null)}>
          ‹ К летописи
        </button>
        <ReportPanel id={report} />
      </div>
    );
  }

  // Ответ кнопкой прямо в строке (ДП-1): итог — всплывающей строкой, строка уходит из «Ждут ответа» в «К сведению».
  const quick = async (d: Dispatch, id: string): Promise<void> => {
    const text = await answerDispatch(d, id);
    mark(d.key, live);
    if (text) useGame.getState().showToast(text);
  };

  // Фильтр — по источнику, счётчик вкладки — новые в ней (как у низа: новое ждёт, чтобы его прочли).
  const fresh = (d: Dispatch): boolean => !seen.includes(d.key);
  const unseen = (f: MailFilter): number => filterMail(list, f).filter(fresh).length;
  const tabs: TabDef<MailTab>[] = [
    { id: 'all', label: 'Все', badge: unseen('all') },
    { id: 'event', label: 'Город', badge: unseen('event') },
    { id: 'letter', label: 'Соседи', badge: unseen('letter') },
    { id: 'chron', label: 'Летопись' },
  ];
  const filter: MailFilter = tab === 'chron' ? 'all' : tab;
  const inFilter = filterMail(list, filter);

  return (
    <div className="panel mail-v2">
      {tab !== 'chron' && <Boons s={s} />}
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'chron' && <Chronicle />}
      {tab !== 'chron' && list.length === 0 && (
        <div className="dispatch-empty">
          <div className="big">
            <Icon name="ui-mail" />
          </div>
          <b className="nx-empty">Вестей нет</b>
          <div className="note">Сюда приходят вести из города и от соседей. Без ответа каждая решится сама. Что уже было — в «Летописи».</div>
        </div>
      )}
      {tab !== 'chron' && list.length > 0 && inFilter.length === 0 && (
        <p className="note">{filter === 'event' ? 'Вестей из города нет.' : 'Писем от соседей нет.'}</p>
      )}
      {tab !== 'chron' && mailGroups(inFilter).map((g) => (
        <section key={g.id} className="mail-group">
          <h3>
            {g.title} <span className="muted">{g.items.length}</span>
          </h3>
          {g.items.some((d) => !d.quick) && <Table
            label={g.title}
            cols={MAIL_COLS}
            rows={g.items.filter((d) => !d.quick).map((d) => ({
              key: d.key,
              go: () => openMail(d.key),
              goLabel: d.title,
              cells: {
                what: (
                  <span className={`kit-name${fresh(d) ? ' fresh' : ''}`}>
                    <Icon name={d.iconName} />
                    <span className="kit-two">
                      <b className="one-line">{d.title}</b>
                      <small className="one-line">{d.from ?? (d.warning ? 'Дозор' : 'Город')}</small>
                    </span>
                    {fresh(d) && <i className="nx-new" aria-label="новое" />}
                  </span>
                ),
                left: d.left !== null ? <span className={d.urgent ? 'bad' : ''}>{leftWords(d.left)}</span> : '—',
              },
            }))}
          />}
          {g.items.filter((d) => d.quick).map((d) => (
            <QuickRow key={d.key} d={d} fresh={fresh(d)} onOpen={() => openMail(d.key)} onAnswer={(id) => quick(d, id)} />
          ))}
        </section>
      ))}
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
  const raids = useRaidWords();
  const raid = letter?.kind === 'raid' ? (raids.find((w) => w.win.march.id === letter.marchId) ?? null) : null;
  const from = letter?.from ?? null;
  const where = letter && from && !from.cell ? `${RHUMB_WORDS[from.rhumb]}, ${from.cells} кл., не разведано` : null;
  const asks = Object.values(d.cost).some((n) => (n ?? 0) > 0);
  // Беда идёт сама и сроком беды — красным; остальное ждёт ответа — охрой. Признак — у донесения (`dispatch.urgent`).
  const urgent = d.urgent;

  return (
    <div className="nx-mail">
      <div className="nx-mhead">
        <span className={`nx-mmed${urgent ? ' urgent' : ''}`}>
          <Icon name={d.iconName} />
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
            <Icon name="ui-spyglass" />
          </button>
        )}
      </div>
      {d.left !== null && (
        <div className={`nx-mdue${urgent ? ' urgent' : ''}`}>
          <Icon name="ui-time" />
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
        {/* Набег решается не здесь: перехватить в поле — на карте, гарнизон и отряд полководца — в «Дружине» (передача
            там с UI-4, docs/ui_v2.md, 5.3; прежде кнопка вела в Статую). Окно ответа — до прихода (`parts/raidWords`), и
            срок у кнопки тот же, что в строке набега. */}
        {(letter?.kind === 'raid' || d.march) && (
          <>
            <button className="nx-ans" onClick={() => openMap()}>
              <b>На карту</b>
              <small>Перехватить в поле</small>
            </button>
            <button className="nx-ans" onClick={() => goTo(WINDOW.army)}>
              <b>Дружина</b>
              <small>{['Гарнизон и отряд полководца', raid?.left].filter(Boolean).join(' · ')}</small>
            </button>
          </>
        )}
      </div>
      {d.silence && <p className="nx-msilence">{d.silence}</p>}
      <button className="nx-mback" onClick={onBack}>
        {d.choices.length > 0 ? 'Отложить' : 'К вестям'}
      </button>
    </div>
  );
}

/**
 * Строка с ответом прямо в ней (ДП-1): имя и срок — дверь в карточку, рядом кнопки ответа по 44. Кнопка в кнопке
 * недопустима (2.5), поэтому строка — ряд из двери и кнопок, а не строка таблицы. Погасшая кнопка — та же проверка, что у
 * сервера (`world/proposals.answerBlock`).
 */
function QuickRow({ d, fresh, onOpen, onAnswer }: { d: Dispatch; fresh: boolean; onOpen: () => void; onAnswer: (id: string) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="mail-quick">
      <button type="button" className="mail-quick-go" onClick={onOpen} aria-label={d.title}>
        <span className={`kit-name${fresh ? ' fresh' : ''}`}>
          <Icon name={d.iconName} />
          <span className="kit-two">
            <b className="one-line">{d.title}</b>
            <small className="one-line">{d.from}</small>
          </span>
          {fresh && <i className="nx-new" aria-label="новое" />}
        </span>
        {d.left !== null && <span className="mail-quick-left">{leftWords(d.left)}</span>}
        <i className="kit-go" aria-hidden="true">
          ›
        </i>
      </button>
      <div className="mail-quick-acts">
      {d.choices.map((c) => (
        <button
          key={c.id}
          type="button"
          className={`mail-quick-act${c.id === 'yes' ? ' yes' : ''}`}
          disabled={busy || c.block !== null}
          title={c.block ?? undefined}
          onClick={() => {
            setBusy(true);
            void onAnswer(c.id).finally(() => setBusy(false));
          }}
        >
          {c.label}
        </button>
      ))}
      </div>
    </div>
  );
}

/**
 * Что сейчас действует после ответов на вести (docs/events.md, раздел 3): значок, имя, что даёт и сколько ещё. Числа и
 * срок — из самого усилителя (`data/boons`, `derived.activeBoons`), строка своей арифметики не держит. Нет усилителей —
 * нет и строки.
 */
function Boons({ s }: { s: GameState }) {
  const on = activeBoons(s);
  if (on.length === 0) return null;
  return (
    <section className="mail-boons">
      <Table
        label="Действует"
        cols={BOON_COLS}
        rows={on.map(({ def, until }) => ({
          key: def.id,
          tip: () => ({ title: def.name, body: boonWords(def) }),
          cells: {
            what: (
              <span className="kit-name">
                <span className="ic"><Icon name={def.icon} /></span>
                <span className="one-line">{def.name}</span>
              </span>
            ),
            gives: <span className="muted one-line">{boonWords(def)}</span>,
            left: leftWords(realSeconds(until - s.time)),
          },
        }))}
      />
    </section>
  );
}

/** Столбцы «Действует»: усилитель, что даёт (целиком — касанием) и сколько ещё. */
const BOON_COLS: readonly Col[] = [
  { key: 'what', title: 'Действует' },
  { key: 'gives', title: 'Даёт', w: '120px' },
  { key: 'left', title: 'Ещё', align: 'right', w: '72px' },
];
