import { Type } from 'typebox';
import { defineTool } from '../niwa/host/niwa-tools.mjs';
export const notesTools = notes => [
  defineTool('notes_database_button','Run a configured local database button using the exact current revision.',{id:Type.String(),rowId:Type.String(),propertyId:Type.String(),revision:Type.String()},'memory',p=>notes.databaseRunButton(p)),
  defineTool('notes_list','List local Markdown pages, nested pages, folders and databases.',{},'read',()=>notes.list()),
  defineTool('notes_read','Read a Markdown page and revision before editing.',{id:Type.String()},'read',p=>notes.read(p.id)),
  defineTool('notes_create','Create a Markdown page, folder or database. Use structured Markdown for reports and voice notes.',{label:Type.String(),content:Type.Optional(Type.String()),parentId:Type.Optional(Type.String()),kind:Type.Optional(Type.Union(['note','folder','database'].map(Type.Literal)))},'memory',p=>notes.create(p)),
  defineTool('notes_update','Save a Markdown page with the exact revision from notes_read. This replaces rich formatting with the supplied Markdown.',{id:Type.String(),label:Type.String(),content:Type.String(),revision:Type.String()},'memory',p=>notes.save(p)),
  defineTool('notes_move','Move a page, folder or database. Omit parentId for the notes root.',{id:Type.String(),parentId:Type.Optional(Type.String())},'memory',p=>notes.move(p)),
  defineTool('notes_database_read','Read the complete local database: typed properties, rows, views and revision.',{id:Type.String()},'read',p=>notes.databaseRead(p.id)),
  defineTool('notes_database_query','Query a saved database view, including formulas, rollups, nested conditions and sorting.',{id:Type.String(),viewId:Type.Optional(Type.String())},'read',p=>notes.databaseQuery(p)),
  defineTool('notes_database_save','Save complete database properties, rows and views using the revision from notes_database_read. Preserve other rows and source metadata.',{id:Type.String(),revision:Type.String(),properties:Type.Array(Type.Any()),rows:Type.Array(Type.Any()),views:Type.Array(Type.Any()),source:Type.Optional(Type.Any())},'memory',p=>notes.databaseSave(p)),
  defineTool('notes_database_add_row','Create a database row with a corresponding Markdown page.',{id:Type.String(),label:Type.Optional(Type.String()),values:Type.Optional(Type.Record(Type.String(),Type.Any()))},'memory',p=>notes.databaseAddRow(p)),
];
