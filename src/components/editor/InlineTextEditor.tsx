import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import type { TextBlock } from '../../types';
import type { RichText } from '../../types';
import { renderRichHTML, parseRichDOM, rangeFromSelection } from '../../lib/richdom';
import type { TextRange } from '../../lib/richtext';

export interface InlineEditorHandle {
  focus: () => void;
  getRange: () => TextRange | null;
  getBody: () => RichText;
}

/**
 * Text editing directly on the page surface. Renders the block's body at
 * canvas scale and writes edits straight back into the structured model,
 * so field spans keep their structural anchors.
 */
export const InlineTextEditor = forwardRef<InlineEditorHandle, {
  block: TextBlock;
  onChange: (body: RichText) => void;
  onSpanClick?: (info: { fieldId: string; para: number; path: number[] }) => void;
}>(function InlineTextEditor({ block, onChange, onSpanClick }, ref) {
  const rootRef = useRef<HTMLDivElement>(null);
  const lastEmitted = useRef<string>('');

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const json = JSON.stringify(block.body);
    if (json === lastEmitted.current) return;
    lastEmitted.current = json;
    el.innerHTML = renderRichHTML(block.body, true);
  }, [block.body]);

  useImperativeHandle(ref, () => ({
    focus: () => {
      const el = rootRef.current;
      if (!el) return;
      el.focus();
      // Place the caret at the end on first focus.
      const sel = window.getSelection();
      if (sel && sel.rangeCount === 0) {
        const r = document.createRange();
        r.selectNodeContents(el);
        r.collapse(false);
        sel.addRange(r);
      }
    },
    getRange: () => rangeFromSelection(rootRef.current),
    getBody: () => (rootRef.current ? parseRichDOM(rootRef.current) : block.body),
  }));

  const emit = () => {
    const el = rootRef.current;
    if (!el) return;
    const parsed = parseRichDOM(el);
    lastEmitted.current = JSON.stringify(parsed);
    onChange(parsed);
  };

  return (
    <div
      className={`block-content inline-editor size-${block.size ?? 'md'}`}
      style={{
        textAlign: block.align ?? 'left',
        fontWeight: block.bold ? 600 : undefined,
        color: block.color || undefined,
      }}
    >
      {block.heading && <div className="block-heading">{block.heading}</div>}
      <div
        ref={rootRef}
        className="inline-editor-body"
        contentEditable
        suppressContentEditableWarning
        onInput={emit}
        onBlur={emit}
        role="textbox"
        aria-multiline="true"
        aria-label="Block text"
        onClick={(e) => {
          if (!onSpanClick) return;
          const el = (e.target as HTMLElement).closest('[data-field]');
          if (!el || !rootRef.current?.contains(el)) return;
          if (el.getAttribute('data-dir') !== 'down') return;
          const paras = Array.from(rootRef.current.querySelectorAll(':scope > [data-para]'));
          const para = Math.max(0, paras.findIndex((p) => p.contains(el)));
          onSpanClick({ fieldId: el.getAttribute('data-field')!, para, path: [] });
        }}
        onKeyDown={(e) => {
          // Keep canvas shortcuts (delete/duplicate/nudge) out of the way.
          e.stopPropagation();
        }}
      />
    </div>
  );
});
