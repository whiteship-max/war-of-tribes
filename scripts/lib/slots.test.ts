// Жетоны на ядра (`slots.ts`): больше `n` разом не выдаётся, отданный жетон переходит следующему.
import { describe, expect, it } from 'vitest';
import { serveSlots, takeSlot } from './slots';

describe('жетоны на ядра', () => {
  it('без сервера жетонов не ждут — ограничивает только TRIBE_FAN', async () => {
    expect(await takeSlot({})).toBeNull();
  });

  it('разом выдаётся не больше n, отданный жетон берёт следующий в очереди', async () => {
    const srv = await serveSlots(2);
    try {
      const a = await takeSlot(srv.env);
      const b = await takeSlot(srv.env);
      let third = false;
      const c = takeSlot(srv.env).then((s) => {
        third = true;
        return s;
      });
      await new Promise((r) => setTimeout(r, 150));
      // Третий ждёт: двое держат оба жетона.
      expect(third).toBe(false);
      a!.release();
      const got = await c;
      expect(third).toBe(true);
      b!.release();
      got!.release();
    } finally {
      await srv.close();
    }
  });
});
