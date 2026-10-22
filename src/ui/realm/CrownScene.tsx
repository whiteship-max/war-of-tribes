// Заставка вести державы (СБ-2): сцена города или покоев, нарисованная кодом — небо, силуэты, свет. Чужих картинок нет;
// цвета — тёплая охра, умбра и ночная синь, как у диорамы. Едет куском «Вестей».
import type { CrownScene as Scene } from '@/game/data/crown';

/** Небо: верх и низ градиента. */
const SKY: Record<Scene, [string, string]> = {
  church: ['#2b2140', '#c9774a'],
  hall: ['#1d140d', '#3a2717'],
  chamber: ['#140e0a', '#2e2015'],
  square: ['#7fa3b8', '#e8c995'],
  market: ['#8db0c2', '#efd7a4'],
  field: ['#d9a35a', '#f2d48f'],
  sky: ['#070b1c', '#1c2440'],
  fire: ['#120a10', '#5a2414'],
  gate: ['#5d7a92', '#d8b98a'],
  road: ['#b9876a', '#f0c88c'],
  lists: ['#86aac0', '#ecd6a6'],
};

/** Силуэт городской стены с башнями и крышами — по низу кадра. */
function Town({ y, fill, lit }: { y: number; fill: string; lit?: string }) {
  const roofs = [
    [8, 26],
    [40, 18],
    [64, 34],
    [102, 22],
    [128, 40],
    [170, 20],
    [196, 30],
    [232, 24],
    [262, 38],
    [300, 22],
    [326, 30],
  ];
  return (
    <g>
      {roofs.map(([x, h], i) => (
        <path key={i} d={`M${x} ${y} L${x} ${y - h} L${x + 14} ${y - h - 12} L${x + 28} ${y - h} L${x + 28} ${y} Z`} fill={fill} />
      ))}
      <rect x="150" y={y - 58} width="14" height="58" fill={fill} />
      <path d={`M146 ${y - 58} L157 ${y - 76} L168 ${y - 58} Z`} fill={fill} />
      <rect x="0" y={y} width="360" height={150 - y} fill={fill} />
      {lit &&
        roofs.map(([x, h], i) => (i % 2 === 0 ? <rect key={`w${i}`} x={x + 10} y={y - h + 6} width="6" height="7" fill={lit} className="cs-flicker" /> : null))}
    </g>
  );
}

function Hills({ y, fill, far }: { y: number; fill: string; far?: string }) {
  return (
    <g>
      {far && <path d={`M0 ${y - 10} C60 ${y - 34} 120 ${y - 6} 190 ${y - 26} S310 ${y - 30} 360 ${y - 14} L360 150 L0 150 Z`} fill={far} />}
      <path d={`M0 ${y} C70 ${y - 18} 140 ${y + 6} 210 ${y - 10} S320 ${y - 4} 360 ${y - 12} L360 150 L0 150 Z`} fill={fill} />
    </g>
  );
}

/** Толпа: головы и плечи в ряд, у некоторых — огонёк свечи. */
function Crowd({ y, fill, candles, from = 20, to = 340 }: { y: number; fill: string; candles?: boolean; from?: number; to?: number }) {
  const out = [];
  for (let x = from, i = 0; x < to; x += 13, i++) {
    const h = 10 + ((i * 7) % 5);
    out.push(
      <g key={x}>
        <circle cx={x} cy={y - h - 4} r="4" fill={fill} />
        <path d={`M${x - 6} ${y} Q${x} ${y - h - 2} ${x + 6} ${y} Z`} fill={fill} />
        {candles && i % 3 === 0 && <circle cx={x + 5} cy={y - h - 6} r="1.8" fill="#ffd27a" className="cs-flicker" />}
      </g>,
    );
  }
  return <g>{out}</g>;
}

function Banner({ x, y, color, h = 34 }: { x: number; y: number; color: string; h?: number }) {
  return (
    <g>
      <rect x={x} y={y} width="2" height={h + 10} fill="#2a1a0e" />
      <path d={`M${x + 2} ${y + 2} L${x + 20} ${y + 2} L${x + 20} ${y + h} L${x + 11} ${y + h - 7} L${x + 2} ${y + h} Z`} fill={color} className="cs-sway" />
    </g>
  );
}

/** Сюжет сцены поверх неба. */
function Plot({ scene }: { scene: Scene }) {
  switch (scene) {
    case 'church':
      return (
        <g>
          <Hills y={128} fill="#3b2a22" far="#5a3c33" />
          <rect x="130" y="40" width="100" height="92" fill="#2d211a" />
          <path d="M124 42 L180 6 L236 42 Z" fill="#241a14" />
          <rect x="230" y="22" width="26" height="110" fill="#271c15" />
          <path d="M226 24 L243 0 L260 24 Z" fill="#20160f" />
          <path d="M168 120 L168 76 Q180 58 192 76 L192 120 Z" fill="#ffcf7a" className="cs-glow" />
          <circle cx="180" cy="56" r="9" fill="#ffd98e" className="cs-glow" />
          <Crowd y={148} fill="#1a120d" candles />
        </g>
      );
    case 'hall':
      return (
        <g>
          <rect x="0" y="0" width="360" height="150" fill="url(#cs-stone)" opacity="0.35" />
          {[20, 110, 250, 340].map((x) => (
            <rect key={x} x={x - 10} y="0" width="20" height="150" fill="#24180f" />
          ))}
          <path d="M30 0 Q70 60 110 0 Z M260 0 Q300 60 340 0 Z" fill="#160f09" />
          <Banner x={140} y={16} color="#8e2b20" h={52} />
          <Banner x={200} y={16} color="#c9973f" h={52} />
          <rect x="60" y="112" width="240" height="10" fill="#4a3220" />
          <rect x="70" y="122" width="6" height="28" fill="#3a2718" />
          <rect x="284" y="122" width="6" height="28" fill="#3a2718" />
          <rect x="166" y="70" width="28" height="42" fill="#3d2a1a" />
          <path d="M162 70 L180 56 L198 70 Z" fill="#c9973f" />
          <circle cx="44" cy="96" r="8" fill="#ff9f45" className="cs-flicker" />
          <circle cx="316" cy="96" r="8" fill="#ff9f45" className="cs-flicker" />
          <rect x="40" y="104" width="8" height="46" fill="#2a1c11" />
          <rect x="312" y="104" width="8" height="46" fill="#2a1c11" />
        </g>
      );
    case 'chamber':
      return (
        <g>
          <rect x="226" y="20" width="70" height="80" rx="34" fill="#16203c" />
          <circle cx="270" cy="44" r="7" fill="#e8e2c6" />
          <rect x="258" y="20" width="4" height="80" fill="#24180f" />
          <rect x="226" y="58" width="70" height="4" fill="#24180f" />
          <path d="M30 24 L170 24 L160 40 L40 40 Z" fill="#6b2219" />
          <rect x="34" y="40" width="6" height="96" fill="#3a2718" />
          <rect x="160" y="40" width="6" height="96" fill="#3a2718" />
          <path d="M40 40 Q60 90 44 120 L40 120 Z M160 40 Q140 90 156 120 L160 120 Z" fill="#7d2a1f" />
          <rect x="40" y="104" width="120" height="22" fill="#d9c7a0" />
          <rect x="40" y="96" width="34" height="12" rx="4" fill="#efe3c6" />
          <rect x="190" y="104" width="10" height="34" fill="#c9b48a" />
          <path d="M195 92 Q190 98 195 104 Q200 98 195 92 Z" fill="#ffcf6a" className="cs-flicker" />
          <circle cx="195" cy="98" r="18" fill="#ffb54a" opacity="0.12" className="cs-glow" />
          <rect x="0" y="136" width="360" height="14" fill="#1a110b" />
        </g>
      );
    case 'square':
      return (
        <g>
          <Town y={118} fill="#6f4f36" />
          <rect x="0" y="118" width="360" height="32" fill="#8c6a48" />
          <rect x="150" y="100" width="60" height="18" fill="#4a3220" />
          <circle cx="180" cy="84" r="5" fill="#2a1a0e" />
          <path d="M172 100 Q180 80 188 100 Z" fill="#2a1a0e" />
          <path d="M186 88 L198 78" stroke="#2a1a0e" strokeWidth="2.5" />
          <Crowd y={148} fill="#3a2718" />
        </g>
      );
    case 'market':
      return (
        <g>
          <Town y={104} fill="#7a5a3e" />
          <rect x="0" y="104" width="360" height="46" fill="#9a7650" />
          {[
            [20, '#a8392a'],
            [100, '#c9973f'],
            [180, '#3f6a8a'],
            [260, '#a8392a'],
          ].map(([x, c]) => (
            <g key={x as number}>
              <path d={`M${x} 96 L${(x as number) + 70} 96 L${(x as number) + 64} 112 L${(x as number) + 6} 112 Z`} fill={c as string} />
              <path d={`M${(x as number) + 12} 96 L${(x as number) + 18} 112 M${(x as number) + 34} 96 L${(x as number) + 35} 112 M${(x as number) + 56} 96 L${(x as number) + 52} 112`} stroke="#f2e2bc" strokeWidth="5" />
              <rect x={(x as number) + 8} y="112" width="4" height="22" fill="#3a2718" />
              <rect x={(x as number) + 58} y="112" width="4" height="22" fill="#3a2718" />
              <rect x={(x as number) + 10} y="124" width="50" height="10" fill="#5c3e26" />
              <circle cx={(x as number) + 22} cy="122" r="4" fill="#d79a3c" />
              <circle cx={(x as number) + 34} cy="122" r="4" fill="#9a3a2c" />
            </g>
          ))}
          <Crowd y={150} fill="#3a2718" from={30} to={330} />
        </g>
      );
    case 'field':
      return (
        <g>
          <circle cx="290" cy="34" r="20" fill="#fff1c2" className="cs-glow" />
          <Hills y={84} fill="#b9894c" far="#cfa15e" />
          {[96, 108, 122, 138].map((y, i) => (
            <path key={y} d={`M0 ${y} Q180 ${y - 8 - i * 2} 360 ${y}`} stroke="#8e6434" strokeWidth={2 + i} fill="none" />
          ))}
          <path d="M60 140 L76 128 L70 120 M150 132 L162 122 M230 142 L246 130 L240 124" stroke="#5c3b1c" strokeWidth="1.5" fill="none" />
          <circle cx="110" cy="92" r="4" fill="#3a2718" />
          <path d="M104 112 Q110 94 116 112 Z" fill="#3a2718" />
          <path d="M116 100 L132 86" stroke="#3a2718" strokeWidth="2" />
        </g>
      );
    case 'sky':
      return (
        <g>
          {[
            [30, 20],
            [80, 40],
            [140, 14],
            [200, 30],
            [250, 12],
            [320, 44],
            [60, 64],
            [300, 70],
            [170, 58],
          ].map(([x, y]) => (
            <circle key={`${x}-${y}`} cx={x} cy={y} r="1.2" fill="#e9e4ff" className="cs-twinkle" />
          ))}
          <path d="M248 30 L120 82 L126 88 Z" fill="url(#cs-tail)" className="cs-comet" />
          <circle cx="250" cy="30" r="5" fill="#fff6dc" className="cs-glow" />
          <Hills y={124} fill="#0b0d18" far="#141a2e" />
          <Town y={136} fill="#06070d" lit="#e8a24a" />
        </g>
      );
    case 'fire':
      return (
        <g>
          <ellipse cx="180" cy="130" rx="200" ry="70" fill="#ff7a2e" opacity="0.18" className="cs-glow" />
          <path d="M70 60 Q100 30 90 0 M200 50 Q240 20 220 0" stroke="#3a2a2a" strokeWidth="18" fill="none" opacity="0.5" className="cs-smoke" />
          <Town y={132} fill="#0d0708" />
          {[60, 120, 190, 250, 300].map((x, i) => (
            <path
              key={x}
              d={`M${x} 134 Q${x - 12} ${110 - i * 3} ${x} ${92 - (i % 2) * 10} Q${x + 12} ${112 - i * 2} ${x} 134 Z`}
              fill={i % 2 ? '#ffb347' : '#ff6a2a'}
              className="cs-flame"
            />
          ))}
          <Crowd y={150} fill="#050304" from={10} to={350} />
        </g>
      );
    case 'gate':
      return (
        <g>
          <Hills y={110} fill="#6e5a40" far="#8a7556" />
          <rect x="110" y="40" width="40" height="100" fill="#5b4632" />
          <rect x="210" y="40" width="40" height="100" fill="#5b4632" />
          <path d="M106 40 L130 16 L154 40 Z M206 40 L230 16 L254 40 Z" fill="#4a3220" />
          <rect x="150" y="62" width="60" height="78" fill="#4f3c2b" />
          <path d="M160 140 L160 96 Q180 74 200 96 L200 140 Z" fill="#1e140b" />
          {[112, 124, 136, 212, 224, 236].map((x) => (
            <rect key={x} x={x} y="34" width="8" height="8" fill="#5b4632" />
          ))}
          <path d="M150 150 L176 140 L184 140 L250 150 Z" fill="#9a7c56" />
          <rect x="40" y="124" width="44" height="14" fill="#5c3e26" />
          <circle cx="48" cy="140" r="6" fill="#2a1a0e" />
          <circle cx="76" cy="140" r="6" fill="#2a1a0e" />
          <path d="M44 124 Q62 106 80 124 Z" fill="#d9c7a0" />
          <Banner x={124} y={2} color="#8e2b20" h={18} />
        </g>
      );
    case 'road':
      return (
        <g>
          <circle cx="70" cy="56" r="16" fill="#ffe7b0" className="cs-glow" />
          <Hills y={96} fill="#9a7a5a" far="#b58e6a" />
          <path d="M150 150 C170 120 200 110 230 96 L238 96 C214 112 196 124 210 150 Z" fill="#d8b98a" />
          <path d="M226 96 L232 78 L238 96 Z M240 96 L246 82 L252 96 Z" fill="#6e5a40" />
          {[60, 84, 108, 132].map((x, i) => (
            <g key={x}>
              <circle cx={x} cy={118 - i} r="4" fill="#3a2718" />
              <path d={`M${x - 6} ${138 - i} Q${x} ${120 - i} ${x + 6} ${138 - i} Z`} fill="#3a2718" />
              <path d={`M${x + 5} ${132 - i} L${x + 8} ${100 - i}`} stroke="#3a2718" strokeWidth="1.5" />
            </g>
          ))}
          <Banner x={140} y={88} color="#c9973f" h={20} />
        </g>
      );
    case 'lists':
      return (
        <g>
          <Hills y={96} fill="#7d9a5a" far="#9ab47a" />
          {[
            [30, '#a8392a'],
            [290, '#3f6a8a'],
          ].map(([x, c]) => (
            <g key={x as number}>
              <path d={`M${x} 100 L${(x as number) + 22} 66 L${(x as number) + 44} 100 Z`} fill={c as string} />
              <rect x={(x as number) + 21} y="56" width="2" height="12" fill="#2a1a0e" />
              <path d={`M${(x as number) + 23} 56 L${(x as number) + 34} 60 L${(x as number) + 23} 64 Z`} fill="#f2e2bc" className="cs-sway" />
            </g>
          ))}
          <rect x="40" y="118" width="280" height="5" fill="#6b4a2c" />
          {[
            [120, '#a8392a', 1],
            [240, '#3f6a8a', -1],
          ].map(([x, c, d]) => (
            <g key={x as number} className="cs-charge">
              <ellipse cx={x as number} cy="112" rx="18" ry="9" fill="#4a3220" />
              <rect x={(x as number) - 4} y="88" width="10" height="18" fill={c as string} />
              <circle cx={(x as number) + 1} cy="84" r="5" fill="#9aa0a6" />
              <path d={`M${x} 96 L${(x as number) + (d as number) * 52} 90`} stroke="#d9c7a0" strokeWidth="2.5" />
            </g>
          ))}
          <Crowd y={150} fill="#3a2718" from={20} to={340} />
        </g>
      );
  }
}

export function CrownScene({ scene }: { scene: Scene }) {
  const [top, bottom] = SKY[scene];
  return (
    <svg className="cs" viewBox="0 0 360 150" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <linearGradient id={`cs-sky-${scene}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={top} />
          <stop offset="1" stopColor={bottom} />
        </linearGradient>
        <linearGradient id="cs-tail" x1="1" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff6dc" stopOpacity="0.9" />
          <stop offset="1" stopColor="#9fb4ff" stopOpacity="0" />
        </linearGradient>
        <pattern id="cs-stone" width="24" height="12" patternUnits="userSpaceOnUse">
          <path d="M0 12 L24 12 M12 0 L12 6 M0 6 L24 6 M0 0 L0 6" stroke="#5a4030" strokeWidth="1" fill="none" />
        </pattern>
        <radialGradient id="cs-vignette" cx="0.5" cy="0.45" r="0.75">
          <stop offset="0.6" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.55" />
        </radialGradient>
      </defs>
      <rect width="360" height="150" fill={`url(#cs-sky-${scene})`} />
      <Plot scene={scene} />
      <rect width="360" height="150" fill="url(#cs-vignette)" />
    </svg>
  );
}
