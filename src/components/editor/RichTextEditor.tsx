import { forwardRef, useEffect, useImperativeHandle, useRef, type ReactNode } from 'react';
import { parseRichDOM, rangeFromSelection, renderRichHTML } from '../../lib/richdom';
import type { TextRange } from '../../lib/richtext';
import type { RichText } from '../../types';

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
  onSpanClick?: (info: { fieldId: string; para: number; path: number[] }) => void;
}>(function RichTextEditor({ value, onChange, readOnly, compact, toolbar, onSpanClick }, ref) {
  const rootRef = useRef<HTMLDivElement>(null);
  const lastEmitted = useRef<string>('');

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const json = JSON.stringify(value);
    if (json === lastEmitted.current) return;
    lastEmitted.current = json;
    el.innerHTML = renderRichHTML(value, !readOnly);
  }, [value, readOnly]);

  useImperativeHandle(ref, () => ({
    focus: () => rootRef.current?.focus(),
    getRange: () => rangeFromSelection(rootRef.current),
  }));

  const handleInput = () => {
    const el = rootRef.current;
    if (!el) return;
    const parsed = parseRichDOM(el);
    lastEmitted.current = JSON.stringify(parsed);
    onChange(parsed);
  };

  return (
    <div className={`rt-editor ${compact ? 'rt-compact' : ''}`}>
      {toolbar && !readOnly && <div className="rt-toolbar">{toolbar}</div>}
      <div
        ref={rootRef}
        className="rt-content"
        contentEditable={!readOnly}
        suppressContentEditableWarning
        onInput={handleInput}
        onBlur={handleInput}
        onClick={(e) => {
          if (!onSpanClick) return;
          const el = (e.target as HTMLElement).closest('[data-field]');
          if (!el || !rootRef.current?.contains(el)) return;
          // Only read-only (down) spans open the sync inspector on click;
          // up/two-way spans stay freely editable in place.
          if (el.getAttribute('data-dir') !== 'down') return;
          const paras = Array.from(rootRef.current.querySelectorAll(':scope > [data-para]'));
          const para = Math.max(0, paras.findIndex((p) => p.contains(el)));
          onSpanClick({ fieldId: el.getAttribute('data-field')!, para, path: [] });
        }}
        role="textbox"
        aria-multiline="true"
      />
    </div>
  );
});
