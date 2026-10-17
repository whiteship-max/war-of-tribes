import { describe, expect, it } from 'vitest';
import {
  BANDIT_ARMS,
  CHARGES,
  CHARGE_NAMES,
  DEFAULT_ARMS,
  DIVISIONS,
  DIVISION_NAMES,
  SHIELDS,
  SHIELD_NAMES,
  TINCTURES,
  TINCTURE_NAMES,
  WILD_CHARGES,
  anyArms,
  armsBone,
  armsCode,
  armsOr,
  armsRule,
  blazon,
  fitArms,
  isMetal,
  lairArms,
  randomArms,
  readArms,
  type Arms,
} from './arms';
import { CHARGE_PARTS, DIVISION_PATH, SHIELD_BOX, SHIELD_PATH, armsLayers } from './art';

describe('герб: набор и правила', () => {
  it('прежний герб державы — по умолчанию: золотое поле, чёрная башня', () => {
    expect(armsCode(DEFAULT_ARMS)).toBe('heater-plain-or-or-tower-sable');
    expect(armsRule(DEFAULT_ARMS)).toBeNull();
    expect(armsOr(undefined)).toEqual(DEFAULT_ARMS);
    expect(armsOr('мусор')).toEqual(DEFAULT_ARMS);
  });

  it('у каждой части набора есть имя и рисунок', () => {
    for (const s of SHIELDS) expect([SHIELD_NAMES[s], SHIELD_PATH[s], SHIELD_BOX[s]].every(Boolean), s).toBe(true);
    for (const d of DIVISIONS) expect(DIVISION_NAMES[d], d).toBeTruthy();
    for (const d of DIVISIONS.slice(1)) expect(DIVISION_PATH(56)[d], d).toMatch(/^M/);
    for (const t of TINCTURES) expect(TINCTURE_NAMES[t], t).toBeTruthy();
    for (const c of [...CHARGES, ...WILD_CHARGES]) {
      expect(CHARGE_NAMES[c], c).toBeTruthy();
      expect(CHARGE_PARTS[c].length, c).toBeGreaterThan(0);
    }
  });

  it('строка герба читается назад той же: все щиты, деления и фигуры', () => {
    let n = 0;
    for (const shield of SHIELDS)
      for (const division of DIVISIONS)
        for (const charge of CHARGES) {
          const a: Arms =
            division === 'plain'
              ? { shield, division, field: ['azure', 'azure'], charge, tint: 'or' }
              : { shield, division, field: ['argent', 'gules'], charge, tint: 'sable' };
          expect(readArms(armsCode(a)), armsCode(a)).toEqual(a);
          expect(armsLayers(a).length).toBeGreaterThan(1);
          n++;
        }
    expect(n).toBe(SHIELDS.length * DIVISIONS.length * CHARGES.length);
  });

  it('металл на цвет: правило финифти на всех сочетаниях красок', () => {
    // Граница правила — все пары красок поля и фигуры; каждое сочетание внутри набора.
    let ok = 0;
    let bad = 0;
    for (const f1 of TINCTURES)
      for (const f2 of TINCTURES)
        for (const tint of TINCTURES)
          for (const division of ['plain', 'pale'] as const) {
            const a: Arms = { shield: 'heater', division, field: [f1, f2], charge: 'lion', tint };
            const want =
              division === 'plain'
                ? f1 === f2 && isMetal(f1) !== isMetal(tint)
                : isMetal(f1) !== isMetal(f2) && tint !== f1 && tint !== f2;
            expect(armsRule(a) === null, armsCode(a)).toBe(want);
            expect(readArms(armsCode(a)) !== null, armsCode(a)).toBe(want);
            if (want) ok++;
            else bad++;
          }
    expect(ok).toBeGreaterThan(50);
    expect(bad).toBeGreaterThan(50);
    expect(armsRule({ ...DEFAULT_ARMS, tint: 'argent' })).toMatch(/Металл на металл/);
    expect(armsRule({ ...DEFAULT_ARMS, field: ['gules', 'gules'], tint: 'azure' })).toMatch(/Цвет на цвет/);
  });

  it('подделанные части — отказ', () => {
    const good = armsCode(DEFAULT_ARMS);
    for (const bad of [
      null,
      42,
      {},
      '',
      'heater-plain-or-or-tower',
      `${good}-sable`,
      'heater-plain-or-or-dragon-sable',
      'heater-plain-gold-gold-tower-sable',
      'round-plain-or-or-tower-sable',
      'heater-checky-or-or-tower-sable',
      'heater-plain-or-or-tower-pink',
      'Heater-plain-or-or-tower-sable',
      'heater-plain-or-or-tower-sable ',
      'heater-plain-or-or-__proto__-sable',
      'heater-plain-or-or-constructor-sable',
      // Фигуры вольницы — только у логов.
      'kite-plain-sable-sable-axes-argent',
      'heater-plain-or-or-skull-sable',
      'heater-plain-or-or-wolf-sable',
      // Простое поле с двумя красками.
      'heater-plain-or-gules-tower-sable',
      `${good}${'x'.repeat(80)}`,
    ])
      expect(readArms(bad), String(bad)).toBeNull();
  });

  it('случайный герб всегда правильный и разный', () => {
    const r = armsBone('проба');
    const seen = new Set<string>();
    for (let i = 0; i < 3000; i++) {
      const a = randomArms(r);
      expect(armsRule(a), armsCode(a)).toBeNull();
      expect(readArms(armsCode(a))).toEqual(a);
      seen.add(armsCode(a));
    }
    expect(seen.size).toBeGreaterThan(2000);
    // Сеяная кость: один ключ — один герб.
    expect(randomArms(armsBone('k'))).toEqual(randomArms(armsBone('k')));
  });

  it('гербы логов: свои у каждого, всегда одни и те же, игроку не выбрать', () => {
    const codes = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const a = lairArms(`lair-${i}`);
      expect(lairArms(`lair-${i}`)).toEqual(a);
      expect(WILD_CHARGES as readonly string[]).toContain(a.charge);
      expect(armsRule(a), armsCode(a)).toBeNull();
      expect(anyArms(armsCode(a))).toEqual(a);
      expect(readArms(armsCode(a))).toBeNull();
      codes.add(armsCode(a));
    }
    expect(codes.size).toBeGreaterThan(40);
    expect(readArms(armsCode(BANDIT_ARMS))).toBeNull();
    expect(anyArms(armsCode(BANDIT_ARMS))).toEqual(BANDIT_ARMS);
  });
});

describe('герб: правка в конструкторе и блазон', () => {
  it('любая правка одной части даёт правильный герб, и выбранное игроком не теряется', () => {
    let n = 0;
    for (const division of DIVISIONS)
      for (const f1 of TINCTURES)
        for (const f2 of TINCTURES)
          for (const tint of TINCTURES)
            for (const keep of ['field0', 'field1', 'tint', 'other'] as const) {
              const a: Arms = { shield: 'french', division, field: [f1, division === 'plain' ? f1 : f2], charge: 'eagle', tint };
              const { arms, note } = fitArms(a, keep);
              expect(armsRule(arms), `${armsCode(a)} ${keep}`).toBeNull();
              expect(note === null).toBe(armsRule(a) === null);
              if (keep === 'field0') expect(arms.field[0]).toBe(f1);
              if (keep === 'field1' && division !== 'plain') expect(arms.field[1]).toBe(f2);
              if (keep === 'tint') expect(arms.tint).toBe(tint);
              n++;
            }
    expect(n).toBe(DIVISIONS.length * TINCTURES.length ** 3 * 4);
  });

  it('блазон по правилам языка гербовника', () => {
    expect(blazon(DEFAULT_ARMS)).toBe('В золотом поле чёрная башня.');
    expect(blazon({ shield: 'heater', division: 'plain', field: ['gules', 'gules'], charge: 'lion', tint: 'argent' })).toBe(
      'В червлёном поле серебряный лев.',
    );
    expect(blazon({ shield: 'heater', division: 'quarterly', field: ['azure', 'or'], charge: 'keys', tint: 'gules' })).toBe(
      'В четверочастном лазоревом и золотом щите червлёные ключи.',
    );
  });
});
