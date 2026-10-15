// Профиль и настройки (UI-7, docs/ui_v2.md, 5.6; Д14, К6): имя города правят одной дверью — в шапке державы, что стоит и над
// профилем; «Сообщить об ошибке» на профиле — строкой настроек, без 🐞 рядом; имя — кнопка не мельче 44; мощь — с разбором
// (город и дружина складываются в неё); числа партии — таблицами, а не карточками `.mod`.
//
// Области (правило 11): мощь — у города с дружиной (оба слагаемых не ноль, дробные); потери — нет ни одной, одна и несколько.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { GameState } from '@/game/types';
import { createInitialState } from '@/game/state';
import { RESOURCE_IDS } from '@/game/constants';
import { buildingsPower, power, troopsPower } from '@/profile/power';
import { REST_LABEL } from '@/ui/kit/breakdown';
import { TAP_TARGET } from '@/gestures';
import { partyTables, powerTip } from './ProfilePanel';

const UI = join(__dirname, '..');
const code = (rel: string): string =>
  readFileSync(join(UI, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

function town(): GameState {
  const s = createInitialState(7);
  s.army.clubman = 17;
  s.army.archer = 5;
  return s;
}

describe('мощь — с разбором', () => {
  it('город и дружина складываются в мощь профиля; «Прочее» нет', () => {
    const s = town();
    // Область: оба слагаемых не ноль.
    expect(buildingsPower(s)).toBeGreaterThan(0);
    expect(troopsPower(s)).toBeGreaterThan(0);
    const t = powerTip(s);
    expect(t.rows?.map((r) => r.label)).toEqual(['Город', 'Дружина']);
    expect(t.rows?.map((r) => r.label)).not.toContain(REST_LABEL);
    expect(t.sum?.value).toBe(Math.round(power(s)).toLocaleString('ru-RU'));
  });
});

describe('числа партии — таблицами', () => {
  it('битвы, потери, хозяйство; без потерь — словами, с одной — без строки «всего», с несколькими — с ней', () => {
    const s = town();
    const names = (st: GameState): string[] => partyTables(st).map((t) => t.title);
    expect(names(s)).toEqual(['Битвы', 'Потери', 'Хозяйство']);
    const losses = (st: GameState) => partyTables(st)[1];
    expect(losses(s).rows, 'область: потерь нет').toEqual([]);
    expect(losses(s).empty).toBe('Потерь нет.');
    s.profile.totals.raidLoss.food = 120;
    s.profile.totals.raids = 1;
    expect(losses(s).rows.map((r) => r.key)).toEqual(['food', 'raids']);
    s.profile.totals.raidLoss.wood = 30;
    s.profile.totals.troopsLost = 4;
    // Запасы — порядком игры (`RESOURCE_IDS`), за ними «всего», набеги и бойцы.
    const res = RESOURCE_IDS.filter((r) => r === 'food' || r === 'wood');
    expect(losses(s).rows.map((r) => r.key)).toEqual([...res, 'all', 'raids', 'men']);
    expect(losses(s).rows.find((r) => r.key === 'all')!.v).toBe(`−${(150).toLocaleString('ru-RU')}`);
    const battles = partyTables(s)[0].rows;
    expect(battles.find((r) => r.key === 'won')!.v).toBe(String(s.stats.battlesWon));
  });

  it('карточек `.mod` в профиле нет; таблицы набора — есть', () => {
    const src = code('panels/ProfilePanel.tsx');
    expect(src).not.toContain('className="mod');
    expect(src).toContain('<Table');
  });
});

describe('одна дверь к имени города и к письму об ошибке (Д14), цель имени — 44 (К6)', () => {
  it('имя города правит только шапка державы', () => {
    expect(code('panels/ProfilePanel.tsx')).not.toMatch(/setCity|Назвать город/);
    expect(code('realm/RealmNew.tsx')).toContain('setCity');
  });

  it('🐞 в шапке не стоит на профиле: там «Сообщить об ошибке» — строкой настроек', () => {
    const head = code('realm/RealmNew.tsx');
    expect(head).toMatch(/inTelegram\(\) && view !== 'settings' && \(\s*<button className="nx-ibtn" onClick=\{report\}/);
    expect(code('parts/Settings.tsx')).toContain('Сообщить об ошибке');
  });

  it('имя в профиле — кнопка не мельче цели касания', () => {
    const css = readFileSync(join(UI, 'styles.css'), 'utf8');
    const rule = css.match(/\.profile-head \.name \{([^}]*)\}/)![1];
    expect(rule).toMatch(/min-height:\s*var\(--tap\)/);
    expect(TAP_TARGET).toBe(44);
  });
});
