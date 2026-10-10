// Итог донесения о бое нового интерфейса (docs/ui_audit.md, 13). Ролик, журнал по фазам и выбор «итог или бой» —
// общие с прежним видом и живут в `panels/ReportPanel`; здесь только итог.
import { useState, type CSSProperties } from 'react';
import { useGame } from '@/game/store';
import { summarize, type Side } from '@/battle';
import { beastSummary } from '@/game/battle/beasts';
import { fallenText } from '@/game/sim/expedition';
import { formatCoord } from '@/world/geo';
import type { Report } from '@/world/types';
import { lootText, unitsText } from '@/ui/parts/reportWords';
import { Icon } from '@/ui/icons/Icon';
import { SIDE_VARS } from '@/side';
import { profileCity, profileName } from '@/profile/identity';
import { reportCard } from '@/ui/share/shareCard';
import { ShareSheet } from '@/ui/share/ShareSheet';

const other = (side: Side): Side => (side === 'attacker' ? 'defender' : 'attacker');
/** Цвет сторон — одна дверь (`side.ts`): переменные стиля столбцов «Мы» и «Враг». */
const SIDES_STYLE = SIDE_VARS as CSSProperties;

/**
 * Итог нового вида (docs/ui_audit.md, 13): полоса исхода цветом исхода, где это было, силы двух сторон столбцами в цвете
 * стороны (`side.ts`), размен, почему так вышло — строками со значком, что ушло и что вернулось — ячейками. Числа те же,
 * что у прежнего итога: из журнала боя (`summarize`, `beastSummary`) и из донесения мира.
 */
export function ReportBodyNew({ report }: { report: Report }) {
  const s = useGame((g) => g.s);
  const rec = report.battle;
  const sum = rec ? beastSummary(summarize(rec.result, rec.us), rec.beasts, rec.us) : null;
  const ours = rec ? rec.result.sides[rec.us].total : null;
  const foes = rec ? rec.result.sides[other(rec.us)].total : null;
  const good = sum ? sum.verdict === 'victory' : report.won;
  const bad = sum ? sum.verdict === 'defeat' || sum.verdict === 'pyrrhic' : !report.won;
  const lost = Object.keys(report.lost).length > 0;
  // «Поделиться» (docs/feed.md, раздел 3): итог боя или взятый город — карточкой в чат или историю.
  const card = reportCard(report, profileCity(s.profile), profileName(s.profile));
  const [sharing, setSharing] = useState(false);

  return (
    <div className="nx-rep" style={SIDES_STYLE}>
      <div className={`nx-verdict${good ? ' good' : bad ? ' bad' : ''}`}>
        <b>{sum ? sum.title : report.title}</b>
        <small className="one-line">
          {report.target.name} · {formatCoord(report.target)}
        </small>
      </div>
      <p className="nx-rtext">{report.text}</p>

      {sum && ours && foes && (
        <>
          <div className="nx-forces">
            <div className="nx-fside ours">
              <small>Мы</small>
              <b>
                {ours.initial} → {ours.final}
              </b>
              <em>потери {ours.losses}</em>
            </div>
            <div className="nx-fside foe">
              <small>Враг</small>
              <b>
                {foes.initial} → {foes.final}
              </b>
              <em>потери {foes.losses}</em>
            </div>
          </div>
          <p className={`nx-rtext${bad ? ' bad' : ''}`}>{sum.reason}</p>
          {sum.keys.length > 0 && (
            <>
              <h4 className="nx-rh">Почему так вышло</h4>
              {sum.keys.map((k, i) => (
                <div className={`nx-rkey${k.good ? ' good' : ' bad'}`} key={i}>
                  <Icon name={k.art} glyph={k.icon} />
                  <span>{k.text}</span>
                </div>
              ))}
            </>
          )}
        </>
      )}

      <div className="nx-rfacts">
        <div>
          <small>Ушли</small>
          <b>{unitsText(report.sent)}</b>
        </div>
        <div>
          <small>
            <Icon name="ui-grave" glyph="⚰️" /> Не вернулись
          </small>
          <b className={lost ? 'bad' : ''}>{lost ? unitsText(report.lost) : 'нет'}</b>
        </div>
        {report.rearThrough && (report.rearThrough.passed < report.rearThrough.went || (report.through && report.through.passed < report.through.went)) && (
          <div>
            <small>Пробились с тыла</small>
            <b>
              {report.rearThrough.passed} из {report.rearThrough.went}
            </b>
          </div>
        )}
        {report.through && (report.through.passed < report.through.went || (report.rearThrough && report.rearThrough.passed < report.rearThrough.went)) && (
          <div>
            <small>{report.rearThrough ? 'Пробились со стороны города' : 'Пробились к рогаткам'}</small>
            <b>
              {report.through.passed} из {report.through.went}
            </b>
          </div>
        )}
        {(report.hidden ?? 0) > 0 && (
          <div>
            <small>Уцелело в тайнике</small>
            <b>{report.hidden}</b>
          </div>
        )}
        {report.loot && (
          <div className="wide">
            <small>
              <Icon name="ui-loot" glyph="📦" /> Добыча
            </small>
            <b className="good">{lootText(report.loot)}</b>
          </div>
        )}
        {report.fallen && report.fallen.length > 0 && (
          <div className="wide">
            <small>Постройки</small>
            <b className="bad">{fallenText(s, report.fallen)}</b>
          </div>
        )}
      </div>
      {card && (
        <button className="btn nx-rshare" onClick={() => setSharing(true)}>
          Поделиться
        </button>
      )}
      {card && sharing && <ShareSheet card={card} onClose={() => setSharing(false)} />}
    </div>
  );
}
