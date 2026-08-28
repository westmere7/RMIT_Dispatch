import { Fragment, type ReactNode } from 'react';
import { IconImage } from '../Icons';
import { mediaUrl } from '../../lib/supabase';
import {
  cellFormatAt,
  cellImageAt,
  columnPercents,
  isCovered,
  mergeAt,
  rowPercents,
  tableSize,
} from '../../lib/tables';
import { runFontSize } from '../../lib/textsize';
import type {
  Block,
  InlineNode,
  RichText,
  ShapeBlock,
  TableBlock,
  TextSize,
} from '../../types';
import { isFieldSpan } from '../../types';

/* Render-only view of a block's content (canvas + previews). Field spans
   carry data attributes so the canvas can hit-test clicks on them. */

export function InlineNodes({
  nodes,
  para,
  path = [],
  base = 'md',
}: {
  nodes: InlineNode[];
  para: number;
  path?: number[];
  base?: TextSize;
}) {
  return (
    <>
      {nodes.map((n, i) => {
        if (isFieldSpan(n)) {
          const dir = n.direction ?? 'down';
          return (
            <span
              key={i}
              className={`field-span dir-${dir}`}
              data-fieldspan={n.fieldId}
              data-para={para}
              data-path={JSON.stringify([...path, i])}
              /* The embed's own marks style all of it, so a field dropped
                 into a bold sentence reads as part of that sentence. */
              style={{
                fontWeight: n.bold ? 600 : undefined,
                fontStyle: n.italic ? 'italic' : undefined,
                color: n.color,
                fontSize: runFontSize(n.size, base),
              }}
            >
              <InlineNodes nodes={n.children} para={para} path={[...path, i]} base={n.size ?? base} />
            </span>
          );
        }
        let el = <Fragment key={i}>{n.text}</Fragment>;
        if (n.bold) el = <strong key={i}>{el}</strong>;
        if (n.italic) el = <em key={i}>{el}</em>;
        if (n.color || n.size) {
          el = (
            <span key={i} style={{ color: n.color, fontSize: runFontSize(n.size, base) }}>
              {el}
            </span>
          );
        }
        return el;
      })}
    </>
  );
}

export function RichTextView({ rich, base }: { rich: RichText; base?: TextSize }) {
  return (
    <>
      {rich.map((para, pi) => (
        <p key={pi}>
          <InlineNodes nodes={para} para={pi} base={base} />
          {para.length === 1 && !isFieldSpan(para[0]) && para[0].text === '' && <br />}
        </p>
      ))}
    </>
  );
}

/**
 * A table.
 *
 * Every row goes in one `<tbody>` rather than splitting a `<thead>` off:
 * a merge can span the header into the row below it, and a table cannot
 * span a section boundary. Header cells are still `<th>`, which is what
 * the stylesheet keys their distinct look off.
 *
 * `rows` is always rectangular — merging hides cells, it never removes
 * them — so the loop walks every coordinate and skips what a merge has
 * already swallowed.
 */
export function TableView({
  block,
  renderCell,
}: {
  block: TableBlock;
  /** Lets the inline editor put a live editor in each cell instead. */
  renderCell?: (row: number, col: number, rich: RichText) => ReactNode;
}) {
  const { rows: nRows, cols: nCols } = tableSize(block);
  const colPct = columnPercents(block);
  const rowPct = rowPercents(block);

  return (
    <div className="block-content size-md" style={{ padding: '2%' }}>
      <div
        className="block-table"
        style={{
          gridTemplateColumns: colPct.map((w) => `${w}%`).join(' '),
          gridTemplateRows: rowPct.map((h) => `${h}%`).join(' '),
        }}
      >
        {block.rows.map((row, ri) =>
          row.map((cell, ci) => {
            if (isCovered(block, ri, ci)) return null;
            const merge = mergeAt(block, ri, ci);
            const image = cellImageAt(block, ri, ci);
            const fmt = cellFormatAt(block, ri, ci);
            const isHeader = block.headerRow && ri === 0;
            return (
              <div
                key={`${ri}-${ci}`}
                className={`table-cell ${isHeader ? 'table-header' : ''}`}
                style={{
                  gridRow: merge ? `${ri + 1} / span ${merge.rowSpan}` : `${ri + 1}`,
                  gridColumn: merge ? `${ci + 1} / span ${merge.colSpan}` : `${ci + 1}`,
                  textAlign: fmt?.align,
                  fontSize: runFontSize(fmt?.size, 'md'),
                }}
                data-cell-row={ri}
                data-cell-col={ci}
              >
                <div className="cell-body">
                  {image?.storagePath && (
                    <img
                      className="cell-image"
                      src={mediaUrl(image.storagePath)}
                      alt={image.alt ?? ''}
                      style={{ objectFit: image.fit ?? 'contain' }}
                      draggable={false}
                    />
                  )}
                  {renderCell ? renderCell(ri, ci, cell) : <RichTextView rich={cell} />}
                </div>
              </div>
            );
          }),
        )}
      </div>
      {nRows === 0 || nCols === 0 ? <span className="muted text-xs">Empty table</span> : null}
    </div>
  );
}

export function BlockView({ block }: { block: Block }) {
  if (block.type === 'text') {
    return (
      <div
        className={`block-content size-${block.size ?? 'md'}`}
        style={{
          textAlign: block.align ?? 'left',
          fontWeight: block.bold ? 600 : undefined,
          color: block.color || undefined,
        }}
      >
        <RichTextView rich={block.body} base={block.size ?? 'md'} />
      </div>
    );
  }

  if (block.type === 'table') return <TableView block={block} />;

  if (block.type === 'shape') return <ShapeView block={block} />;

  // image
  return (
    <figure className="block-image" style={{ margin: 0 }}>
      {block.storagePath ? (
        <img
          src={mediaUrl(block.storagePath)}
          alt={block.alt ?? ''}
          style={{ objectFit: block.fit ?? 'cover' }}
          draggable={false}
        />
      ) : (
        <div className="placeholder">
          <IconImage size={16} />
          No image
        </div>
      )}
      {block.caption && <figcaption>{block.caption}</figcaption>}
    </figure>
  );
}

/**
 * Decorative shapes, drawn as SVG so they scale with the page surface at
 * any zoom. `vectorEffect` keeps strokes a constant weight.
 */
function ShapeView({ block }: { block: ShapeBlock }) {
  const fill = block.fill ?? 'var(--accent-wash)';
  const stroke = block.stroke ?? 'var(--accent)';
  const sw = block.strokeWidth ?? 2;
  const common = {
    fill,
    stroke,
    strokeWidth: sw,
    vectorEffect: 'non-scaling-stroke' as const,
  };

  return (
    <svg
      className="block-shape"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      style={{ opacity: (block.opacity ?? 100) / 100 }}
      aria-hidden="true"
    >
      {block.shape === 'rect' && <rect x="1" y="1" width="98" height="98" {...common} />}
      {block.shape === 'rounded' && (
        <rect x="1" y="1" width="98" height="98" rx="10" ry="10" {...common} />
      )}
      {block.shape === 'circle' && <ellipse cx="50" cy="50" rx="49" ry="49" {...common} />}
      {block.shape === 'triangle' && <polygon points="50,2 98,98 2,98" {...common} />}
      {block.shape === 'line' && (
        <line x1="1" y1="50" x2="99" y2="50" {...common} fill="none" strokeLinecap="round" />
      )}
      {block.shape === 'arrow' && (
        <>
          <line x1="1" y1="50" x2="86" y2="50" {...common} fill="none" strokeLinecap="round" />
          <polyline
            points="70,26 96,50 70,74"
            {...common}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      )}
    </svg>
  );
}
