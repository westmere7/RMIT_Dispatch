import { useEffect, useRef, useState } from 'react';
import { useEditor } from '../../editor/EditorProvider';
import { useFieldOps } from '../../editor/useFieldOps';
import { useWorkspace } from '../../editor/workspaceContext';
import { emptyRich, insertFieldAt } from '../../lib/richtext';
import { resolveFieldInline } from '../../lib/syncfields';
import type { ShapeKind, SyncField } from '../../types';
import {
  IconArrowRight,
  IconCircle,
  IconLine,
  IconShapes,
  IconSquare,
  IconTable,
  IconTriangle,
} from '../Icons';
import { FieldPicker } from './FieldPicker';
import { NewTablePanel } from './NewTablePanel';

const SHAPES: { kind: ShapeKind; label: string; Icon: typeof IconSquare }[] = [
  { kind: 'rect', label: 'Rectangle', Icon: IconSquare },
  { kind: 'rounded', label: 'Rounded', Icon: IconSquare },
  { kind: 'circle', label: 'Ellipse', Icon: IconCircle },
  { kind: 'triangle', label: 'Triangle', Icon: IconTriangle },
  { kind: 'line', label: 'Line', Icon: IconLine },
  { kind: 'arrow', label: 'Arrow', Icon: IconArrowRight },
];

/** Shape menu for the editor toolbar. Shapes are decoration, never synced. */
export function ShapeMenu({ pageId }: { pageId: string }) {
  const { dispatch } = useEditor();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    <span style={{ position: 'relative' }} ref={ref}>
      <button className="btn btn-sm" onClick={() => setOpen((o) => !o)}>
        <IconShapes size={13} /> Shape
      </button>
      {open && (
        <div className="space-switcher-menu" style={{ left: 0, right: 'auto', minWidth: 170 }}>
          {SHAPES.map(({ kind, label, Icon }) => (
            <button
              key={kind}
              className="menu-item"
              onClick={() => {
                dispatch({ type: 'ADD_BLOCK', pageId, blockType: 'shape', shape: kind });
                setOpen(false);
              }}
            >
              <Icon size={13} />
              <span style={{ flex: 1 }}>{label}</span>
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

/**
 * Add an existing sync field to the page when nothing is selected:
 * creates a matching block (table, image, text) bound to the field.
 */
export function InsertFieldButton({ pageId }: { pageId: string }) {
  const { fields, fieldMap } = useWorkspace();
  const { dispatch } = useEditor();
  const { defaultDirection } = useFieldOps();

  const add = (f: SyncField) => {
    if (f.value.kind === 'table') {
      dispatch({
        type: 'ADD_BLOCK',
        pageId,
        blockType: 'table',
        table: { headerRow: f.value.headerRow, rows: f.value.rows },
        binding: { fieldId: f.id, sourceBlockId: '', direction: defaultDirection },
      });
      return;
    }
    if (f.value.kind === 'image') {
      dispatch({
        type: 'ADD_BLOCK',
        pageId,
        blockType: 'image',
        storagePath: f.value.storagePath,
        alt: f.value.alt,
        caption: f.value.caption,
        fit: f.value.fit,
        binding: { fieldId: f.id, sourceBlockId: '', direction: defaultDirection },
      });
      return;
    }
    const children = resolveFieldInline(f.id, fieldMap) ?? [{ text: f.name }];
    const wrapped = insertFieldAt(
      emptyRich(),
      { para: 0, start: 0, end: 0 },
      f.id,
      defaultDirection,
      children,
    );
    dispatch({
      type: 'ADD_BLOCK',
      pageId,
      blockType: 'text',
      body: wrapped?.rich ?? emptyRich(),
      binding:
        f.value.kind === 'richtext' && f.value.rich.length > 1
          ? { fieldId: f.id, sourceBlockId: '', direction: defaultDirection }
          : undefined,
    });
  };

  return (
    <FieldPicker
      fields={fields}
      target="all"
      label="Field"
      compact
      onPick={add}
    />
  );
}

/**
 * Insert a table, after asking how big. The size is settled before the
 * block exists so the author never has to reshape one — reshaping is
 * what has to keep merges, bindings and track sizes in step.
 */
export function InsertTableButton({ pageId }: { pageId: string }) {
  const { dispatch } = useEditor();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="btn btn-sm" onClick={() => setOpen(true)}>
        <IconTable size={13} /> Table
      </button>
      {open && (
        <NewTablePanel
          onClose={() => setOpen(false)}
          onCreate={(table) => {
            setOpen(false);
            dispatch({ type: 'ADD_BLOCK', pageId, blockType: 'table', table });
          }}
        />
      )}
    </>
  );
}
