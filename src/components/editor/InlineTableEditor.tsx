import { useEffect, useRef } from 'react';
import { isContentLocked } from '../../lib/syncfields';
import { setCellContent } from '../../lib/tables';
import type { RichText, TableBlock } from '../../types';
import { RichTextView, TableView } from './BlockView';
import { InlineTextEditor } from './InlineTextEditor';

/* ============================================================
   Editing a table on the page, cell by cell.

   Each cell hosts the SAME editor a text block uses, so everything
   already true of text is true here: field embeds, stepping into one,
   plain-text paste, the caret anchors that make a gap beside an embed
   reachable. Nothing about tables needed its own text handling.

   A table whose CONTENT follows a field is still edited this way — only
   a `down` binding is read-only, exactly as for a text block, and that
   applies per cell as well as to the table as a whole.
   ============================================================ */

export function InlineTableEditor({
  block,
  onChange,
  onSpanClick,
  onEnteredField,
  activeCell,
}: {
  block: TableBlock;
  onChange: (patch: Partial<TableBlock>) => void;
  onSpanClick?: (info: { fieldId: string; para: number; path: number[] }) => void;
  onEnteredField?: (fieldId: string | null) => void;
  /** The cell the author opened, so the caret starts there. */
  activeCell?: { row: number; col: number } | null;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const blockLocked = isContentLocked(block.binding);
  const row = activeCell?.row ?? 0;
  const col = activeCell?.col ?? 0;

  /**
   * Put the caret in the cell that was double-clicked.
   *
   * Only on the way IN: re-running whenever the selection moved would
   * fight the click that moved it, and typing changes the block on every
   * keystroke, which would drag the caret back to the start of the cell.
   */
  useEffect(() => {
    const el = rootRef.current?.querySelector(
      `[data-cell-editor="${row}-${col}"] .inline-editor-body`,
    ) as HTMLElement | null;
    if (!el || !el.isContentEditable) return;
    el.focus();
    const sel = window.getSelection();
    const r = document.createRange();
    r.selectNodeContents(el);
    r.collapse(false);
    sel?.removeAllRanges();
    sel?.addRange(r);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div ref={rootRef} className="inline-table">
      <TableView
        block={block}
        renderCell={(ri, ci, rich: RichText) => {
          const cellBinding = block.cellBindings?.find((b) => b.row === ri && b.col === ci);
          // A `down` cell mirrors its field; editing it in place would
          // promise something the next sync would undo.
          if (blockLocked || isContentLocked(cellBinding)) {
            return <RichTextView rich={rich} />;
          }
          return (
            <div data-cell-editor={`${ri}-${ci}`} className="cell-editor">
              <InlineTextEditor
                bare
                body={rich}
                onChange={(next) => onChange({ rows: setCellContent(block, ri, ci, next) })}
                onSpanClick={onSpanClick}
                onEnteredField={onEnteredField}
              />
            </div>
          );
        }}
      />
    </div>
  );
}
