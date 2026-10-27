/** Типы вести ночной приёмки (`night-message.mjs`): сам модуль — простой JS, его запускает `node` из копии ночных скриптов. */

export interface ReportRow {
  name: string;
  ok: boolean;
  seconds: number;
  missed: boolean;
  verdict: string;
}

export interface Step {
  step: string;
  code: number;
  seconds: number;
}

export interface Night {
  meta: Record<string, string>;
  steps: Step[];
  testLog: string | null;
  reportsLog: string | null;
  pulse: string | null;
}

export const STEPS: readonly string[];
export function reportRows(log: string): ReportRow[] | null;
export function matched(r: ReportRow): boolean;
export function testsOf(log: string): { files: string[]; total: string | null };
export function span(sec: number): string;
export function pulseOf(tsv: string): { max: number; median: number; first: number; last: number; n: number } | null;
export function nightMessage(night: Night): { text: string; accepted: boolean };
export function readNight(dir: string): Night;
