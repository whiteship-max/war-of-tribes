// Кольцо контрров одной картинкой: копья → конница → лучники → копья.
// Числа на стрелках берутся из `counterRing()`, то есть прямо из `COUNTER`, —
// нарисовать их руками значило бы завести вторую правду о балансе.
import { KIND_META } from '@/battle';
import { counterRing } from '@/game/battle/describe';

const CX = 150;
const CY = 94;
/** Радиус кольца и радиус узла. Подобраны под 375 px: картинка не скроллится вбок. */
const R = 58;
const NR = 27;

const ANGLE = { spear: -90, cavalry: 30, archer: 150 } as const;

const pt = (deg: number, r = R): [number, number] => [
  CX + r * Math.cos((deg * Math.PI) / 180),
  CY + r * Math.sin((deg * Math.PI) / 180),
];

export function CounterRing() {
  const ring = counterRing();
  return (
    <div className="ring-wrap">
      <svg className="ring" viewBox="0 0 300 196" role="img" aria-label="Кольцо контрров">
        <defs>
          <marker id="ring-head" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M0 0 L8 4 L0 8 z" fill="var(--accent)" />
          </marker>
        </defs>
        {ring.edges.map((e) => {
          const from = ANGLE[e.from as keyof typeof ANGLE];
          // Соседи стоят через 120°, дуга идёт от края одного узла к краю другого.
          const [sx, sy] = pt(from + 30);
          const [ex, ey] = pt(from + 90);
          const [lx, ly] = pt(from + 60, R + 28);
          return (
            <g key={`${e.from}-${e.to}`}>
              <path
                d={`M ${sx.toFixed(1)} ${sy.toFixed(1)} A ${R} ${R} 0 0 1 ${ex.toFixed(1)} ${ey.toFixed(1)}`}
                fill="none"
                stroke="var(--accent)"
                strokeWidth="2"
                markerEnd="url(#ring-head)"
                opacity={0.75}
              />
              <text className="ring-mult" x={lx} y={ly} textAnchor="middle">
                {e.text}
              </text>
            </g>
          );
        })}
        {(Object.keys(ANGLE) as (keyof typeof ANGLE)[]).map((k) => {
          const [x, y] = pt(ANGLE[k]);
          return (
            <g key={k}>
              <circle cx={x} cy={y} r={NR} className="ring-node" />
              <text className="ring-ico" x={x} y={y - 1} textAnchor="middle">
                {KIND_META[k].icon}
              </text>
              <text className="ring-name" x={x} y={y + 15} textAnchor="middle">
                {KIND_META[k].name}
              </text>
            </g>
          );
        })}
      </svg>

      <div className="mod-list">
        {ring.edges.map((e) => (
          <div className="mod" key={`l-${e.from}`}>
            <span className="ico">{KIND_META[e.from].icon}</span>
            <span className="name">
              {KIND_META[e.from].name} по {KIND_META[e.to].name.toLowerCase()}
              <em className="sub">{KIND_META[e.from].hint}</em>
            </span>
            <span className="val pos">{e.text}</span>
          </div>
        ))}
        <div className="mod">
          <span className="ico">{KIND_META[ring.aside.kind].icon}</span>
          <span className="name">
            {KIND_META[ring.aside.kind].name} — в стороне от кольца
            <em className="sub">{KIND_META[ring.aside.kind].hint}</em>
          </span>
          <span className="val">{ring.aside.text}</span>
        </div>
      </div>
    </div>
  );
}
