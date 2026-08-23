import { plainText } from '../../lib/richtext';
import { valueAsTable } from '../../lib/syncfields';
import type { FieldValue } from '../../types';

const MAX_BODY_ROWS = 3;
const MAX_COLS = 4;

/**
 * Value preview for field listings. Text is shown as plain text — field
 * values carry no character formatting — while a table field keeps its
 * actual row/column layout rather than being flattened into a sentence.
 */
export function FieldValuePreview({ value }: { value: FieldValue }) {
  const table = valueAsTable(value);

  if (!table) {
    const text =
      value.kind === 'richtext' ? plainText(value.rich) : value.kind === 'scalar' ? value.text : '';
    return (
      <span className="fv-text" title={text}>
        {text || <span className="muted">empty</span>}
      </span>
    );
  }

  const cols = table.rows[0]?.length ?? 0;
  const shownCols = Math.min(cols, MAX_COLS);
  const header = table.headerRow ? table.rows[0] : null;
  const body = (table.headerRow ? table.rows.slice(1) : table.rows).slice(0, MAX_BODY_ROWS);
  const hiddenRows = (table.headerRow ? table.rows.length - 1 : table.rows.length) - body.length;

  return (
    <div className="fv-table-wrap">
      <table className="fv-table">
        {header && (
          <thead>
            <tr>
              {header.slice(0, shownCols).map((c, i) => (
                <th key={i}>{plainText(c)}</th>
              ))}
              {cols > shownCols && <th className="fv-more">+{cols - shownCols}</th>}
            </tr>
          </thead>
        )}
        <tbody>
          {body.map((row, ri) => (
            <tr key={ri}>
              {row.slice(0, shownCols).map((c, ci) => (
                <td key={ci}>{plainText(c)}</td>
              ))}
              {cols > shownCols && <td className="fv-more">…</td>}
            </tr>
          ))}
        </tbody>
      </table>
      {hiddenRows > 0 && (
        <span className="fv-more-rows">
          +{hiddenRows} more row{hiddenRows === 1 ? '' : 's'}
        </span>
      )}
    </div>
  );
}
