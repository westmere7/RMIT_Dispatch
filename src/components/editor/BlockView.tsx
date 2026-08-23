import { Fragment } from 'react';
import { IconImage } from '../Icons';
import { mediaUrl } from '../../lib/supabase';
import type { Block, InlineNode, RichText, ShapeBlock } from '../../types';
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
