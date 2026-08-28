import { useRef, useState } from 'react';
import { useEditor } from '../../editor/EditorProvider';
import { useFieldOps } from '../../editor/useFieldOps';
import { useWorkspace } from '../../editor/workspaceContext';
import { uuid } from '../../lib/ids';
import { DEFAULT_COMPRESSION } from '../../lib/imagecompress';
import { plainText } from '../../lib/richtext';
import { autoFieldName } from '../../lib/syncfields';
import {
  cellImageAt,
  deleteCol,
  deleteRow,
  insertCol,
  insertRow,
  isCovered,
  mergeAt,
  mergeCells,
  setCellImage,
  tableSize,
  unmergeAt,
  type TablePatch,
} from '../../lib/tables';
import { useAuth } from '../../store/auth';
import { createField } from '../../store/fields';
import { deleteMedia, uploadMedia } from '../../store/media';
import { useSpaces } from '../../store/spaces';
import type { Block, SyncDirection, TableBlock } from '../../types';
import { IconImage, IconLink, IconTrash } from '../Icons';
import { FieldPicker } from './FieldPicker';

/* ============================================================
   Table controls, in the bar above the canvas.

   Only the things that cannot be done by pointing at the table
   itself live here — inserting, deleting, merging, and what one
   cell holds. Sizing is a drag on the table; text is typed into
   the cell. Everything acts on the cell the author last clicked,
   which the canvas rings so the target is never in doubt.
   ============================================================ */

export function TableBar({
  block,
  pageId,
  update,
}: {
  block: TableBlock;
  pageId: string;
  update: (p: Partial<Block>) => void;
}) {
  void pageId;
  const { readOnly } = useEditor();
  const { doc, project, fields, setFields, fieldMap, activeCell } = useWorkspace();
  const { currentSpace } = useSpaces();
  const { user } = useAuth();
  const { checkFit } = useFieldOps();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const { rows: nRows, cols: nCols } = tableSize(block);
  const sel = activeCell?.blockId === block.id ? activeCell : null;
  const r = Math.min(Math.max(0, sel?.row ?? 0), Math.max(0, nRows - 1));
  const c = Math.min(Math.max(0, sel?.col ?? 0), Math.max(0, nCols - 1));
  const r2 = Math.min(Math.max(0, sel?.toRow ?? r), Math.max(0, nRows - 1));
  const c2 = Math.min(Math.max(0, sel?.toCol ?? c), Math.max(0, nCols - 1));
  const rangeSelected = r !== r2 || c !== c2;
  const inMerge = !!mergeAt(block, r, c) || isCovered(block, r, c);

  const image = cellImageAt(block, r, c);
  const binding = block.cellBindings?.find((b) => b.row === r && b.col === c);

  const apply = (p: TablePatch | null) => {
    if (p) update(p as Partial<Block>);
  };

  /* `insertRow`/`insertCol` add AFTER the given index, so "above" and
     "left" are the same call one place earlier. -1 is a legal argument:
     it puts the new line before everything. */
  const rowAbove = () => apply(insertRow(block, r - 1));
  const rowBelow = () => apply(insertRow(block, r));
  const colLeft = () => apply(insertCol(block, c - 1));
  const colRight = () => apply(insertCol(block, c));

  const pickImage = async (file: File) => {
    if (!currentSpace) return;
    setBusy(true);
    try {
      const previous = image?.storagePath;
      const res = await uploadMedia(currentSpace.id, file, DEFAULT_COMPRESSION);
      update({
        cellImages: setCellImage(block, r, c, { storagePath: res.storagePath, fit: 'contain' }),
      } as Partial<Block>);
      // The old file is this cell's alone, so nothing else can still want it.
      if (previous) await deleteMedia(previous);
    } catch (e) {
      console.error('cell image upload failed', e);
    } finally {
      setBusy(false);
    }
  };

  /**
   * Bind this cell's PICTURE to an image field, the way an image block
   * binds — so a logo swapped in the master reaches the tables in every
   * adaptation, not just the standalone images.
   */
  const bindImage = async (fieldId: string, createNew: boolean) => {
    if (!user) return;
    const direction: SyncDirection = doc.kind === 'master' ? 'two-way' : 'down';
    if (!createNew) {
      const f = fieldMap.get(fieldId);
      if (!f || !(await checkFit(f, 'imageBlock'))) return;
    }
    if (createNew) {
      const name = autoFieldName(image?.alt || 'cell image', new Set(fields.map((f) => f.name)));
      const field = await createField({
        id: fieldId,
        projectId: project.id,
        spaceId: project.spaceId,
        scope: 'local',
        name,
        value: { kind: 'image', storagePath: image?.storagePath, alt: image?.alt, fit: image?.fit },
        userId: user.uid,
      });
      setFields((prev) => [...prev, field]);
    }
    update({
      cellImages: setCellImage(block, r, c, {
        storagePath: image?.storagePath,
        fit: image?.fit ?? 'contain',
        alt: image?.alt,
        fieldId,
        direction,
      }),
    } as Partial<Block>);
  };

  const bindCell = async (fieldId: string, createNew: boolean) => {
    if (!user) return;
    const direction: SyncDirection = doc.kind === 'master' ? 'two-way' : 'down';
    if (!createNew) {
      const f = fieldMap.get(fieldId);
      // A table field owns a whole table; it cannot live in one cell.
      if (!f || !(await checkFit(f, 'tableCell'))) return;
    }
    if (createNew) {
      const rich = block.rows[r]?.[c] ?? [[{ text: '' }]];
      const name = autoFieldName(plainText(rich), new Set(fields.map((f) => f.name)));
      const field = await createField({
        id: fieldId,
        projectId: project.id,
        spaceId: project.spaceId,
        scope: 'local',
        name,
        value: { kind: 'richtext', rich },
        userId: user.uid,
      });
      setFields((prev) => [...prev, field]);
    }
    update({
      cellBindings: [
        ...(block.cellBindings ?? []).filter((b) => !(b.row === r && b.col === c)),
        { row: r, col: c, fieldId, direction },
      ],
    } as Partial<Block>);
  };

  if (readOnly) return null;

  return (
    <>
      <label className="pb-check">
        <input
          type="checkbox"
          checked={block.headerRow}
          onChange={(e) => update({ headerRow: e.target.checked } as Partial<Block>)}
        />
        Header row
      </label>

      <span className="bar-sep" />
      <span className="pb-hint" title="Click a cell on the table to move this">
        R{r + 1}C{c + 1}
        {rangeSelected ? `:R${r2 + 1}C${c2 + 1}` : ''}
      </span>

      <div className="tbar-group" role="group" aria-label="Insert">
        <button className="btn btn-sm" onClick={rowAbove} title="Insert a row above this one">
          ↑ Row
        </button>
        <button className="btn btn-sm" onClick={rowBelow} title="Insert a row below this one">
          ↓ Row
        </button>
        <button className="btn btn-sm" onClick={colLeft} title="Insert a column to the left">
          ← Col
        </button>
        <button className="btn btn-sm" onClick={colRight} title="Insert a column to the right">
          → Col
        </button>
      </div>

      <div className="tbar-group" role="group" aria-label="Delete">
        <button
          className="btn btn-sm"
          onClick={() => apply(deleteRow(block, r))}
          disabled={nRows <= 1}
          title={nRows <= 1 ? 'The last row cannot be deleted' : `Delete row ${r + 1}`}
        >
          <IconTrash size={11} /> Row
        </button>
        <button
          className="btn btn-sm"
          onClick={() => apply(deleteCol(block, c))}
          disabled={nCols <= 1}
          title={nCols <= 1 ? 'The last column cannot be deleted' : `Delete column ${c + 1}`}
        >
          <IconTrash size={11} /> Col
        </button>
      </div>

      <div className="tbar-group" role="group" aria-label="Merge">
        <button
          className="btn btn-sm"
          onClick={() =>
            update({ merges: mergeCells(block, { row: r, col: c }, { row: r2, col: c2 }) } as Partial<Block>)
          }
          disabled={!rangeSelected}
          title={
            rangeSelected
              ? 'Merge the selected cells'
              : 'Shift-click a second cell on the table to choose a range'
          }
        >
          Merge
        </button>
        <button
          className="btn btn-sm"
          onClick={() => update({ merges: unmergeAt(block, r, c) } as Partial<Block>)}
          disabled={!inMerge}
          title={inMerge ? 'Split this merged cell back up' : 'This cell is not merged'}
        >
          Unmerge
        </button>
      </div>

      <span className="bar-sep" />
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void pickImage(f);
        }}
      />
      <button
        className="btn btn-sm"
        onClick={() => fileRef.current?.click()}
        disabled={busy}
        title={`${image ? 'Replace' : 'Add'} the picture in cell R${r + 1}C${c + 1}`}
      >
        <IconImage size={12} /> {busy ? 'Uploading…' : image ? 'Replace' : 'Image'}
      </button>
      {image && (
        <>
          <button
            className="icon-btn"
            onClick={() => {
              // A bound picture's file belongs to the field, not to us.
              if (image.storagePath && !image.fieldId) void deleteMedia(image.storagePath);
              update({ cellImages: setCellImage(block, r, c, null) } as Partial<Block>);
            }}
            title="Remove this cell's picture"
            aria-label="Remove cell image"
          >
            <IconTrash size={13} />
          </button>
          {image.fieldId ? (
            <span
              className={`pill ${image.direction === 'down' ? 'pill-accent' : 'pill-warning'}`}
              title={`This picture follows the field “${fieldMap.get(image.fieldId)?.name ?? ''}”`}
            >
              {image.direction === 'down' ? '↓' : image.direction === 'up' ? '↑' : '⇅'}{' '}
              {fieldMap.get(image.fieldId)?.name ?? 'image field'}
              <button
                className="pb-pill-x"
                onClick={() =>
                  update({
                    cellImages: setCellImage(block, r, c, {
                      storagePath: image.storagePath,
                      fit: image.fit,
                      alt: image.alt,
                    }),
                  } as Partial<Block>)
                }
                aria-label="Unlink this picture"
                title="Unlink this picture, keeping a plain copy"
              >
                ×
              </button>
            </span>
          ) : (
            <FieldPicker
              fields={fields}
              target="imageBlock"
              label="Sync image"
              icon={<IconLink size={12} />}
              compact
              align="right"
              createLabel="New field from this picture"
              onCreate={() => void bindImage(uuid(), true)}
              onPick={(f) => void bindImage(f.id, false)}
            />
          )}
        </>
      )}

      {binding ? (
        <span
          className={`pill ${binding.direction === 'down' ? 'pill-accent' : 'pill-warning'}`}
          title={`This cell follows the field “${fieldMap.get(binding.fieldId)?.name ?? ''}”`}
        >
          {binding.direction === 'down' ? '↓' : binding.direction === 'up' ? '↑' : '⇅'}{' '}
          {fieldMap.get(binding.fieldId)?.name ?? 'field'}
          <button
            className="pb-pill-x"
            onClick={() =>
              update({
                cellBindings: (block.cellBindings ?? []).filter(
                  (b) => !(b.row === r && b.col === c),
                ),
              } as Partial<Block>)
            }
            aria-label="Unlink this cell"
            title="Unlink this cell"
          >
            ×
          </button>
        </span>
      ) : rangeSelected ? (
        // A cell field owns ONE cell's content, so a range has no meaning
        // here — saying so beats silently binding the anchor cell.
        <span className="pb-hint" title="Click a single cell to sync it on its own">
          one cell to sync
        </span>
      ) : (
        <FieldPicker
          fields={fields}
          target="tableCell"
          label="Field"
          icon={<IconLink size={12} />}
          compact
          align="right"
          createLabel="New field from this cell"
          onCreate={() => void bindCell(uuid(), true)}
          onPick={(f) => void bindCell(f.id, false)}
        />
      )}
    </>
  );
}
