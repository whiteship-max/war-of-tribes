/**
 * Управление от первого лица.
 *
 * Главное обещание этого файла — не про стик и не про поворот, а про то, что
 * **третьего свода правил о пальце в игре не завелось**: пороги тапа приезжают
 * из `@/gestures` и нигде здесь не переписаны. Проверяется это чтением
 * исходника, потому что иначе договор держится на честном слове ровно до
 * следующей правки: новая константа `TAP_*` в модуле ничем себя не выдаёт, а
 * разойдутся копии молча — так уже было с разбором жеста у деревни и карты.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TAP_MOVE, TAP_MS, TAP_SLIP } from '@/gestures';
import { Keys, LOOK_RAD_PER_PX, PITCH_LIMIT, STICK_DEAD, STICK_FULL, Sticks, mergeWalk } from './controls';

/** Экран телефона: все числа ниже — с него. */
const W = 375;

const strip = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('пороги тапа — общие, а не свои', () => {
  it('мёртвая зона стика это и есть `TAP_MOVE`', () => {
    expect(STICK_DEAD).toBe(TAP_MOVE);
  });

  it('модуль не заводит своих чисел о тапе', () => {
    const src = strip(readFileSync(join(__dirname, 'controls.ts'), 'utf8'));
    // Своё определение любого из порогов — ошибка: расходиться им негде, кроме
    // как в дне, когда правят одну копию.
    for (const name of ['TAP_MOVE', 'TAP_SLIP', 'TAP_MS', 'TAP_TARGET', 'TAP_FORGIVE']) {
      expect(src, `переписан порог ${name}`).not.toMatch(new RegExp(`(const|let)\\s+${name}\\s*=`));
    }
    expect(src, 'пороги берутся не у общего разбора жеста').toMatch(/from '@\/gestures'/);
  });

  it('приговор «тап или ведение» выносит `Press`, а не этот модуль', () => {
    const src = strip(readFileSync(join(__dirname, 'controls.ts'), 'utf8'));
    expect(src).toContain('new Press(');
    expect(src).toContain('press.isTap(');
    // Своей арифметики про длительность и сход здесь быть не должно.
    expect(src, 'свой счёт длительности тапа').not.toMatch(/now\s*-\s*\w+\.t\s*[<>]/);
  });

  it('вся сцена и оболочка тоже не заводят своих порогов', () => {
    for (const file of ['scene.ts', 'Prologue.tsx', 'glade.ts']) {
      const src = strip(readFileSync(join(__dirname, file), 'utf8'));
      for (const name of ['TAP_MOVE', 'TAP_SLIP', 'TAP_MS']) {
        expect(src, `${file}: своё ${name}`).not.toMatch(new RegExp(`(const|let)\\s+${name}\\s*=`));
      }
    }
  });
});

describe('левая половина ведёт, правая смотрит', () => {
  it('палец слева даёт ход, палец справа — поворот', () => {
    const s = new Sticks();
    s.down(1, 60, 700, 0, W);
    s.move(1, 60, 640, 10);
    expect(s.walk().forward).toBeGreaterThan(0);
    expect(s.takeLook()).toEqual({ yaw: 0, pitch: 0 });

    s.down(2, 300, 500, 20, W);
    s.move(2, 260, 500, 30);
    const look = s.takeLook();
    expect(look.yaw).toBeCloseTo(40 * LOOK_RAD_PER_PX, 9);
    // Правый палец на ход не влияет: он смотрит.
    expect(s.walk().forward).toBeGreaterThan(0);
  });

  it('идти и смотреть можно одновременно — ради этого всё и написано', () => {
    const s = new Sticks();
    s.down(1, 50, 700, 0, W);
    s.down(2, 320, 400, 0, W);
    s.move(1, 50, 630, 16);
    s.move(2, 280, 400, 16);
    expect(s.walk().forward).toBeGreaterThan(0.9);
    expect(s.takeLook().yaw).toBeGreaterThan(0);
  });

  it('второй палец в ту же половину не перебивает первый', () => {
    // Ладонь, легшая краем, не должна отбирать стик у большого пальца.
    const s = new Sticks();
    s.down(1, 50, 700, 0, W);
    s.move(1, 50, 640, 10);
    s.down(2, 90, 720, 20, W);
    s.move(2, 90, 760, 30);
    expect(s.stick?.ox).toBe(50);
    expect(s.walk().forward).toBeGreaterThan(0);
  });

  it('половина выбирается один раз: уехавший за середину палец не меняет дела', () => {
    const s = new Sticks();
    s.down(1, 40, 700, 0, W);
    s.move(1, 340, 700, 40);
    // Палец за серединой экрана, но он по-прежнему стик, а не взгляд.
    expect(s.takeLook()).toEqual({ yaw: 0, pitch: 0 });
    expect(s.walk().strafe).toBeCloseTo(1, 6);
  });
});

describe('стик ходьбы', () => {
  it('в мёртвой зоне стоим', () => {
    const s = new Sticks();
    s.down(1, 100, 700, 0, W);
    s.move(1, 100 + STICK_DEAD - 1, 700, 10);
    expect(s.walk()).toEqual({ forward: 0, strafe: 0 });
  });

  it('на полном отклонении идём в полную силу и не быстрее', () => {
    const s = new Sticks();
    s.down(1, 100, 700, 0, W);
    s.move(1, 100, 700 - STICK_FULL, 10);
    expect(s.walk().forward).toBeCloseTo(1, 6);
    s.move(1, 100, 700 - STICK_FULL * 4, 20);
    expect(s.walk().forward).toBeCloseTo(1, 6);
  });

  it('по диагонали не быстрее, чем прямо', () => {
    const s = new Sticks();
    s.down(1, 100, 700, 0, W);
    s.move(1, 100 + 200, 700 - 200, 10);
    const w = s.walk();
    expect(Math.hypot(w.forward, w.strafe)).toBeCloseTo(1, 6);
  });

  it('на полпути идём вполсилы: промежуточные скорости есть', () => {
    const s = new Sticks();
    s.down(1, 100, 700, 0, W);
    s.move(1, 100, 700 - (STICK_DEAD + (STICK_FULL - STICK_DEAD) / 2), 10);
    expect(s.walk().forward).toBeCloseTo(0.5, 2);
  });

  it('снятый палец останавливает', () => {
    const s = new Sticks();
    s.down(1, 100, 700, 0, W);
    s.move(1, 100, 600, 10);
    s.up(1, 20);
    expect(s.walk()).toEqual({ forward: 0, strafe: 0 });
    expect(s.stick).toBeNull();
  });
});

describe('тап — это действие, и он тот же самый тап', () => {
  it('неподвижное короткое касание — тап', () => {
    const s = new Sticks();
    s.down(1, 200, 400, 0, W);
    expect(s.up(1, 200)?.tap).toBe(true);
  });

  it('касание, ушедшее дальше `TAP_SLIP`, тапом не будет', () => {
    const s = new Sticks();
    s.down(1, 200, 400, 0, W);
    s.move(1, 200 + TAP_SLIP + 1, 400, 50);
    expect(s.up(1, 100)?.tap).toBe(false);
  });

  it('сход в пределах `TAP_SLIP` тап не убивает, даже если целились долго', () => {
    // Ровно та жалоба, из-за которой в деревне убрали выдержку: палец, ложась,
    // проезжает 14–20 px, а потом лежит неподвижно, пока игрок целится.
    const s = new Sticks();
    s.down(1, 200, 400, 0, W);
    s.move(1, 218, 406, 70);
    expect(s.up(1, 400)?.tap).toBe(true);
  });

  it('палец, забытый на экране дольше `TAP_MS`, тапом не был', () => {
    const s = new Sticks();
    s.down(1, 200, 400, 0, W);
    expect(s.up(1, TAP_MS + 1)?.tap).toBe(false);
  });

  it('тап годится из обеих половин: действовать можно одной рукой', () => {
    const s = new Sticks();
    s.down(1, 40, 700, 0, W);
    expect(s.up(1, 100)?.tap).toBe(true);
    s.down(2, 340, 300, 0, W);
    expect(s.up(2, 100)?.tap).toBe(true);
  });

  it('снятое нажатие отдаётся наружу целиком — журналу нужны измеренные числа', () => {
    const s = new Sticks();
    s.down(1, 200, 400, 0, W);
    s.move(1, 210, 400, 30);
    s.move(1, 200, 400, 60);
    const done = s.up(1, 90);
    expect(done?.press.far).toBeCloseTo(10, 6);
    expect(done?.press.path).toBeCloseTo(20, 6);
  });

  it('отменённый браузером жест не возвращается ничем', () => {
    const s = new Sticks();
    s.down(1, 200, 400, 0, W);
    s.cancel(1);
    expect(s.up(1, 10)).toBeNull();
    expect(s.walk()).toEqual({ forward: 0, strafe: 0 });
  });
});

describe('взгляд', () => {
  it('копится между кадрами и забирается начисто', () => {
    // За один кадр `pointermove` приходит несколько раз, и потерянные между
    // ними пиксели — это потерянный поворот.
    const s = new Sticks();
    s.down(1, 300, 400, 0, W);
    s.move(1, 290, 400, 4);
    s.move(1, 280, 400, 8);
    s.move(1, 270, 400, 12);
    expect(s.takeLook().yaw).toBeCloseTo(30 * LOOK_RAD_PER_PX, 9);
    expect(s.takeLook().yaw).toBe(0);
  });

  it('тяга влево поворачивает вправо и наоборот: мир едет за пальцем', () => {
    const s = new Sticks();
    s.down(1, 300, 400, 0, W);
    s.move(1, 340, 400, 10);
    expect(s.takeLook().yaw).toBeLessThan(0);
  });

  it('удобная тяга поперёк своей половины — три четверти прямого угла', () => {
    // Осмотреться кругом выходит за три-четыре тяги. Это и есть проверка того,
    // что чувствительность выбрана, а не оставлена по умолчанию.
    const deg = (150 * LOOK_RAD_PER_PX * 180) / Math.PI;
    expect(deg).toBeGreaterThan(60);
    expect(deg).toBeLessThan(90);
  });

  it('голова не запрокидывается за отвес', () => {
    expect(PITCH_LIMIT).toBeLessThan(Math.PI / 2);
    expect(PITCH_LIMIT).toBeGreaterThan(Math.PI / 4);
  });
});

describe('клавиши на ПК', () => {
  it('латиница и стрелки ведут одинаково, раскладка не важна', () => {
    const k = new Keys();
    expect(k.down('KeyW')).toBe(true);
    expect(k.walk()).toEqual({ forward: 1, strafe: 0 });
    k.up('KeyW');
    expect(k.down('ArrowUp')).toBe(true);
    expect(k.walk()).toEqual({ forward: 1, strafe: 0 });
  });

  it('чужие клавиши не перехватываются', () => {
    const k = new Keys();
    expect(k.down('KeyQ')).toBe(false);
    expect(k.down('Tab')).toBe(false);
    expect(k.walk()).toEqual({ forward: 0, strafe: 0 });
  });

  it('две клавиши разом дают диагональ, а не двойную скорость', () => {
    const k = new Keys();
    k.down('KeyW');
    k.down('KeyD');
    const w = k.walk();
    expect(Math.hypot(w.forward, w.strafe)).toBeCloseTo(1, 6);
  });

  it('противоположные клавиши гасят друг друга', () => {
    const k = new Keys();
    k.down('KeyW');
    k.down('KeyS');
    expect(k.walk()).toEqual({ forward: 0, strafe: 0 });
  });

  it('уход с окна отпускает всё: зажатая навсегда клавиша хуже незажатой', () => {
    const k = new Keys();
    k.down('KeyW');
    k.clear();
    expect(k.walk()).toEqual({ forward: 0, strafe: 0 });
  });
});

describe('палец и клавиши складываются', () => {
  it('вместе они не разгоняют быстрее одного', () => {
    const w = mergeWalk({ forward: 1, strafe: 0 }, { forward: 1, strafe: 0 });
    expect(Math.hypot(w.forward, w.strafe)).toBeCloseTo(1, 6);
  });

  it('порознь каждый работает как был', () => {
    expect(mergeWalk({ forward: 0.4, strafe: 0 }, { forward: 0, strafe: 0 })).toEqual({ forward: 0.4, strafe: 0 });
    expect(mergeWalk({ forward: 0, strafe: 0 }, { forward: 0, strafe: -1 })).toEqual({ forward: 0, strafe: -1 });
  });
});
