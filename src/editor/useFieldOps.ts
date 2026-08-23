import { useCallback } from 'react';
import { useDialog } from '../components/Dialog';
import { fieldFits, fieldShapeLabel, type FieldTarget } from '../lib/fieldtypes';
import { uuid } from '../lib/ids';
import { insertFieldAt, plainText, wrapField, type TextRange } from '../lib/richtext';
import {
  autoFieldName,
  resolveFieldInline,
  valueAsRich,
  valueAsTable,
  wouldCreateCycle,
} from '../lib/syncfields';
import { useAuth } from '../store/auth';
import { createField, updateFieldValue } from '../store/fields';
import type { Block, RichText, SyncDirection, SyncField } from '../types';
import { useEditor } from './EditorProvider';
import { useWorkspace } from './workspaceContext';

/**
 * Shared sync-field operations. Every entry point (inspector, canvas
 * format bar, context menu) funnels through here so the type rules,
 * nesting, cycle-guard and parent mirroring can't drift apart.
 */
export function useFieldOps(opts: { newFieldFolder?: string } = {}) {
  const { project, fields, fieldMap, setFields, doc } = useWorkspace();
  /** Folder that newly created fields land in (the panel's current one). */
  const newFieldFolder = opts.newFieldFolder ?? '';
  const { dispatch } = useEditor();
  const { user } = useAuth();
  const dialog = useDialog();

  /** Default direction for a new embed: the master owns its wording. */
  const defaultDirection: SyncDirection = doc.kind === 'master' ? 'two-way' : 'down';

  /** Refuse an operation whose field shape doesn't suit the target. */
  const checkFit = useCallback(
    async (field: SyncField, target: FieldTarget): Promise<boolean> => {
      const fit = fieldFits(field.value, target);
      if (fit.ok) return true;
      await dialog.alert(`“${field.name}” doesn’t fit here`, {
        message: `${fit.reason} (it is a ${fieldShapeLabel(field.value)} field)`,
      });
      return false;
    },
    [dialog],
  );

  /** Mirror a nested embed into the enclosing field's canonical value. */
  const mirrorIntoParent = useCallback(
    async (
      parentFieldId: string,
      parentRel: { start: number; end: number },
      fieldId: string,
      mode: 'wrap' | 'insert',
      children: RichText[number],
    ) => {
      if (!user) return;
      const parent = fieldMap.get(parentFieldId);
      if (!parent) return;
      const parentRich = valueAsRich(parent.value);
      const range = { para: 0, start: parentRel.start, end: parentRel.end };
      const res =
        mode === 'wrap'
          ? wrapField(parentRich, range, fieldId, 'down')
          : insertFieldAt(parentRich, range, fieldId, 'down', children);
      if (!res) return;
      await updateFieldValue(parent.id, { kind: 'richtext', rich: res.rich }, user.uid);
      setFields((prev) =>
        prev.map((f) =>
          f.id === parent.id ? { ...f, value: { kind: 'richtext', rich: res.rich } } : f,
        ),
      );
    },
    [user, fieldMap, setFields],
  );

  /**
   * Turn `range` of `rich` into a field span — creating the field from the
   * selected text when `fieldId` is omitted. The selection's own text
   * becomes the field's value.
   */
  const bindRange = useCallback(
    async (
      rich: RichText,
      range: TextRange | null,
      opts: { fieldId?: string; direction?: SyncDirection } = {},
    ): Promise<RichText | null> => {
      if (!user) return null;
      if (!range || range.end === range.start) {
        await dialog.alert('Nothing selected', {
          message: 'Select the text to sync first, inside one paragraph.',
        });
        return null;
      }
      const createNew = !opts.fieldId;
      const existing = opts.fieldId ? fieldMap.get(opts.fieldId) : undefined;
      if (existing && !(await checkFit(existing, 'inline'))) return null;

      const fieldId = opts.fieldId ?? uuid();
      const direction = opts.direction ?? defaultDirection;

      const res = wrapField(rich, range, fieldId, direction);
      if (!res) {
        await dialog.alert('Selection crosses a synced span', {
          message:
            'A field must sit fully inside or fully around an existing one. Select within a single span, or around the whole of it.',
        });
        return null;
      }
      if (res.parentFieldId && !createNew && wouldCreateCycle(fieldId, res.parentFieldId, fieldMap)) {
        await dialog.alert('That would create a cycle', {
          message: `“${existing?.name ?? 'This field'}” already contains the field you are nesting it into.`,
        });
        return null;
      }

      if (createNew) {
        const name = autoFieldName(res.text, new Set(fields.map((f) => f.name)));
        const field = await createField({
          id: fieldId,
          projectId: project.id,
          spaceId: project.spaceId,
          scope: 'local',
          folder: newFieldFolder,
          name,
          value: { kind: 'richtext', rich: [res.children.map((c) => ({ ...c }))] },
          userId: user.uid,
        });
        setFields((prev) => [...prev.filter((f) => f.id !== field.id), field]);
      }

      if (res.parentFieldId && res.parentRel) {
        await mirrorIntoParent(res.parentFieldId, res.parentRel, fieldId, 'wrap', []);
      }

      dispatch({ type: 'FIELDS_CHANGED', fields: fieldMap });
      return res.rich;
    },
    [
      user,
      dialog,
      checkFit,
      defaultDirection,
      fieldMap,
      fields,
      project.id,
      project.spaceId,
      newFieldFolder,
      setFields,
      dispatch,
      mirrorIntoParent,
    ],
  );

  /**
   * Insert an EXISTING field at the caret (or over the selection). Unlike
   * bindRange, the field's current value provides the text — this is how
   * you drop a shared sentence, number or price into new copy.
   */
  const insertField = useCallback(
    async (
      rich: RichText,
      range: TextRange | null,
      fieldId: string,
      opts: { direction?: SyncDirection; target?: FieldTarget } = {},
    ): Promise<RichText | null> => {
      if (!user) return null;
      const field = fieldMap.get(fieldId);
      if (!field) return null;
      if (!(await checkFit(field, opts.target ?? 'inline'))) return null;
      if (!range) {
        await dialog.alert('No insertion point', {
          message: 'Click into the text where the field should go, then insert it.',
        });
        return null;
      }

      const children = resolveFieldInline(fieldId, fieldMap) ?? [
        { text: plainText(valueAsRich(field.value)) },
      ];
      const res = insertFieldAt(
        rich,
        range,
        fieldId,
        opts.direction ?? defaultDirection,
        children,
      );
      if (!res) {
        await dialog.alert('Cannot insert here', {
          message: 'The insertion point crosses a synced span boundary. Click inside or outside it.',
        });
        return null;
      }
      if (res.parentFieldId && wouldCreateCycle(fieldId, res.parentFieldId, fieldMap)) {
        await dialog.alert('That would create a cycle', {
          message: `“${field.name}” already contains the field you are nesting it into.`,
        });
        return null;
      }
      if (res.parentFieldId && res.parentRel) {
        await mirrorIntoParent(res.parentFieldId, res.parentRel, fieldId, 'insert', children);
      }

      dispatch({ type: 'FIELDS_CHANGED', fields: fieldMap });
      return res.rich;
    },
    [user, fieldMap, checkFit, dialog, defaultDirection, dispatch, mirrorIntoParent],
  );

  /**
   * Bind a whole block to an existing field, applying the field's value
   * straight away. Enforces text↔text and table↔table.
   */
  const bindBlockToField = useCallback(
    async (
      block: Block,
      fieldId: string,
      direction?: SyncDirection,
    ): Promise<Partial<Block> | null> => {
      const field = fieldMap.get(fieldId);
      if (!field) return null;
      const target: FieldTarget | null =
        block.type === 'text' ? 'textBlock' : block.type === 'table' ? 'tableBlock' : null;
      if (!target) {
        await dialog.alert('Images cannot be synced by field', {
          message: 'Bind an image block to its master block instead.',
        });
        return null;
      }
      if (!(await checkFit(field, target))) return null;

      const binding = {
        fieldId,
        sourceBlockId: block.id,
        direction: direction ?? defaultDirection,
      };

      if (block.type === 'table') {
        const table = valueAsTable(field.value)!;
        return {
          binding,
          headerRow: table.headerRow,
          rows: table.rows.map((row) => row.map((cell) => cell)),
        } as Partial<Block>;
      }
      return { binding, body: valueAsRich(field.value) } as Partial<Block>;
    },
    [fieldMap, checkFit, dialog, defaultDirection],
  );

  /** Promote a whole block into a new field of the matching shape. */
  const createFieldFromBlock = useCallback(
    async (block: Block): Promise<Partial<Block> | null> => {
      if (!user) return null;
      const id = uuid();
      const existingNames = new Set(fields.map((f) => f.name));

      if (block.type === 'table') {
        const name = autoFieldName(plainText(block.rows[0]?.[0] ?? []) || 'table', existingNames);
        const field = await createField({
          id,
          projectId: project.id,
          spaceId: project.spaceId,
          scope: 'local',
          folder: newFieldFolder,
          name,
          value: { kind: 'table', headerRow: block.headerRow, rows: block.rows },
          userId: user.uid,
        });
        setFields((prev) => [...prev, field]);
        return { binding: { fieldId: id, sourceBlockId: block.id, direction: 'two-way' } };
      }
      if (block.type === 'text') {
        const name = autoFieldName(plainText(block.body) || 'text', existingNames);
        const field = await createField({
          id,
          projectId: project.id,
          spaceId: project.spaceId,
          scope: 'local',
          folder: newFieldFolder,
          name,
          value: { kind: 'richtext', rich: block.body },
          userId: user.uid,
        });
        setFields((prev) => [...prev, field]);
        return { binding: { fieldId: id, sourceBlockId: block.id, direction: 'two-way' } };
      }
      return null;
    },
    [user, fields, project.id, project.spaceId, newFieldFolder, setFields],
  );

  return {
    bindRange,
    insertField,
    bindBlockToField,
    createFieldFromBlock,
    defaultDirection,
    checkFit,
  };
}
