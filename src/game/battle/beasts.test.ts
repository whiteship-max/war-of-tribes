// Журнал боя со стаей говорит «волки» и «стая», а не «конница» и «чужие» (слово владельца, docs/battle_eu4.md, 14.29,
// «Хвост поставки 3»). Ядро думает родами и не трогается; имена даёт слой показа (`beasts.ts`), и проверяется он на
// настоящих боях у ворот — мир бьётся той же дверью, что в игре (`LocalWorld.gateFight`), — а не на строках, написанных
// рукой: ядро поменяет слово, и тест это увидит.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { describeEvent, summarize } from '@/battle';
import { LocalWorld } from '@/world/local/LocalWorld';
import { shieldVillagers } from '@/world/lairs';
import { GATE_FOES, gateReportId } from '@/world/data/gate';
import { REST_FULL } from '@/world/rest';
import type { BattleRecord, GateCall, GateFoe, PlayerProfile } from '@/world/types';
import type { TroopStack } from './kinds';
import { beastSummary, beastWords } from './beasts';

const START = 1_700_000_000_000;

/** Кто дома: с копьями, с лучниками, с конницей, одни лучники и никого — чтобы у ворот случилось всё, что ядро пишет. */
const HOMES: TroopStack[] = [
  { legionary: 30, spearman: 24, archer: 16 },
  { spearman: 40, archer: 40 },
  { clubman: 20, archer: 30, rider: 10 },
  { archer: 60 },
  {},
];

/** Бои у ворот по вызову, дверью мира: запись боя — ровно та, что ляжет в отчёт. */
async function gateRecords(foe: GateFoe, powers: number): Promise<BattleRecord[]> {
  const out: BattleRecord[] = [];
  for (const [h, army] of HOMES.entries()) {
    // Между боями гарнизон отдыхает полный срок: иначе каждый следующий бой шёл бы с уставшими (мораль между боями,
    // docs/battle_eu4.md, 14.31), и выборка мерила бы усталость, а не слова.
    let now = START;
    const world = new LocalWorld({ seed: 7 + h, now: () => now, storage: null });
    const profile = (gate?: GateCall[]): PlayerProfile => ({
      name: 'Тест',
      pop: shieldVillagers(0.1),
      defense: 900,
      militia: 40,
      militiaArchers: 10,
      units: { warrior: 10, scout: 4 },
      army,
      stock: { food: 4000 },
      stash: 0,
      ...(gate ? { gate } : {}),
    });
    await world.sync(profile());
    for (let i = 0; i < powers; i++) {
      const id = `gate-${foe}-${h}-${i}`;
      const pulse = await world.sync(profile([{ id, foe, power: 30 + i * 25, seed: 1000 + i * 7919 }]));
      // Только бой этого вызова: пока гарнизон отдыхает, мир живёт, и в пульс попадают и набеги логов.
      for (const r of pulse.reports) if (r.battle && r.id === gateReportId(id)) out.push(r.battle);
      now += REST_FULL + 1;
    }
  }
  return out;
}

/** Каждая строка, которую игрок читает в отчёте о бое: журнал по событиям, причина исхода и ключевые события. */
function shown(rec: BattleRecord): { raw: string; seen: string }[] {
  const lines = rec.result.log.map((e) => {
    const raw = describeEvent(e, rec.us);
    return { raw, seen: beastWords(raw, rec.beasts, rec.us) };
  });
  const raw = summarize(rec.result, rec.us);
  const seen = beastSummary(raw, rec.beasts, rec.us);
  lines.push({ raw: raw.reason, seen: seen.reason });
  raw.keys.forEach((k, i) => lines.push({ raw: k.text, seen: seen.keys[i].text }));
  return lines;
}

/** Слова ядра о роде и о чужой стороне, которых в строках о стае быть не должно. */
const CORE_WORDS = /конниц|кавалер|всадни|[Чч]уж/;
/** Строка ядра о стае: названа родом или чужой стороной, или «армия рассыпалась» — это ядро пишет только о чужих. */
const aboutFoe = (t: string): boolean => CORE_WORDS.test(t) || /армия рассыпалась/.test(t);

let wolves: { raw: string; seen: string }[] = [];
let people: { raw: string; seen: string }[] = [];

beforeAll(async () => {
  const w = await gateRecords('wolves', 30);
  expect(w.every((r) => r.beasts === 'attacker' && r.us === 'defender'), 'у стаи в записи — звери, наши обороняются').toBe(true);
  wolves = w.flatMap(shown);
  const p = await gateRecords('raiders', 6);
  expect(p.every((r) => r.beasts === undefined), 'разбойники — люди').toBe(true);
  people = p.flatMap(shown);
}, 120_000);

describe('журнал боя со стаей: «волки» и «стая», а не рода ядра', () => {
  it('в строках о стае не остаётся ни «конницы», ни «кавалерии», ни «чужих»', () => {
    // Граница области: ядро правда называло стаю этими словами — и в журнале, и в итоге, и в чужих событиях, и в наших.
    // «Проиграли перестрелку» из списка ушло с судьёй перестрелки (поставка 5, docs/battle_eu4.md, 14.33): ядро этого
    // больше не пишет, а слой слов для записей, посчитанных раньше, остался.
    const raw = wolves.map((l) => l.raw);
    for (const [word, re] of [
      ['конница', /конниц/],
      ['кавалерийский удар (наши копья остановили стаю)', /кавалер/],
      ['чужие', /[Чч]уж/],
      ['армия рассыпалась', /армия рассыпалась/],
      ['бойцы побежали у стаи', /Чужой .+ сломался — бойцы побежали/],
    ] as const) {
      expect(raw.some((t) => re.test(t)), `ядро пишет о стае «${word}»`).toBe(true);
    }
    const left = wolves.filter((l) => aboutFoe(l.raw) && (CORE_WORDS.test(l.seen) || /арми|бойцы/.test(l.seen)));
    expect(left.map((l) => l.seen), 'слова ядра о стае не доходят до игрока').toEqual([]);
    const seen = wolves.map((l) => l.seen);
    expect(seen.some((t) => /волки/i.test(t)), 'стая названа волками').toBe(true);
    expect(seen.some((t) => /стая|стаю|стаи/i.test(t)), 'и стаей').toBe(true);
  });

  it('строки о нашей стороне не тронуты', () => {
    // Граница области: наши строки о тех же событиях есть — «бойцы побежали», «армия сломалась», «наши».
    const ours = wolves.filter((l) => !aboutFoe(l.raw));
    expect(ours.some((l) => /^Наш .+ сломался — бойцы побежали/.test(l.raw)), 'наш сектор бежит в выборке').toBe(true);
    expect(ours.some((l) => /^наши: армия сломалась/.test(l.raw)), 'наша армия ломается в выборке').toBe(true);
    expect(ours.filter((l) => l.seen !== l.raw).map((l) => [l.raw, l.seen]), 'о нас — словами ядра').toEqual([]);
  });

  it('бой людей — словами ядра как есть', () => {
    // Граница области: в бою с разбойниками «чужие» есть — слою было бы что менять.
    expect(people.some((l) => /[Чч]уж/.test(l.raw)), 'у разбойников в журнале «чужие»').toBe(true);
    expect(people.filter((l) => l.seen !== l.raw).map((l) => l.raw), 'люди остаются людьми').toEqual([]);
  });

  it('звери у ворот — одни волки: слова слоя — о волках', () => {
    // Запись боя несёт только сторону зверей, а не вид: второй зверь потребует имени в записи и слов по зверю.
    expect(Object.values(GATE_FOES).filter((f) => f.beasts).map((f) => f.name)).toEqual(['Стая волков']);
  });

  it('отчёт о бое показывает журнал и итог через слой', () => {
    const strip = (code: string): string => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const src = strip(readFileSync(path.resolve('src/ui/panels/ReportPanel.tsx'), 'utf8'));
    expect(src, 'журнал — через слой').toMatch(/beastWords\(describeEvent\(e, rec\.us\), rec\.beasts, rec\.us\)/);
    expect(src, 'итог — через слой').toMatch(/beastSummary\(summarize\(rec\.result, rec\.us\), rec\.beasts, rec\.us\)/);
    expect(src.match(/describeEvent\(/g)?.length, 'журнал читается ядром в одном месте').toBe(1);
    expect(src.match(/summarize\(/g)?.length, 'итог — тоже').toBe(1);
  });
});
