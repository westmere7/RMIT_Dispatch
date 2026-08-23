import { useCallback } from 'react';
import { useDialog } from '../components/Dialog';
import { uuid } from '../lib/ids';
import { wrapField, type TextRange } from '../lib/richtext';
import { autoFieldName, valueAsRich, wouldCreateCycle } from '../lib/syncfields';
import { useAuth } from '../store/auth';
import { createField, updateFieldValue } from '../store/fields';
import type { RichText, SyncDirection } from '../types';
import { useEditor } from './EditorProvider';
import { useWorkspace } from './workspaceContext';

/**
 * Shared sync-field operations. Every entry point (inspector toolbar,
 * canvas format bar, context menu) funnels through here so the nesting,
 * cycle-guard and parent-mirroring rules can't drift apart.
 */
export function useFieldOps() {
  const { project, fields, fieldMap, setFields, doc } = useWorkspace();
  const { dispatch } = useEditor();
  const { user } = useAuth();
  const dialog = useDialog();

  /** Default direction for a new embed: the master owns its wording. */
  const defaultDirection: SyncDirection = doc.kind === 'master' ? 'two-way' : 'down';

  /**
   * Wrap `range` of `rich` in a field span. Creates the field first when
   * `fieldId` is omitted. Returns the new RichText, or null if refused.
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
          message: `“${fields.find((f) => f.id === fieldId)?.name ?? 'This field'}” already contains the field you are nesting it into.`,
        });
        return null;
      }

      if (createNew) {
        const name = autoFieldName(res.text, new Set(fields.map((f) => f.name)));
        const field = await createField({
          id: fieldId,
          projectId: project.id,
          name,
          value: { kind: 'richtext', rich: [res.children.map((c) => ({ ...c }))] },
          userId: user.uid,
        });
        setFields((prev) => [...prev.filter((f) => f.id !== field.id), field]);
      }

      // A nested field must also exist inside the parent's canonical value,
      // so every document embedding the parent inherits the nesting.
      if (res.parentFieldId && res.parentRel) {
        const parent = fieldMap.get(res.parentFieldId);
        if (parent) {
          const wrapped = wrapField(
            valueAsRich(parent.value),
            { para: 0, start: res.parentRel.start, end: res.parentRel.end },
            fieldId,
            'down',
          );
          if (wrapped) {
            await updateFieldValue(parent.id, { kind: 'richtext', rich: wrapped.rich }, user.uid);
            setFields((prev) =>
              prev.map((f) =>
                f.id === parent.id ? { ...f, value: { kind: 'richtext', rich: wrapped.rich } } : f,
              ),
            );
          }
        }
      }

      dispatch({ type: 'FIELDS_CHANGED', fields: fieldMap });
      return res.rich;
    },
    [user, dialog, defaultDirection, fieldMap, fields, project.id, setFields, dispatch],
  );

  return { bindRange, defaultDirection };
}
