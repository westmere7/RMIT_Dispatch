import { Fragment } from 'react';
import { IconImage } from '../Icons';
import { mediaUrl } from '../../lib/supabase';
import type { Block, InlineNode, RichText } from '../../types';
import { isFieldSpan } from '../../types';

/* Render-only view of a block's content (canvas + previews). Field spans
   carry data attributes so the canvas can hit-test clicks on them. */

export function InlineNodes({
  nodes,
  para,
  path = [],
}: {
  nodes: InlineNode[];
  para: number;
  path?: number[];
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
            >
              <InlineNodes nodes={n.children} para={para} path={[...path, i]} />
            </span>
          );
        }
        let el = <Fragment key={i}>{n.text}</Fragment>;
        if (n.bold) el = <strong key={i}>{el}</strong>;
        if (n.italic) el = <em key={i}>{el}</em>;
        if (n.color) {
          el = (
            <span key={i} style={{ color: n.color }}>
              {el}
            </span>
          );
        }
        return el;
      })}
    </>
  );
}

export function RichTextView({ rich }: { rich: RichText }) {
  return (
    <>
      {rich.map((para, pi) => (
        <p key={pi}>
          <InlineNodes nodes={para} para={pi} />
          {para.length === 1 && !isFieldSpan(para[0]) && para[0].text === '' && <br />}
        </p>
      ))}
    </>
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
        {block.heading && <div className="block-heading">{block.heading}</div>}
        <RichTextView rich={block.body} />
      </div>
    );
  }

  if (block.type === 'table') {
    const bodyRows = block.headerRow ? block.rows.slice(1) : block.rows;
    const header = block.headerRow ? block.rows[0] : null;
    return (
      <div className="block-content" style={{ padding: '2%' }}>
        <table className="block-table">
          {header && (
            <thead>
              <tr>
                {header.map((cell, ci) => (
                  <th key={ci} data-cell-row={0} data-cell-col={ci}>
                    <RichTextView rich={cell} />
                  </th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {bodyRows.map((row, ri) => (
              <tr key={ri}>
                {row.map((cell, ci) => (
                  <td key={ci} data-cell-row={ri + (block.headerRow ? 1 : 0)} data-cell-col={ci}>
                    <RichTextView rich={cell} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

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
