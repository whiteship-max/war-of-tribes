/** Типы замка машины (`machinelock.mjs`): сам модуль — простой JS, его запускает `node` любого проекта. */

export interface LockRecord {
  project: string;
  task: string;
  pid: number;
  started: string;
}

export interface BrokenLock {
  broken: true;
  age: number;
}

export type Held = LockRecord | BrokenLock;

export interface TakeOptions {
  file?: string;
  env?: NodeJS.ProcessEnv;
  born?: (pid: number) => number | null;
  mine?: (pid: number) => boolean;
}

export type Take = { taken: true; lock: LockRecord; release: () => void } | { ours: true; lock: LockRecord } | { held: Held };

export const LOCK_FILE: string;
export const LOCK_ENV: string;
export const WRITING_MS: number;
export const POLL_MS: number;
export const SAY_MS: number;
export function tokenOf(rec: LockRecord): string;
export function readLock(file?: string): Held | null;
export function processExists(pid: number): boolean;
export function processBorn(pid: number): number | null;
export function holderAlive(rec: LockRecord, born?: (pid: number) => number | null): boolean;
export function isOurs(rec: Held | null, env?: NodeJS.ProcessEnv): boolean;
export function tryTake(project: string, task: string, options?: TakeOptions): Take;
export function releaseLock(rec: LockRecord, file?: string): void;
export function holderWords(held: Held): string;
export function takeLock(
  project: string,
  task: string,
  options?: TakeOptions & { say?: (line: string) => void; pollMs?: number; sayMs?: number },
): Promise<() => void>;
