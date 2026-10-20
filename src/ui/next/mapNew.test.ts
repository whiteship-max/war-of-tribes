// «Походы», карточка клетки и весть нового вида (docs/ui_audit.md, 13): своих правил у них нет — те же двери мира и
// те же слова, что у прежнего вида; здесь держится то, что прежний вид держал своими тестами.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Estimate, FigureView } from '@/world/types';
import { formatEstimate } from '@/world/intel';
import { secondsLeft } from '@/world/geo';
import { realLeft } from '@/ui/parts/wait';
import { whereWords } from './MarchesNew';
import { cellEstimate } from './WorldNew';

const read = (rel: string): string =>
  readFileSync(join(__dirname, '..', rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('карточка клетки нового вида: за краем региона приказов нет', () => {
  const src = read('next/WorldNew.tsx');
  it('ворота края — раньше пустой земли, и каждый приказ — после них', () => {
    const gate = src.indexOf('if (!reachable(here))');
    expect(gate, 'ворота края').toBeGreaterThan(0);
    expect(src.indexOf('if (!card) {'), 'пустая земля — после края').toBeGreaterThan(gate);
    // Область: все двери приказов мира, что зовёт карточка: отряд — `send`, человек — дело `errand` и меню дел (Р-4).
    for (const call of ['errand(', 'send(', 'openMenu(']) {
      const at = src.indexOf(call, src.indexOf('export function WorldNew'));
      expect(at, `${call} зовётся`).toBeGreaterThan(0);
      expect(at, `${call} — после ворот края`).toBeGreaterThan(gate);
    }
  });

  it('раскладка дружины — строкой-входом в «Дружину» в карточке своего замка', () => {
    // Прежняя карточка, через которую он шёл (`panels/WorldPanel.OwnGarrison`), удалена (docs/ui_audit.md, 16); прежний
    // редактор здесь же (`parts/GarrisonEditor`) — тоже: передача одна, в «Дружине» (docs/retinue.md, docs/ui_v2.md, 5.3).
    expect(src).toMatch(/card\.mine && <MusterLink \/>/);
    expect(src.match(/<MusterLink\b/g)?.length, 'показана один раз').toBe(1);
  });

  it('метка обучения разведки — на кнопке миссии, потом на «Отправить»', () => {
    expect(src).toContain(`data-tut={m.id === 'scout' && mission !== 'scout' ? 'scout' : undefined}`);
    expect(src).toContain(`data-tut={mission === 'scout' ? 'scout' : undefined}`);
  });
});

describe('оценка в ячейку карточки', () => {
  it('неизвестное — «?», остальное — словами `formatEstimate`', () => {
    const at = (e: Partial<Estimate>): Estimate => ({ value: 0, min: 0, max: 0, precision: 'exact', ...e }) as Estimate;
    expect(cellEstimate(at({ precision: 'unknown' }))).toBe('?');
    for (const e of [at({ value: 120 }), at({ precision: 'rough', min: 100, max: 160 }), at({ precision: 'vague', min: 50, max: 400 })]) {
      expect(cellEstimate(e)).toBe(formatEstimate(e));
    }
  });
});

describe('«Походы» нового вида: где человек — теми же словами', () => {
  const base = {
    id: 'scout',
    name: 'Разведчик',
    icon: '👣',
    phase: 'idle',
    place: 'map',
    atHome: false,
    atName: 'Белый Брод',
    held: false,
    busyUntil: 0,
    downUntil: 0,
    arriveAt: 0,
    retiring: false,
  } as unknown as FigureView;
  const now = 1_000_000;

  it('срок — `realLeft(secondsLeft(...))`, как у прежнего списка; пустое место говорит, где нанять', () => {
    expect(whereWords({ ...base, phase: 'moving', arriveAt: now + 90_000 } as FigureView, now, 'в ратуше')).toBe(`в пути · ${realLeft(secondsLeft(now + 90_000, now))}`);
    expect(whereWords({ ...base, place: 'down', downUntil: now + 60_000 } as FigureView, now, '')).toBe(`разбит, вернётся через ${realLeft(secondsLeft(now + 60_000, now))}`);
    expect(whereWords({ ...base, place: 'down', held: true, downUntil: now + 60_000 } as FigureView, now, '')).toContain('задержан');
    // Имя места не склоняется (docs/ui_audit.md, 14.1, 16): оно стоит после срока, без предлога.
    expect(whereWords({ ...base, held: true, busyUntil: now + 60_000 } as FigureView, now, '')).toBe(`задержан, отпустят через ${realLeft(secondsLeft(now + 60_000, now))} · Белый Брод`);
    expect(whereWords({ ...base, place: 'vacant', gone: 'retired' } as FigureView, now, 'в ратуше')).toBe('ушёл на покой · нанять в ратуше');
    expect(whereWords({ ...base, place: 'city' } as FigureView, now, '')).toBe('укрылся в городе');
    expect(whereWords({ ...base, atHome: true } as FigureView, now, '')).toBe('дома');
    expect(whereWords(base, now, '')).toBe('Белый Брод');
  });

  it('мораль отряда — словами `restLine`, сама доля не читается', () => {
    const src = read('next/MarchesNew.tsx');
    expect(src).toContain('restLine(');
    expect(src).not.toMatch(/rest\.share|\.fullAt/);
  });
});

describe('весть нового вида', () => {
  const mail = read('realm/Mail.tsx');
  it('показывает, что будет без ответа, и оба ответа на набег', () => {
    const card = mail.slice(mail.indexOf('function DispatchCardNew'));
    expect(card).toContain('{d.silence}');
    expect(card).toContain('useRaidWords()');
    // «Дружина» — окно дружины: гарнизон и отряд полководца там с UI-4 (прежде — Статуя; docs/ui_v2.md, 5.6).
    expect(card).toContain('goTo(WINDOW.army)');
    expect(card).toContain('openMap()');
  });
});
