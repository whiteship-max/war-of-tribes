import type { GameState, LogEntry } from '../types';

const MAX_LOG = 80;

export function log(s: GameState, text: string, kind: LogEntry['kind'] = 'info'): void {
  s.log.unshift({ at: s.time, text, kind });
  if (s.log.length > MAX_LOG) s.log.length = MAX_LOG;
}
