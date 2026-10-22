// Сословия — раздел Ратуши (РТ-2, docs/stability.md, «РТ-2»). Сверху — специализация города и доли влияния пяти сословий одной
// полосой с отметкой перевеса; ниже — пять карточек: герб, имя, лояльность словом и числом, привилегии кружками, полосы влияния и
// лояльности с порогами и что сословие делает с городом сейчас. Касание карточки — лист сословия: что даёт и чем платит город,
// ропот и перевес, привилегии с примеркой «что изменится», дар, указ сословия, разбор лояльности и влияния.
//
// Своих чисел нет (правило 18): мерка — `derived.estatesNow`, вид — `ui/next/estates`, дела — дверь `sim/estates`.
import './estates.css';
import { useState } from 'react';
import type { EstateId } from '@/game/types';
import { useGame } from '@/game/store';
import { ESTATE_META, LOYALTY_WORD, estateVerb } from '@/game/data/estates';
import { ESTATE_TEXT, ESTATES_HINT } from '@/game/data/estateWords';
import { ESTATES, ESTATE_DOMINANT, PRIV_MAX } from '@/game/estaterules';
import { estateGiftPrice, estatesNow } from '@/game/derived';
import { giftBlock, giftEstate, grantBlock, grantPrivilege, revokeBlock, revokePrivilege } from '@/game/sim/estates';
import { hintSeen, hintsOff, markHint } from '@/game/sim/hints';
import { asGame } from '@/game/pace';
import { Icon } from '@/ui/icons/Icon';
import { Btn } from '@/ui/kit/Btn';
import { SheetPage } from '@/ui/kit/SheetPage';
import { goTo } from '@/ui/kit/nav';
import { Cost } from '@/ui/parts/Cost';
import { signed } from '@/ui/parts/signed';
import { waitLeft } from '@/ui/parts/wait';
import {
  ESTATE_NUMBERS,
  cityOf,
  estateDecreeOf,
  estateRows,
  giftLeft,
  giftPreview,
  grantPreview,
  influenceParts,
  leverWords,
  loyaltyLines,
  loyaltyState,
  type EstateRow,
  type Preview,
} from './estates';

/** Раздел «Сословия». */
export function HallEstates() {
  const s = useGame((g) => g.s);
  const act = useGame((g) => g.act);
  const [pick, setPick] = useState<EstateId | null>(null);
  const rows = estateRows(s);
  const fresh = !hintSeen(s, 'estates') && !hintsOff(s);
  return (
    <div className="es">
      {fresh && (
        <div className="es-hint" role="note">
          <b>{ESTATES_HINT.title}</b>
          <p>{ESTATES_HINT.body}</p>
          <Btn
            onClick={() =>
              act((g) => {
                markHint(g, 'estates');
                return null;
              })
            }
          >
            Понятно
          </Btn>
        </div>
      )}
      <CityBand rows={rows} />
      {rows.map((r) => (
        <EstateCard key={r.id} r={r} onPick={() => setPick(r.id)} />
      ))}
      {pick && <EstateSheet e={pick} onClose={() => setPick(null)} />}
    </div>
  );
}

/** Специализация города и доли влияния одной полосой: сословия по порядку, отметка — перевес. */
function CityBand({ rows }: { rows: EstateRow[] }) {
  const s = useGame((g) => g.s);
  const city = cityOf(s);
  const lead = city.lead ? ESTATE_META[city.lead] : null;
  return (
    <div className={`es-city${city.lead ? ` ${city.lead}` : ''}`}>
      <span className="es-city-crest">{lead ? <Icon name={lead.icon} /> : <Icon name="ui-scales" />}</span>
      <div className="es-city-body">
        <b className="one-line">{city.name}</b>
        <small className="one-line">
          {city.dominant
            ? `${ESTATE_META[city.dominant].name} в перевесе: ${Math.round(city.infl)} % — ${estateVerb(city.dominant, 'требует', 'требуют')} больше`
            : lead
              ? `${lead.name} ${estateVerb(city.lead!, 'держит', 'держат')} ${Math.round(city.infl)} % влияния`
              : `Ни одно сословие не держит перевеса`}
        </small>
        <span className="es-share" aria-label="Доли влияния">
          {rows.map((r) => (
            <i key={r.id} className={`es-seg ${r.id}`} style={{ width: `${r.infl}%` }} title={`${r.name}: ${Math.round(r.infl)} %`} />
          ))}
          <em className="es-mark" style={{ left: `${ESTATE_DOMINANT}%` }} aria-hidden="true" />
        </span>
      </div>
    </div>
  );
}

/** Кружки привилегий: ●● — обе дарованы. */
const pips = (n: number): string => '●'.repeat(n) + '○'.repeat(Math.max(0, PRIV_MAX - n));

function Bars({ infl, loyalty }: { infl: number; loyalty: number }) {
  return (
    <span className="es-bars">
      <span className="es-bar infl" aria-label={`Влияние ${Math.round(infl)} %`}>
        <small>Влияние</small>
        <i>
          <i style={{ width: `${Math.max(0, Math.min(100, infl))}%` }} />
          <em style={{ left: `${ESTATE_DOMINANT}%` }} />
        </i>
        <b>{Math.round(infl)}&nbsp;%</b>
      </span>
      <span className={`es-bar loyal ${loyaltyState(loyalty)}`} aria-label={`Лояльность ${Math.floor(loyalty)}`}>
        <small>Лояльность</small>
        <i>
          <i style={{ width: `${Math.max(0, Math.min(100, loyalty))}%` }} />
          <em style={{ left: `${ESTATE_NUMBERS.disloyal}%` }} />
          <em style={{ left: `${ESTATE_NUMBERS.loyal}%` }} />
        </i>
        <b>{Math.floor(loyalty)}</b>
      </span>
    </span>
  );
}

function EstateCard({ r, onPick }: { r: EstateRow; onPick: () => void }) {
  return (
    <button type="button" className={`es-card ${r.id}${r.dominant ? ' dominant' : ''}`} onClick={onPick} aria-label={`${r.name}: лояльность ${Math.floor(r.loyalty)}`}>
      <span className="es-crest">
        <Icon name={r.icon} />
      </span>
      <span className="es-body">
        <span className="es-head">
          <b className="one-line">{r.name}</b>
          <i className="es-pips" title="Привилегии">
            {pips(r.priv)}
          </i>
          <span className={`es-state ${r.state}`}>{LOYALTY_WORD[r.state]}</span>
        </span>
        <Bars infl={r.infl} loyalty={r.loyalty} />
        <span className="es-fx one-line">
          {r.strong ? (
            <>
              <span className="pos">{r.plus}</span>
              <span className="neg">{r.minus}</span>
            </>
          ) : (
            <span className="muted">Без силы: доля не выше ровной</span>
          )}
          {r.decree && <span className="es-tag">указ</span>}
          {r.murmur > 0.05 && <span className="es-tag bad">ропот +{Math.round(r.murmur)} %</span>}
        </span>
      </span>
      <i className="es-go" aria-hidden="true">
        ›
      </i>
    </button>
  );
}

/** «Что изменится»: лояльность и влияние, что сдвинутся заметно. */
function PreviewRows({ p }: { p: Preview }) {
  const moved = p.rows.filter((r) => Math.abs(r.loyalty[1] - r.loyalty[0]) >= 0.5 || Math.abs(r.infl[1] - r.infl[0]) >= 0.5);
  if (moved.length === 0) return null;
  return (
    <ul className="es-preview">
      {moved.map((r) => {
        const dl = r.loyalty[1] - r.loyalty[0];
        const di = r.infl[1] - r.infl[0];
        return (
          <li key={r.id}>
            <Icon name={ESTATE_META[r.id].icon} />
            <span className="one-line">{r.name}</span>
            {Math.abs(dl) >= 0.5 && <b className={dl > 0 ? 'pos' : 'neg'}>лояльность {signed(dl, 0)}</b>}
            {Math.abs(di) >= 0.5 && <small>влияние {Math.round(r.infl[0])} → {Math.round(r.infl[1])} %</small>}
          </li>
        );
      })}
    </ul>
  );
}

/** Лист сословия поверх окна Ратуши. */
function EstateSheet({ e, onClose }: { e: EstateId; onClose: () => void }) {
  const s = useGame((g) => g.s);
  const act = useGame((g) => g.act);
  const m = ESTATE_META[e];
  const t = ESTATE_TEXT[e];
  const n = estatesNow(s)[e];
  const w = leverWords(e, n);
  const row = estateRows(s).find((r) => r.id === e)!;
  const priv = row.priv;
  const decree = estateDecreeOf(s, e);
  const price = estateGiftPrice(s, e);
  const left = giftLeft(s, e);
  const inf = influenceParts(s, e);
  const [peek, setPeek] = useState<'grant' | null>(null);
  return (
    <>
      <div className="hall-veil" onClick={onClose} />
      <div className={`hall-card es-sheet ${e}`} role="dialog" aria-label={m.name}>
        <SheetPage icon={m.icon} title={m.name} sub={t.who} onClose={onClose}>
          <Bars infl={n.infl} loyalty={n.loyalty} />
          <p className={`es-lead ${row.state}`}>
            {LOYALTY_WORD[row.state]}: {row.state === 'loyal' ? 'сословие за правителя, его указ открыт.' : row.state === 'disloyal' ? 'сословие ропщет и злит податных.' : 'сословие ждёт, чью сторону вы примете.'}
          </p>

          <h4>Что даёт городу</h4>
          {n.strength > 0 ? (
            <ul className="es-lines">
              <li className="pos">
                <Icon name={m.icon} />
                <span>{w.plusFull}</span>
              </li>
              <li className="neg">
                <Icon name="ui-warning" />
                <span>{w.minusFull}</span>
              </li>
            </ul>
          ) : (
            <p className="es-note">
              Влияние не выше ровной доли — сословие не правит своим делом. Сила приходит с влиянием выше {Math.round(100 / ESTATES.length)} % или с его указом: {t.plus}, а платит город — {t.minus}.
            </p>
          )}
          {row.murmur > 0.05 && (
            <p className="es-warn">
              <Icon name="nav-people" />
              <span>
                Ропот: +{Math.round(row.murmur)} % к недовольству податных.{' '}
                <button type="button" className="es-link" onClick={() => goTo({ kind: 'realm', view: 'stability' })}>
                  Стабильность ›
                </button>
              </span>
            </p>
          )}
          {row.dominant && (
            <p className="es-warn">
              <Icon name="ui-warning" />
              <span>Перевес: больше половины влияния — сословие требует больше, лояльность {signed(n.parts.greed, 0)}.</span>
            </p>
          )}

          <h4>
            Привилегии <span className="muted">{priv} из {PRIV_MAX}</span>
          </h4>
          {m.priv.map((name, i) => {
            const granted = i < priv;
            const next = i === priv;
            const last = i === priv - 1;
            return (
              <div key={name} className={`es-priv${granted ? ' on' : ''}`}>
                <span className="es-priv-body">
                  <b className="one-line">{name}</b>
                  <small>{t.priv[i]}</small>
                </span>
                {next && (
                  <Btn kind="main" why={grantBlock(s, e)} onClick={() => (peek === 'grant' ? act((g) => grantPrivilege(g, e)) && setPeek(null) : setPeek('grant'))}>
                    {peek === 'grant' ? 'Даровать' : 'Что даст?'}
                  </Btn>
                )}
                {last && (
                  <Btn confirm why={revokeBlock(s, e)} onClick={() => act((g) => revokePrivilege(g, e)) && setPeek(null)}>
                    Отнять
                  </Btn>
                )}
                {granted && !last && <small className="pos">дарована</small>}
              </div>
            );
          })}
          {peek === 'grant' && <PreviewRows p={grantPreview(s, e)} />}
          {priv > 0 && peek !== 'grant' && (
            <p className="es-note">
              Отнять — власть вернётся городу, а {m.name.toLowerCase()} {estateVerb(e, 'будет', 'будут')} помнить обиду сезон: лояльность {signed(-ESTATE_NUMBERS.own, 0)}.
            </p>
          )}

          <h4>Дар</h4>
          <div className="es-gift">
            <span className="es-priv-body">
              <small>
                Лояльность {signed(ESTATE_NUMBERS.own, 0)} на сезон, без власти. {left > 0 ? `Дар держится ещё ${waitLeft(asGame(left))} — новый продлит.` : 'Повтор продлевает, а не складывает.'}
              </small>
              <Cost cost={price} />
            </span>
            <Btn why={giftBlock(s, e)} onClick={() => act((g) => giftEstate(g, e))}>
              Одарить
            </Btn>
          </div>
          {peek !== 'grant' && <PreviewRows p={giftPreview(s, e)} />}

          <h4>Указ сословия</h4>
          <div className={`es-decree${decree.on ? ' on' : ''}`}>
            <Icon name={m.icon} />
            <span className="es-priv-body">
              <b className="one-line">{decree.name}</b>
              <small>{decree.effect}</small>
            </span>
            {decree.on ? (
              <small className="pos">действует</small>
            ) : (
              <Btn kind="link" why={decree.why ? `Откроет лояльность ${ESTATE_NUMBERS.loyal}` : null} onClick={() => goTo({ kind: 'realm', view: 'government' })}>
                В Указы
              </Btn>
            )}
          </div>

          <h4>Лояльность: что влияет</h4>
          <ul className="es-break">
            {loyaltyLines(s, e).map((l, i) => (
              <li key={i}>
                {l.icon ? <Icon name={l.icon} /> : <i />}
                <span className="one-line">{l.label}</span>
                <b className={i === 0 ? '' : l.value > 0 ? 'pos' : 'neg'}>{i === 0 ? Math.round(l.value) : signed(l.value, Number.isInteger(l.value) ? 0 : 2)}</b>
              </li>
            ))}
            <li className="sum">
              <i />
              <span>Итого</span>
              <b>{Math.floor(n.loyalty)}</b>
            </li>
          </ul>

          <h4>Влияние: откуда</h4>
          <p className="es-note">
            {inf.halls.map((h) => `${h.name} ${h.level}`).join(', ')} — средний уровень {inf.mean.toFixed(1).replace('.', ',')}
            {inf.priv > 0 ? `; привилегии — ${inf.privShare} % власти` : ''}. Всего {Math.round(n.infl)} %.
          </p>
        </SheetPage>
      </div>
    </>
  );
}
