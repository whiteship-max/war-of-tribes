// Какими часами идёт срок — в типе. Проверяет это не vitest, а компилятор: строки с
// `@ts-expect-error` ниже обязаны быть ошибкой. Пропади метка игровых секунд (`GameSec`) или ослабни
// вход форматтера — ошибка исчезнет, «ожидаемая ошибка» станет лишней, и упадёт `npm run typecheck`
// (он входит в пол приёмки). Сам тест при этом проверяет только, что форматтеры считают верно.
import { afterEach, describe, expect, it } from 'vitest';
import { asGame, realSeconds, setTimeScale, timeScale } from '@/game/pace';
import { formatLeft, travelTime } from '@/world/geo';
import { realLeft, realMinSec, waitEta, waitLeft, waitMinSec, waitShort, waitSpan } from './wait';

afterEach(() => setTimeScale());

describe('сроки словами', () => {
  it('срок племени показан настоящим временем, срок мира — как есть', () => {
    setTimeScale(30);
    expect(timeScale(), 'точка внутри области: шкала отлична от единицы').not.toBe(1);
    expect(waitShort(asGame(40))).toBe('1200 с');
    expect(waitMinSec(asGame(10))).toBe('5 мин');
    expect(waitEta(asGame(40))).toBe('~20 м');
    expect(waitSpan(asGame(180))).toBe('1 ч 30 мин');
    expect(waitLeft(asGame(8))).toBe(formatLeft(240));
    expect(realMinSec(160)).toBe('2 мин 40 с');
    expect(realLeft(247)).toBe(formatLeft(247));
  });

  it('срок, названный игровым, форматтер настоящего времени не принимает — и наоборот', () => {
    const game = asGame(40);
    const real = 40;
    // @ts-expect-error — игровые секунды в форматтер мира не проходят
    formatLeft(game);
    // @ts-expect-error — и в форматтер настоящего времени модуля сроков
    realMinSec(game);
    // @ts-expect-error — срок без названных часов в форматтер племени не проходит
    waitShort(real);
    // Время пути — тоже игровые секунды (`geo.travelTime`, решение владельца, docs/time.md,
    // раздел 19): игрок ждёт поход своими часами, и напечатать его мимо двери нельзя.
    const road = travelTime(10, 1, 4.5);
    // @ts-expect-error — время пути в форматтер мира не проходит
    formatLeft(road);
    expect(waitLeft(road), 'путь показан настоящим временем').toBe(formatLeft(realSeconds(road)));
    // Законные пути: перевод дверью и явное «это игровые секунды».
    expect(formatLeft(realSeconds(game))).toBe(formatLeft(40 * timeScale()));
    expect(waitShort(asGame(real))).toBe(`${40 * timeScale()} с`);
  });
});
