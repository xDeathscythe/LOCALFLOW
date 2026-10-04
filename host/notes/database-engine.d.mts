import type { NotesDatabase, DatabaseRow, DatabaseView, Condition } from '../../src/lib/database';
export function displayValue(value: unknown): string;
export function isEmpty(value: unknown): boolean;
export function matches(values: Record<string, unknown>, filter?: Condition): boolean;
export function formula(expression: string, values: Record<string, unknown>): unknown;
export function computedRows(database: NotesDatabase, databases?: NotesDatabase[]): DatabaseRow[];
export function queryRows(database: NotesDatabase, view?: DatabaseView, databases?: NotesDatabase[]): DatabaseRow[];
export function sortRows(rows: DatabaseRow[], sorts?: DatabaseView['sorts']): DatabaseRow[];
