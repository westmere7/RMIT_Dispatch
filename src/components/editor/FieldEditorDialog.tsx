import { useMemo, useState } from 'react';
import { useEditorOptional } from '../../editor/EditorProvider';
import { useWorkspaceOptional } from '../../editor/workspaceContext';
import { normalizeFolder } from '../../lib/fieldtree';
import { fieldShapeLabel } from '../../lib/fieldtypes';
import { cloneRich } from '../../lib/richtext';
import { collectUsages, valueMediaPaths } from '../../lib/syncfields';
import { useAuth } from '../../store/auth';
import { renameField, setFieldFolder, setFieldScope, updateFieldValue } from '../../store/fields';
import { deleteMediaMany } from '../../store/media';
import { useSpaces } from '../../store/spaces';
import type { FieldPart, FieldScope, FieldValue, RichText, SyncField } from '../../types';
import { IconX } from '../Icons';
import { shapeIcon } from './FieldPeek';
import { FolderField } from './FolderField';
import { GroupEditor, ImageEditor, TableEditor } from './FieldValueEditor';
import { RichTextEditor } from './RichTextEditor';

/**
 * Edit a sync field's canonical value in isolation. Which controls appear
 * depends on the field's kind — a value, flowing text, a table, an image,
 * or a combination of those. Saving writes the field itself, so every
 * document embedding it updates without being opened.
 */
export function FieldEditorDialog({
  field,
  onClose,
  onSaved,
  allFields,
  projectId,
}: {
  field: SyncField;
  onClose: () => void;
  onSaved?: () => void;
  allFields?: SyncField[];
  projectId?: string | null;
}) {
  const ws = useWorkspaceOptional();
  const state = useEditorOptional()?.state ?? null;
  const { user } = useAuth();
  const { currentSpace } = useSpaces();
  const spaceId = field.spaceId || currentSpace?.id || '';

  const [name, setName] = useState(field.name);
  const [scope, setScope] = useState<FieldScope>(field.scope);
  const [folder, setFolder] = useState(field.folder);
  const [value, setValue] = useState<FieldValue>(() => cloneValue(field.value));
  const [busy, setBusy] = useState(false);

  const usageCount = useMemo(
    () => (state ? collectUsages(state.pages).filter((u) => u.fieldId === field.id).length : 0),
    [state, field.id],
  );

  const wide = value.kind === 'table' || value.kind === 'group';

  const save = async () => {
    if (!user) return;
    setBusy(true);
    try {
      await updateFieldValue(field.id, value, user.uid);
      if (name.trim() && name.trim() !== field.name) await renameField(field.id, name.trim());

      const cleanFolder = normalizeFolder(folder);
      if (cleanFolder !== field.folder) await setFieldFolder(field.id, cleanFolder);
      if (scope !== field.scope) {
        await setFieldScope(field.id, scope, projectId ?? field.projectId ?? null);
      }

      // Any image dropped during this edit is now unreferenced.
      const before = valueMediaPaths(field.value);
      const after = new Set(valueMediaPaths(value));
      await deleteMediaMany(before.filter((p) => !after.has(p)));

      ws?.setFields((prev) =>
        prev.map((f) =>
          f.id === field.id
            ? {
                ...f,
                value,
                name: name.trim() || f.name,
                folder: cleanFolder,
                scope,
                projectId: scope === 'global' ? null : (projectId ?? f.projectId),
                updatedBy: user.uid,
              }
            : f,
        ),
      );
      onSaved?.();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: wide ? 800 : 560 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <span className="pill pill-accent">
            {shapeIcon(value)} {fieldShapeLabel(value)} field
          </span>
          <h2 style={{ flex: 1 }}>Edit sync field</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <IconX />
          </button>
        </div>
        <p className="muted text-xs" style={{ marginBottom: 16 }}>
          Saving updates the field itself — every document that embeds it follows immediately.
          {usageCount > 0 && ` Used ${usageCount}× in this document.`}
          {scope !== field.scope &&
            (scope === 'global'
              ? ' Making it global shares it with every project in the space.'
              : ' Making it project-only hides it from other projects.')}
        </p>

        <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
          <div className="field" style={{ flex: '2 1 200px' }}>
            <label htmlFor="fe-name">Field name</label>
            <input
              id="fe-name"
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="field" style={{ flex: '1 1 150px' }}>
            <label>Scope</label>
            <div className="segmented">
              {(['local', 'global'] as FieldScope[]).map((sc) => (
                <button
                  key={sc}
                  type="button"
                  className={scope === sc ? 'active' : ''}
                  onClick={() => setScope(sc)}
                  title={
                    sc === 'local'
                      ? 'Only this project can use it'
                      : 'Every project in the space can use it'
                  }
                >
                  {sc === 'local' ? 'Project' : 'Global'}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <FolderField
            id="fe-folder"
            value={folder}
            fields={allFields ?? ws?.fields ?? []}
            onChange={setFolder}
          />
        </div>

        <ValueEditor value={value} spaceId={spaceId} onChange={setValue} />

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={() => void save()} disabled={busy}>
            {busy ? 'Saving…' : 'Save field'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** The right editor for whatever this field holds. */
export function ValueEditor({
  value,
  spaceId,
  onChange,
}: {
  value: FieldValue;
  spaceId: string;
  onChange: (v: FieldValue) => void;
}) {
  switch (value.kind) {
    case 'scalar':
      return (
        <div className="field">
          <label htmlFor="fe-scalar">Value</label>
          <input
            id="fe-scalar"
            className="input"
            value={value.text}
            onChange={(e) => onChange({ kind: 'scalar', text: e.target.value })}
            placeholder="A word, number or short phrase"
          />
          <span className="muted text-xs">
            A single line of plain text — ideal for a year, price or name.
          </span>
        </div>
      );

    case 'richtext':
      return (
        <div className="field">
          <label>Text</label>
          <RichTextEditor
            value={value.rich}
            onChange={(rich: RichText) => onChange({ kind: 'richtext', rich })}
          />
          <span className="muted text-xs">
            Plain content only — styling comes from the block that embeds this field. Nested fields
            keep syncing from their own definitions.
          </span>
        </div>
      );

    case 'table':
      return (
        <TableEditor
          table={value}
          onChange={(t) => onChange({ kind: 'table', headerRow: t.headerRow, rows: t.rows })}
        />
      );

    case 'image':
      return (
        <ImageEditor
          image={value}
          spaceId={spaceId}
          onChange={(img) => onChange({ kind: 'image', ...img })}
        />
      );

    case 'group':
      return (
        <GroupEditor
          parts={value.parts}
          spaceId={spaceId}
          onChange={(parts: FieldPart[]) => onChange({ kind: 'group', parts })}
        />
      );
  }
}

/** Deep copy so edits stay cancellable. */
function cloneValue(v: FieldValue): FieldValue {
  if (v.kind === 'richtext') return { kind: 'richtext', rich: cloneRich(v.rich) };
  if (v.kind === 'table') {
    return { kind: 'table', headerRow: v.headerRow, rows: v.rows.map((r) => r.map(cloneRich)) };
  }
  if (v.kind === 'group') {
    return {
      kind: 'group',
      parts: v.parts.map((p) =>
        p.kind === 'text'
          ? { ...p, rich: cloneRich(p.rich) }
          : p.kind === 'table'
            ? { ...p, rows: p.rows.map((r) => r.map(cloneRich)) }
            : { ...p },
      ),
    };
  }
  return { ...v };
}
