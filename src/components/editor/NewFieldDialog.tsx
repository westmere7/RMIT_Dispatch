import { useState } from 'react';
import { normalizeFolder } from '../../lib/fieldtree';
import type { FieldScope, FieldValue, SyncField } from '../../types';
import { IconImage, IconLayers, IconTable, IconType, IconX } from '../Icons';
import { FolderField } from './FolderField';
import { emptyValueFor } from './FieldValueEditor';
import { ValueEditor } from './FieldEditorDialog';

export interface NewFieldValues {
  name: string;
  scope: FieldScope;
  folder: string;
  value: FieldValue;
}

const KINDS: {
  kind: FieldValue['kind'];
  label: string;
  hint: string;
  icon: typeof IconType;
}[] = [
  {
    kind: 'scalar',
    label: 'Word or value',
    hint: 'A year, price or name — one plain line',
    icon: IconType,
  },
  {
    kind: 'richtext',
    label: 'Text',
    hint: 'A sentence or several paragraphs',
    icon: IconType,
  },
  { kind: 'table', label: 'Table', hint: 'Rows and columns with an optional header', icon: IconTable },
  { kind: 'image', label: 'Image', hint: 'One picture, stored compressed as WebP', icon: IconImage },
  {
    kind: 'group',
    label: 'Combination',
    hint: 'An ordered mix of text, tables and images',
    icon: IconLayers,
  },
];

/**
 * Create a field. The kind is chosen up front because it decides what the
 * field can hold, where it may be embedded, and which settings apply —
 * and the matching editor appears immediately so the field is never
 * created empty by accident.
 */
export function NewFieldDialog({
  spaceId,
  existingFields,
  defaultScope = 'local',
  lockScope,
  onCreate,
  onClose,
  busy,
}: {
  spaceId: string;
  existingFields: SyncField[];
  defaultScope?: FieldScope;
  /** When the caller only makes one kind of field (the global manager). */
  lockScope?: boolean;
  onCreate: (values: NewFieldValues) => void;
  onClose: () => void;
  busy?: boolean;
}) {
  const [kind, setKind] = useState<FieldValue['kind']>('scalar');
  const [name, setName] = useState('');
  const [scope, setScope] = useState<FieldScope>(defaultScope);
  const [folder, setFolder] = useState('');
  const [value, setValue] = useState<FieldValue>(() => emptyValueFor('scalar'));

  const pickKind = (k: FieldValue['kind']) => {
    setKind(k);
    // Start from a blank value of the new kind, seeded with the name so a
    // simple field is usable the moment it is created.
    setValue(emptyValueFor(k, k === 'scalar' || k === 'richtext' ? name.trim() : ''));
  };

  const wide = kind === 'table' || kind === 'group';
  const nameTaken = existingFields.some(
    (f) => f.name.toLowerCase() === name.trim().toLowerCase() && f.scope === scope,
  );

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: wide ? 800 : 620 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <h2 style={{ flex: 1 }}>New sync field</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <IconX />
          </button>
        </div>

        <div className="field" style={{ marginBottom: 14 }}>
          <label>What does this field hold?</label>
          <div className="nf-kinds">
            {KINDS.map((k) => {
              const Icon = k.icon;
              return (
                <button
                  key={k.kind}
                  type="button"
                  className={`nf-kind ${kind === k.kind ? 'active' : ''}`}
                  onClick={() => pickKind(k.kind)}
                >
                  <Icon size={16} />
                  <span className="nf-kind-label">{k.label}</span>
                  <span className="nf-kind-hint">{k.hint}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
          <div className="field" style={{ flex: '2 1 200px' }}>
            <label htmlFor="nf-name">Field name</label>
            <input
              id="nf-name"
              className="input"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. intake-year"
            />
            {nameTaken && (
              <span className="text-xs" style={{ color: 'var(--warning)' }}>
                A field with that name already exists in this scope.
              </span>
            )}
          </div>
          {!lockScope && (
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
          )}
        </div>

        <div style={{ marginBottom: 14 }}>
          <FolderField id="nf-folder" value={folder} fields={existingFields} onChange={setFolder} />
        </div>

        <hr className="divider" style={{ margin: '4px 0 14px' }} />

        <ValueEditor value={value} spaceId={spaceId} onChange={setValue} />

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={!name.trim() || busy}
            onClick={() =>
              onCreate({
                name: name.trim(),
                scope,
                folder: normalizeFolder(folder),
                value,
              })
            }
          >
            {busy ? 'Creating…' : 'Create field'}
          </button>
        </div>
      </div>
    </div>
  );
}
