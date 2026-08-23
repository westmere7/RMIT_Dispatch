import { forwardRef, useEffect, useImperativeHandle, useRef, type ReactNode } from 'react';
import { useSpanEntry } from './useSpanEntry';
import { parseRichDOM, rangeFromSelection, renderRichHTML } from '../../lib/richdom';
import type { TextRange } from '../../lib/richtext';
import type { RichText, TextSize } from '../../types';

export interface RichTextEditorHandle {
  /** Current selection as a single-paragraph text range, or null. */
  getRange: () => TextRange | null;
  focus: () => void;
}

/**
 * Inspector-side rich text editor. Model → DOM rendering only runs when
 * the value changed externally, so typing never resets the caret.
 */
export const RichTextEditor = forwardRef<RichTextEditorHandle, {
  value: RichText;
  onChange: (rich: RichText) => void;
  readOnly?: boolean;
  compact?: boolean;
  toolbar?: ReactNode;
  /** The block's own text size: run sizes render relative to it. */
  baseSize?: TextSize;
  onSpanClick?: (info: { fieldId: string; para: number; path: number[] }) => void;
}>(function RichTextEditor(
  { value, onChange, readOnly, compact, toolbar, baseSize = 'md', onSpanClick },
  ref,
) {
  const rootRef = useRef<HTMLDivElement>(null);
  const lastEmitted = useRef<string>('');
  /* Same discipline as the canvas editor: embeds are atomic until you
     step into one, so nothing bleeds between neighbours. */
  const { entered, enteredField, onDoubleClick, onClick } = useSpanEntry(rootRef);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const key = `${JSON.stringify(value)}|${entered ? `${entered.para}:${entered.path}` : ''}`;
    if (key === lastEmitted.current) return;
    lastEmitted.current = key;
    el.innerHTML = renderRichHTML(value, !readOnly, baseSize, entered);
  }, [value, readOnly, baseSize, entered]);

  useImperativeHandle(ref, () => ({
    focus: () => rootRef.current?.focus(),
    getRange: () => rangeFromSelection(rootRef.current),
  }));

  const handleInput = () => {
    const el = rootRef.current;
    if (!el) return;
    const parsed = parseRichDOM(el);
    lastEmitted.current = `${JSON.stringify(parsed)}|${
      entered ? `${entered.para}:${entered.path}` : ''
    }`;
    onChange(parsed);
  };

  return (
    <div className={`rt-editor ${compact ? 'rt-compact' : ''}`}>
      {toolbar && !readOnly && <div className="rt-toolbar">{toolbar}</div>}
      {/* Dialog editors have no properties bar, so the hint sits inline. */}
      {enteredField && <div className="rt-entered">Editing a field inside this value · Esc to leave</div>}
      <div
        ref={rootRef}
        className="rt-content"
        contentEditable={!readOnly}
        suppressContentEditableWarning
        onInput={handleInput}
        onBlur={handleInput}
        onClick={(e) => {
          onClick(e);
          if (!onSpanClick) return;
          const el = (e.target as HTMLElement).closest('[data-field]');
          if (!el || !rootRef.current?.contains(el)) return;
          const paras = Array.from(rootRef.current.querySelectorAll(':scope > [data-para]'));
          const para = Math.max(0, paras.findIndex((p) => p.contains(el)));
          onSpanClick({ fieldId: el.getAttribute('data-field')!, para, path: [] });
        }}
        onDoubleClick={onDoubleClick}
        role="textbox"
        aria-multiline="true"
      />
    </div>
  );
});
