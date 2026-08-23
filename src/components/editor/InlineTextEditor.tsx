import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { useSpanEntry } from './useSpanEntry';
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
  /** Reports which embed is open for text editing, for the properties bar. */
  onEnteredField?: (fieldId: string | null) => void;
}>(function InlineTextEditor({ block, onChange, onSpanClick, onEnteredField }, ref) {
  const rootRef = useRef<HTMLDivElement>(null);
  const lastEmitted = useRef<string>('');
  const { entered, enteredField, onDoubleClick, onClick } = useSpanEntry(rootRef);

  // The hint belongs in the properties bar: pinned above the block it
  // collided with whatever sat there, and the frame is not a reliable
  // place to hang UI that must always be readable.
  useEffect(() => {
    onEnteredField?.(enteredField);
  }, [enteredField, onEnteredField]);
  useEffect(() => () => onEnteredField?.(null), [onEnteredField]);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const json = JSON.stringify(block.body);
    // Stepping in or out changes which span is editable, so it has to
    // re-render even when the body itself has not changed.
    const key = `${json}|${entered ? `${entered.para}:${entered.path}` : ''}`;
    if (key === lastEmitted.current) return;
    lastEmitted.current = key;
    el.innerHTML = renderRichHTML(block.body, true, block.size ?? 'md', entered);
  }, [block.body, block.size, entered]);

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
    lastEmitted.current = `${JSON.stringify(parsed)}|${
      entered ? `${entered.para}:${entered.path}` : ''
    }`;
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
          onClick(e);
          if (!onSpanClick) return;
          const el = (e.target as HTMLElement).closest('[data-field]');
          if (!el || !rootRef.current?.contains(el)) return;
          const paras = Array.from(rootRef.current.querySelectorAll(':scope > [data-para]'));
          const para = Math.max(0, paras.findIndex((p) => p.contains(el)));
          onSpanClick({ fieldId: el.getAttribute('data-field')!, para, path: [] });
        }}
        onDoubleClick={onDoubleClick}
        onKeyDown={(e) => {
          // Keep canvas shortcuts (delete/duplicate/nudge) out of the way.
          e.stopPropagation();
        }}
      />
    </div>
  );
});
