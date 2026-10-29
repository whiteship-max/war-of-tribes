// Стартовый экран (30.10.2026): кнопка «Путь меча» стоит только у того, кому путь открыт (`roamflag.roamOn`), и только у новой
// партии; «Предыстория» видна игрокам и открывает предысторию. Экран рисуется в строку — тем же деревом, что у игрока; что делает
// нажатие, читается из исходника `App` (нажатий в строке нет).
//
// Граница области — утверждениями: путь правда не выпущен, партии на устройстве правда нет (`fresh`), слово сервера об админе правда
// пришло или нет.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { StartScreen } from './StartScreen';
import { useGame } from '@/game/store';
import { ROAM_ON, setRoamOpen } from '@/game/roamflag';
import { useAdmin } from '@/net/admin';
import { PROLOGUE_LABEL, ROAM_LABEL, ROAM_NOTE, START_LABEL, roamShown } from './start';

const screen = (): string =>
  renderToStaticMarkup(createElement(StartScreen, { onEnter: () => {}, onPrologue: () => {}, onRoam: () => null, naming: () => null, settings: null }));

afterEach(() => {
  setRoamOpen(false);
  useAdmin.setState({ roam: false });
});

describe('кнопка «Путь меча» на стартовом экране', () => {
  it('правило: путь открыт и партии нет', () => {
    expect(roamShown(true, true)).toBe(true);
    expect(roamShown(false, true)).toBe(false);
    expect(roamShown(true, false)).toBe(false);
    expect(ROAM_LABEL).not.toBe(START_LABEL.new);
    expect(ROAM_NOTE).toMatch(/админ/);
  });

  // Строка рисуется начальным состоянием сторов (`getServerSnapshot`): «партия есть» здесь не подменить — его держит правило выше и
  // то, что экран спрашивает именно его (`roamShown(roamOn(), fresh)`).
  it('игрок её не видит; админ у новой партии — видит', () => {
    expect(ROAM_ON, 'граница: путь не выпущен').toBe(false);
    expect(useGame.getState().fresh, 'граница: партии на устройстве нет').toBe(true);
    expect(screen()).not.toContain(ROAM_LABEL);
    setRoamOpen(true);
    useAdmin.setState({ roam: true });
    expect(screen()).toContain(ROAM_LABEL);
    expect(screen()).toContain(ROAM_NOTE);
    expect(readFileSync(join(__dirname, 'StartScreen.tsx'), 'utf8')).toContain('roamShown(roamOn(), fresh)');
  });

  it('нажатие входит в путь дверью стора и уводит в игру', () => {
    const app = readFileSync(join(__dirname, '..', 'App.tsx'), 'utf8');
    expect(app).toMatch(/onRoam=\{\(\) => \{\s*const why = useGame\.getState\(\)\.beginRoamParty\(\);\s*if \(why\) return why;\s*setStarted\(true\);/);
  });
});

describe('кнопка «Предыстория»', () => {
  it('видна на стартовом экране игроку и админу', () => {
    expect(screen()).toContain(PROLOGUE_LABEL);
    setRoamOpen(true);
    useAdmin.setState({ roam: true });
    expect(screen()).toContain(PROLOGUE_LABEL);
  });

  it('открывает предысторию: нажатие ставит её, и она рисуется вместо стартового экрана', () => {
    const app = readFileSync(join(__dirname, '..', 'App.tsx'), 'utf8');
    expect(app).toContain('onPrologue={() => setPrologue(true)}');
    expect(app).toMatch(/\{prologue && \(\s*<Crash where="предыстория"[\s\S]{0,200}?<Prologue onExit=\{\(\) => setPrologue\(false\)\} \/>/);
    expect(app).toContain("const Prologue = lazy(() => import('./prologue/Prologue')");
    expect(app).toContain('{!started && !prologue && (');
  });
});
