// Вести гонца и доклад советника (docs/city_v3.md, Г-10): какие вести важны, что гонец несёт только новое, что советник
// докладывает по летописи «Вестей» после отлучки, куда ведёт каждая строка и что он помнит, о чём уже сказал.
import { describe, expect, it } from 'vitest';
import type { LogEntry } from '@/game/types';
import type { LetterView, Report, SiegeView, CampView } from '@/world/types';
import { letterKey } from '@/ui/realm/unread';
import { ADVISOR_AWAY, advisorReport, freshAdvisor, freshNews, newsOf, says, type AdvisorInput, type WorldNews } from './tidings';

const NOW = 1_000_000;
const letter = (id: string, kind: LetterView['kind'], over: Partial<LetterView> = {}): LetterView =>
  ({ id, kind, at: 0, until: NOW + 9e6, fromId: 's1', fromName: 'Волчье логово', cost: {}, title: kind === 'pact' ? 'Предложение договора' : 'Письмо', icon: '', body: '', from: null, choices: [], seconds: 100, silence: '', ...over }) as LetterView;
const report = (id: string, over: Partial<Report> = {}): Report =>
  ({ id, at: 0, kind: 'defense', title: 'Набег отбит у ворот', target: { id: 's1', name: 'Х', x: 0, y: 0 }, won: true, sent: {}, lost: {}, enemyPower: 40, enemyLost: 30, loot: null, intel: null, battle: null, text: '', read: false, ...over }) as Report;
const siege = (over: Partial<SiegeView> = {}): SiegeView => ({ byId: 's2', byName: 'Чёрный стан', since: 500, starvesAt: NOW + 3_600_000, ...over }) as SiegeView;
const world = (over: Partial<WorldNews> = {}): WorldNews => ({ letters: [], siege: null, camp: null, reports: [], now: NOW, ...over });

describe('гонец: важные вести (Г-10)', () => {
  it('набег, осада, пролом, условия и союз, итог боя — каждая весть своего рода и ведёт в свою дверь', () => {
    const w = world({
      letters: [letter('r1', 'raid'), letter('s1', 'siege'), letter('a1', 'alliance', { againstName: 'Орда' }), letter('p1', 'pact'), letter('t1', 'tribute'), letter('x1', 'ransom')],
      siege: siege({ phases: { journal: [], next: '', nextAt: 0, nextK: 2, breaches: 1, progress: 1 }, parley: { side: 'def', share: 0.3, block: null, bot: true, incoming: { kind: 'terms', until: NOW + 1000 } } }),
      reports: [report('b1'), report('sc1', { kind: 'scout', enemyPower: null, battle: null })],
    });
    const list = newsOf(w);
    const by = Object.fromEntries(list.map((n) => [n.key, n]));
    expect(by[letterKey('r1')].kind).toBe('raid');
    expect(by[letterKey('r1')].door).toEqual({ to: 'mail', key: letterKey('r1') });
    // Осада — окном осады, а не письмом-спутником.
    expect(by[letterKey('s1')]).toMatchObject({ kind: 'siege', door: { to: 'siege' } });
    expect(by[letterKey('a1')]).toMatchObject({ kind: 'pact' });
    expect(by[letterKey('a1')].line).toContain('«Орда»');
    expect(by[letterKey('p1')].kind).toBe('pact');
    expect(by[letterKey('t1')].kind).toBe('offer');
    expect(by[letterKey('x1')].kind).toBe('offer');
    expect(by['breach:500:1']).toMatchObject({ kind: 'breach', door: { to: 'siege' } });
    expect(by[`offer:500:${NOW + 1000}`]).toMatchObject({ kind: 'offer', door: { to: 'siege' } });
    expect(by['report:b1']).toMatchObject({ kind: 'battle', door: { to: 'report', id: 'b1' } });
    // Разведка без боя — не итог боя: за ней гонец не бежит.
    expect(by['report:sc1']).toBeUndefined();
    // Срочное — первым.
    expect(list[0].kind).toBe('raid');
    expect(list[list.length - 1].kind).toBe('pact');
  });

  it('второй пролом — новая весть; истёкшее предложение у стен — уже не весть; предложение городу под нашим лагерем — в окно лагеря', () => {
    const one = newsOf(world({ siege: siege({ phases: { journal: [], next: '', nextAt: 0, nextK: 2, breaches: 1, progress: 1 } }) })).map((n) => n.key);
    const two = newsOf(world({ siege: siege({ phases: { journal: [], next: '', nextAt: 0, nextK: 3, breaches: 2, progress: 2 } }) })).map((n) => n.key);
    expect(freshNews(newsOf(world({ siege: siege({ phases: { journal: [], next: '', nextAt: 0, nextK: 3, breaches: 2, progress: 2 } }) })), new Set(one)).map((n) => n.key)).toEqual(two);
    const stale = newsOf(world({ siege: siege({ parley: { side: 'def', share: 0.3, block: null, bot: true, incoming: { kind: 'terms', until: NOW } } }) }));
    expect(stale.filter((n) => n.kind === 'offer')).toHaveLength(0);
    const camp = { targetName: 'Каменный брод', starvesAt: NOW + 1e6, parley: { side: 'atk', share: 0.5, block: null, bot: true, incoming: { kind: 'tribute', price: 100, until: NOW + 50 } } } as unknown as CampView;
    expect(newsOf(world({ camp }))[0]).toMatchObject({ kind: 'offer', door: { to: 'camp' } });
  });

  it('гонец несёт только то, что пришло в покоях: при входе всё уже «видено»', () => {
    const at = newsOf(world({ letters: [letter('r1', 'raid')], reports: [report('b1')] }));
    const seen = new Set(at.map((n) => n.key));
    const later = newsOf(world({ letters: [letter('r1', 'raid'), letter('r2', 'raid')], reports: [report('b1'), report('b2')] }));
    expect(freshNews(later, seen).map((n) => n.key)).toEqual([letterKey('r2'), 'report:b2']);
  });

  it('обращение — по вере, с большой буквы в начале фразы', () => {
    expect(says('{T}! Дозор', 'catholic')).toBe('Сир! Дозор');
    expect(says('{T}, донесение', 'orthodox')).toBe('Княже, донесение');
  });
});

/** Летопись: новые вперёд (как `s.log`). */
const L = (at: number, text: string, over: Partial<LogEntry> = {}): LogEntry => ({ at, text, kind: 'info', ...over });

describe('советник: доклад по летописи (Г-10)', () => {
  const T = 10_000;
  const since = T - ADVISOR_AWAY;
  const log: LogEntry[] = [
    L(T - 10, 'Кузница поднялась до 3-го уровня', { topic: 'build', kind: 'good' }),
    L(T - 20, 'Раненые: 2', { ref: 'raid-7-eff' }),
    L(T - 21, 'Набег «Волчьего логова» отбит', { ref: 'raid-7-eff', kind: 'good' }),
    L(T - 40, 'Амбар поднялся до 2-го уровня', { topic: 'build', kind: 'good' }),
    L(T - 60, 'Разведчики не вернулись', { ref: 'march-9-scout', kind: 'bad' }),
    // До прошлого доклада — уже доложено.
    L(since - 5, 'Старый бой', { ref: 'raid-1-eff' }),
  ];
  const inp = (over: Partial<AdvisorInput> = {}): AdvisorInput => ({ log, time: T, gold: 1540, inbox: 0, world: world({ reports: [report('raid-7'), report('raid-1')] }), ...over });

  it('отлучка — не меньше трёх настоящих часов: на шаг короче — советник не ждёт; ровно — ждёт (точки — по обе стороны границы)', () => {
    expect(ADVISOR_AWAY, 'три часа — шесть игровых суток по 60 с').toBe(360);
    const near = { ...freshAdvisor(), at: T - ADVISOR_AWAY + 1, gold: 1200 };
    const far = { ...freshAdvisor(), at: T - ADVISOR_AWAY, gold: 1200 };
    expect(T - near.at < ADVISOR_AWAY && T - far.at >= ADVISOR_AWAY, 'точки по обе стороны').toBe(true);
    expect(advisorReport(inp(), near)).toBeNull();
    expect(advisorReport(inp(), far)?.lines.length).toBeGreaterThan(0);
  });

  it('доклад: бои — словами летописи, каждая строка ведёт в своё донесение; стройка — в летопись стройки; казна — в торговлю', () => {
    const r = advisorReport(inp(), { at: since, gold: 1200, told: [] })!;
    const texts = r.lines.map((l) => l.text);
    // Событие одного последствия — одна строка (голова события), и ведёт она в его донесение.
    const raid = r.lines.find((l) => l.text === 'Набег «Волчьего логова» отбит')!;
    expect(raid.door).toEqual({ to: 'report', id: 'raid-7' });
    expect(raid.tone).toBe('good');
    expect(texts).not.toContain('Раненые: 2');
    // Бой без донесения — дверь в летопись того же рода.
    const scout = r.lines.find((l) => l.text === 'Разведчики не вернулись')!;
    expect(scout.door).toEqual({ to: 'chronicle', topic: 'battle' });
    expect(scout.tone).toBe('bad');
    // Стройка — по порядку, как шла.
    expect(r.lines.find((l) => l.key === 'build')).toMatchObject({ text: 'Стройка: Амбар поднялся до 2-го уровня; Кузница поднялась до 3-го уровня.', door: { to: 'chronicle', topic: 'build' } });
    expect(r.lines.find((l) => l.key === 'gold')).toMatchObject({ text: 'Казна: прибыло 340 золота, теперь 1540.', door: { to: 'chronicle', topic: 'trade' } });
    // Доложенное до прошлого раза — не повторяется.
    expect(texts).not.toContain('Старый бой');
  });

  it('угрозы — первыми и в свои окна: осада, набег, письма и вести, ждущие ответа', () => {
    const w = world({ siege: siege(), letters: [letter('r1', 'raid'), letter('p1', 'pact')], reports: [report('raid-7')] });
    const r = advisorReport(inp({ world: w, inbox: 2 }), { at: since, gold: 1540, told: [] })!;
    expect(r.lines[0]).toMatchObject({ key: 'siege:500', door: { to: 'siege' }, tone: 'bad' });
    expect(r.lines[0].text).toMatch(/^Город в осаде: «Чёрный стан» под стенами, хлеба на /);
    expect(r.lines.find((l) => l.key === letterKey('r1'))?.door).toEqual({ to: 'mail', key: letterKey('r1') });
    expect(r.lines.find((l) => l.key === letterKey('p1'))?.text).toBe('Ждёт ответа: предложение договора — от «Волчье логово».');
    expect(r.lines.find((l) => l.key === 'inbox:2')).toMatchObject({ text: 'На столе 2 вести ждут твоего слова.', door: { to: 'inbox' } });
    // Казна та же — строки о ней нет.
    expect(r.lines.find((l) => l.key === 'gold')).toBeUndefined();
  });

  it('советник помнит, о чём доложил: следующая отлучка без нового — пусто; та же осада второй раз не докладывается', () => {
    const w = world({ siege: siege(), reports: [report('raid-7')] });
    const first = advisorReport(inp({ world: w }), { at: since, gold: 1200, told: [] })!;
    expect(first.next).toEqual({ at: T, gold: 1540, told: ['siege:500'] });
    // Сразу после доклада — отлучки нет.
    expect(advisorReport(inp({ world: w }), first.next)).toBeNull();
    // Ещё одна отлучка, ничего нового: осада стоит, но о ней сказано; события летописи — до прошлого доклада.
    const again = advisorReport(inp({ world: w, time: T + ADVISOR_AWAY }), first.next)!;
    expect(again.lines).toEqual([]);
  });

  it('первый вход — доклад за последнюю отлучку, без строки казны (с чем сравнивать — ещё не знает)', () => {
    const r = advisorReport(inp(), freshAdvisor())!;
    expect(r.lines.some((l) => l.text === 'Набег «Волчьего логова» отбит')).toBe(true);
    expect(r.lines.find((l) => l.key === 'gold')).toBeUndefined();
  });
});
