// Навык агента не второй источник числа, которым владеет здание.
//
// Терпение войска к неуплате и воинская традиция (кружки полководца, П4) — Статуя. Старение
// разведданных, предупреждение о набеге, изучение округи и шанс лазутчика — Дозор.
// Оборона — частокол, башня, казармы и храм. Мы месяц разгребали вторые правды (два
// счётчика осады, четыре копии возврата цены, обещание Дозора, никуда не
// подключённое), и навык не смеет стать следующей.
//
// Держится это с двух сторон и замером:
// - модули навыка не называют ни одного числа здания;
// - владельцы этих чисел не читают ничего от навыка;
// - на настоящем состоянии и настоящем мире: агенты пятого уровня против первого
//   не сдвигают ни одного числа здания — ни в племени, ни в слепке, ни в мире.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createInitialState } from '../state';
import { creditTech } from '../sim/tech';
import {
  defense,
  fervour,
  healShare,
  intelKeen,
  stalls,
  payGraceDays,
  surveyRadius,
  warningSeconds,
} from '../derived';
import { XP_CAP } from './agents';
import { playerProfile } from '@/world/bridge';
import { FIGURE_IDS } from '@/world/data/figures';
import { LocalWorld } from '@/world/local/LocalWorld';
import type { GameState } from '../types';
import type { PlayerProfile } from '@/world/types';
import { SPY_CHANCE_MAX, SPY_CHANCE_MIN } from '@/world/data/tuning';

const SRC = join(__dirname, '..', '..');
const read = (p: string): string =>
  readFileSync(join(SRC, p), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

/** Тело объявления по имени: функции, стрелки или метода — до закрывающей скобки. */
function bodyOf(src: string, name: string): string {
  const re = new RegExp(String.raw`(?:function\s+${name}\b|\b${name}\s*=\s*(?:\([^)]*\)|\w+)|(?:private|protected|async)\s+${name}\s*\()`);
  const m = re.exec(src);
  if (!m) throw new Error(`не нашёл ${name}`);
  let depth = 0;
  let opened = false;
  for (let i = m.index; i < src.length; i++) {
    const c = src[i];
    if (c === '(' || c === '{' || c === '[') {
      depth++;
      if (c === '{') opened = true;
    } else if (c === ')' || c === '}' || c === ']') {
      depth--;
      if (depth === 0 && opened && c === '}') return src.slice(m.index, i + 1);
    } else if (c === ';' && depth === 0) {
      return src.slice(m.index, i + 1);
    }
  }
  return src.slice(m.index);
}

/** Слова навыка: всё, чем уровень агента мог бы просочиться в число здания. */
const SKILL = /\b(?:agents?|pips?\w*|\w*Pips|sightBonus\w*|stealth\w*|revealSight|slipped|slipShare|circles\w*|agentLevel|levelOf|xp)\b/;

/** Числа зданий: всё, чем навык мог бы стать второй правдой. */
const OWNED = /\b(?:payGrace\w*|loyalty|keen|intel\w*|spyChance|guardOf|warning\w*|survey\w*|defen[cs]e\w*|statOf|buildingStat|buildingOfType|heal\w*|capacity|roomOf|garrison\w*|militia\w*|expert|SPY_CHANCE\w*|SPY_PROBE\w*)\b/i;

describe('навык не читает чисел, которыми владеет здание', () => {
  // Черты — тем же правилом: они лежат на свободных осях и не называют чисел здания.
  const SKILL_FILES = ['game/data/agents.ts', 'game/data/traits.ts', 'game/sim/agents.ts', 'world/agents.ts'];

  it('в модулях навыка нет ни одного имени из чисел Статуи, Дозора и обороны', () => {
    for (const f of SKILL_FILES) {
      const hits = read(f)
        .split('\n')
        .map((line, i) => ({ line, i }))
        .filter(({ line }) => OWNED.test(line));
      expect(hits.map(({ line, i }) => `${f}:${i + 1} ${line.trim()}`), f).toEqual([]);
    }
  });

  it('Статуя входит в отметки ровно одним числом — воинской традицией, одной дверью', () => {
    // Замок переписан вслух (П4, docs/battle_eu4.md, 14.35, п. 9 слова владельца): у Статуи есть число, которое навык
    // читает, — воинская традиция (`derived.tradition`), кружки полководца от её уровня. Читает его одна дверь уровня
    // отметок (`sim/agents.pipLevel`), и ни одного другого числа здания навык не называет (тест выше).
    const agents = read('game/sim/agents.ts');
    expect(agents.match(/\btradition\(/g) ?? [], 'традицию навык зовёт один раз').toHaveLength(1);
    expect(bodyOf(agents, 'pipLevel'), 'и только в уровне отметок').toMatch(/\btradition\(s\)/);
    expect(bodyOf(agents, 'pipsOf'), 'отметки на месте — с этого уровня').toMatch(/pipLevel\(s, agentLevel\(s, 'general'\)\)/);
  });

  it('владельцы этих чисел не читают ничего от навыка', () => {
    const whole = ['game/derived.ts', 'world/spy.ts', 'world/intel.ts', 'world/muster.ts', 'world/sight.ts'];
    // Воинская традиция — лестница Статуи к лестнице кружков полководца (П4): длину второй Статуя берёт у навыка, одним
    // импортом `MAX_AGENT_LEVEL` и только в `tradition`. Кроме этой длины, владелец чисел от навыка не читает ничего.
    const LADDER = "import { MAX_AGENT_LEVEL } from './data/agents';";
    const derived = read('game/derived.ts');
    expect(derived.split(LADDER), 'длина лестницы кружков — одним импортом').toHaveLength(2);
    const outside = derived.replace(LADDER, '').replace(bodyOf(derived, 'tradition'), '');
    expect(outside, 'длину лестницы кружков читает только традиция').not.toMatch(/MAX_AGENT_LEVEL/);
    for (const f of whole) {
      const src = f === 'game/derived.ts' ? derived.replace(LADDER, '') : read(f);
      const hit = src.split('\n').findIndex((line) => SKILL.test(line));
      expect(hit, `${f}:${hit + 1} ${src.split('\n')[hit] ?? ''}`).toBe(-1);
    }
    const world = read('world/local/LocalWorld.ts');
    // Шанс лазутчика, предупреждение, земля у дома, живой обзор, снимок разведки
    // (keen), стойкость гарнизона и снаряжение.
    for (const name of ['spyOptions', 'warningMs', 'homeReveal', 'sightDiscs', 'snapshot', 'ownResolve', 'ownGear']) {
      expect(bodyOf(world, name), `LocalWorld.${name}`).not.toMatch(SKILL);
    }
    // Оборону деревни и вылазку полководец ведёт, только пока его дружина стоит у ворот (решение
    // владельца 26.09.2026, docs/battle_eu4.md, вопрос 5): отметки туда идут одной дверью —
    // `homePips`, которая спрашивает место дружины, — и никогда дверью боёв в поле (`generalPips`).
    for (const name of ['resolveIncoming', 'wallField', 'gateField', 'sortie']) {
      expect(bodyOf(world, name), `LocalWorld.${name}`).not.toMatch(/generalPips|general:\s*true/);
    }
    // Со всеми отметками, и манёвром тоже: у EU4 манёвр обороняющегося держит переправу нападающему (14.5, Л9).
    // Сторону обороны у ворот собирает одна дверь — `gateField` (набег зовёт её через `wallField`, бой события —
    // напрямую; docs/battle_eu4.md, 14.28), и отметки берёт она.
    expect(bodyOf(world, 'wallField'), 'бой у стены — дверью у ворот').toMatch(/this\.gateField\(/);
    expect(bodyOf(world, 'gateField'), 'бой у стены берёт отметки дверью «у ворот»').toMatch(/this\.homePips\(at\)/);
    expect(bodyOf(world, 'homePips'), 'дверь «у ворот» спрашивает, где стоит дружина').toMatch(/postureOf\(/);
    const bridge = read('world/bridge.ts');
    for (const name of ['militiaMen', 'militiaArchers']) expect(bodyOf(bridge, name), `bridge.${name}`).not.toMatch(SKILL);
  });
});

describe('агенты пятого уровня не сдвигают ни одного числа здания', () => {
  // Партия сравнения — сыгранная: места агентов у неё есть. У новой место лазутчика
  // закрыто ветвью, и слепок не вёз бы его прибавок вовсе — сравнивать было бы нечего.
  const seated = (s: GameState): GameState => {
    s.agents.spy.vacant = false;
    creditTech(s);
    return s;
  };

  const maxed = () => {
    const s = seated(createInitialState());
    for (const id of FIGURE_IDS) s.agents[id].xp = XP_CAP;
    return s;
  };

  it('в племени и в слепке для мира — меняются только прибавки навыка', () => {
    const a = seated(createInitialState());
    const b = maxed();
    for (const [name, fn] of Object.entries({ payGraceDays, intelKeen, warningSeconds, surveyRadius, defense, fervour, stalls, healShare })) {
      expect(fn(b), name).toBe(fn(a));
    }
    const pa = playerProfile(a) as unknown as Record<string, unknown>;
    const pb = playerProfile(b) as unknown as Record<string, unknown>;
    const changed = [...new Set([...Object.keys(pa), ...Object.keys(pb)])].filter(
      (k) => JSON.stringify(pa[k]) !== JSON.stringify(pb[k]),
    );
    // Четыре поля и все — навык: отметки, зоркость и скрытность дважды — в провале и в гибели.
    expect(changed.sort()).toEqual(['pips', 'sightBonus', 'stealth', 'veil']);
  });

  it('в мире: шанс лазутчика, предупреждение и живой обзор те же', async () => {
    const base: PlayerProfile = {
      name: 'Тест',
      pop: 120,
      defense: 30,
      units: { warrior: 10, scout: 4 },
      army: { spearman: 12 },
      intelKeen: 1,
      warning: 40,
      stock: { food: 120 },
      stash: 0,
    };
    const probe = async (profile: PlayerProfile) => {
      const now = 1_700_000_000_000;
      const w = new LocalWorld({ seed: 17, now: () => now, storage: null });
      const pulse = await w.sync(profile);
      const inner = w as unknown as {
        gen: { settlements: { id: string }[] };
        warningMs(): number;
        sightDiscs(t: number): unknown;
      };
      // Цель, у которой шанс не прижат ни к полу, ни к потолку: у прижатого шанса
      // множитель от навыка не был бы виден, и сравнение проходило бы даром.
      const all: { id: string; c: number[] }[] = [];
      for (const s of inner.gen.settlements) {
        all.push({ id: s.id, c: (await w.orders('spy', s.id)).map((o) => o.chance ?? 0) });
      }
      const free = all.find((x) => x.c.every((c) => c > SPY_CHANCE_MIN && c < SPY_CHANCE_MAX / 2));
      expect(free, 'точка внутри области: шанс не прижат').toBeDefined();
      const chances = free!.c;
      return {
        target: free!.id,
        chances,
        warning: inner.warningMs(),
        discs: JSON.stringify(inner.sightDiscs(now)),
        watch: pulse.figures.map((f) => f.watchSight),
        points: chances.length,
      };
    };
    const a = await probe(base);
    // Черты со всеми множителями разом: шанс, предупреждение и живой обзор
    // от них не двигаются так же, как от навыка.
    const b = await probe({
      ...base,
      pips: { fire: 1, shock: 1, melee: 1, maneuver: 1 },
      sightBonus: 4,
      stealth: 0.6,
      traits: { muster: 1.5, carry: 1.15, catch: 1.32, busy: 0.75, held: 1.5 },
    });
    expect(a.points, 'шанс лазутчика есть, то есть сравнение не пустое').toBeGreaterThan(0);
    expect(b).toEqual(a);
  });
});
