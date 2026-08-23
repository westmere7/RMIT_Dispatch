import { Link } from 'react-router-dom';
import { useEditor } from '../../editor/EditorProvider';
import {
  forEachSpan,
  setSpanDirection,
  unlinkSpan,
  type SpanRef,
} from '../../lib/richtext';
import { useWorkspace } from '../../editor/workspaceContext';
import type { Block, RichText, SyncDirection } from '../../types';
import { IconUnlink } from '../Icons';

interface SpanLoc {
  kind: 'body' | 'cell';
  r?: number;
  c?: number;
  ref: SpanRef;
}

function findSpanInBlock(block: Block, fieldId: string): SpanLoc | null {
  let found: SpanLoc | null = null;
  const search = (rich: RichText, kind: 'body' | 'cell', r?: number, c?: number) => {
    forEachSpan(rich, (_span, ref) => {
      if (!found && ref.fieldId === fieldId) found = { kind, r, c, ref };
    });
  };
  if (block.type === 'text') search(block.body, 'body');
  if (block.type === 'table') {
    block.rows.forEach((row, r) => row.forEach((cell, c) => search(cell, 'cell', r, c)));
  }
  return found;
}

/** Inspector card for the clicked field span: name, direction switcher,
    unlink, go-to-master. */
export function FieldSpanMenu() {
  const { activeSpan, setActiveSpan, fieldMap, doc, masterDoc } = useWorkspace();
  const { state, dispatch, readOnly } = useEditor();

  if (!activeSpan) return null;
  const page = state.pages.find((p) => p.blocks.some((b) => b.id === activeSpan.blockId));
  const block = page?.blocks.find((b) => b.id === activeSpan.blockId);
  if (!page || !block) return null;

  const field = fieldMap.get(activeSpan.fieldId);
  const loc = findSpanInBlock(block, activeSpan.fieldId);
  if (!loc) return null;

  const getRich = (): RichText =>
    loc.kind === 'body' && block.type === 'text'
      ? block.body
      : block.type === 'table'
        ? block.rows[loc.r!][loc.c!]
        : [[{ text: '' }]];

  const putRich = (rich: RichText) => {
    if (loc.kind === 'body' && block.type === 'text') {
      dispatch({ type: 'UPDATE_BLOCK', pageId: page.id, blockId: block.id, patch: { body: rich } });
    } else if (block.type === 'table') {
      const rows = block.rows.map((row, ri) =>
        row.map((cell, ci) => (ri === loc.r && ci === loc.c ? rich : cell)),
      );
      dispatch({ type: 'UPDATE_BLOCK', pageId: page.id, blockId: block.id, patch: { rows } });
    }
  };

  const direction = (loc.ref.direction ?? 'down') as SyncDirection;

  return (
    <div className="card" style={{ padding: 'var(--space-3)', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span className="pill pill-accent">field</span>
        <strong style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {field?.name ?? '(deleted field)'}
        </strong>
      </div>

      {!readOnly && (
        <div className="field">
          <label>Direction (this embed)</label>
          <select
            className="input"
            value={direction}
            onChange={(e) =>
              putRich(
                setSpanDirection(getRich(), loc.ref.para, loc.ref.path, e.target.value as SyncDirection),
              )
            }
          >
            <option value="down">↓ down — follow the field (read-only here)</option>
            <option value="up">↑ up — local edits rewrite the field on save</option>
            <option value="two-way">⇅ two-way</option>
          </select>
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {!readOnly && (
          <button
            className="btn btn-sm"
            onClick={() => {
              putRich(unlinkSpan(getRich(), loc.ref.para, loc.ref.path));
              setActiveSpan(null);
            }}
            title="Detach: keeps a plain copy, stops syncing"
          >
            <IconUnlink size={12} /> Unlink
          </button>
        )}
        {doc.kind === 'adaptation' && masterDoc && (
          <Link className="btn btn-sm" to={`/docs/${masterDoc.id}`}>
            Go to master
          </Link>
        )}
        <button className="btn btn-ghost btn-sm" onClick={() => setActiveSpan(null)}>
          Close
        </button>
      </div>
      {!readOnly && direction === 'down' && (
        <p className="muted text-xs">
          To vary this text here, unlink it — then re-bind smaller pieces (narrow) via the Field
          button in Properties.
        </p>
      )}
    </div>
  );
}
