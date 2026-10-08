// Types for verify-purge.mjs so TypeScript tests can import it. The script itself is plain JS (Node 20, no build step).
export type Query = (sql: string, params?: unknown[]) => Promise<Array<Record<string, unknown>>>;
export type CheckStatus = "PASS" | "FAIL" | "INFO";
export type Check = { id: string; status: CheckStatus; label: string; detail: string };
export type Report = { ok: boolean; checks: Check[] };
export type ParsedArgs = { ok: true; eventId: string; database: string } | { ok: false; error: string };
export type Connection = { transaction: <T>(fn: (query: Query) => Promise<T>) => Promise<T>; close: () => Promise<void> };
export type MainDeps = {
  env: Record<string, string | undefined>;
  log: (line: string) => void;
  connect: (url: string) => Promise<Connection>;
};

export const FORBIDDEN_DATABASES: readonly string[];
export function parseArgs(argv: string[]): ParsedArgs;
export function resolveDatabaseUrl(baseUrl: string, database: string): string;
export function verifyPurge(query: Query, eventId: string): Promise<Report>;
export function formatReport(report: Report): string;
export function main(argv: string[], deps?: Partial<MainDeps>): Promise<number>;
