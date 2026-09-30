export type PropertyType = 'title' | 'text' | 'number' | 'select' | 'multi_select' | 'status' | 'date' | 'checkbox' | 'url' | 'email' | 'phone' | 'person' | 'files' | 'relation' | 'formula' | 'rollup' | 'button';
export type Property = { id: string; name: string; type: PropertyType; options?: { name: string; color?: string }[]; expression?: string; target?: string; relation?: string; targetProperty?: string; aggregation?: string; actions?: DatabaseAction[]; buttonLabel?: string; groupValues?: string[]; readonly?: boolean; warning?: string; source?: unknown };
export type Condition = { property?: string; operator: string; value?: unknown; filters?: Condition[] };
export type DatabaseView = { id: string; name: string; type: 'table' | 'board' | 'list' | 'gallery' | 'calendar' | 'timeline' | 'form'; filter?: Condition; sorts?: { property: string; direction: 'asc' | 'desc' }[]; groupBy?: string; dateProperty?: string; visible?: string[]; order?: string[]; widths?: Record<string, number>; wrap?: boolean; colors?: { color: string; filter: Condition }[] };
export type DatabaseRow = { id: string; pageId?: string; values: Record<string, unknown>; errors?: Record<string, string> };
export type NotesDatabase = { id: string; revision: string; properties: Property[]; views: DatabaseView[]; rows: DatabaseRow[]; source?: unknown };

export type DatabaseAction = { type: 'add_row' | 'edit_row'; databaseId?: string; templateId?: string; values: Record<string, {kind: 'property' | 'now' | 'value'; property?: string; value?: unknown}> };
