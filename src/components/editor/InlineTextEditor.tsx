import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { useSpanEntry } from './useSpanEntry';
import type { RichText, TextAlign, TextSize } from '../../types';
import { insertPlainText, renderRichHTML, parseRichDOM, rangeFromSelection } from '../../lib/richdom';
import type { TextRange } from '../../lib/richtext';

export interface InlineEditorHandle {
  focus: () => void;
  getRange: () => TextRange | null;
  getBody: () => RichText;
}

/**
 * Text editing directly on the page surface. Renders rich text at canvas
 * scale and writes edits straight back into the structured model, so
 * field spans keep their structural anchors.
 *
 * It takes the CONTENT rather than a block, because a table cell is the
 * same job: the same embeds, the same plain-text paste, the same caret
 * anchors. `bare` drops the block-shaped wrapper for a cell, which
 * brings its own box.
 */
export const InlineTextEditor = forwardRef<InlineEditorHandle, {
  body: RichText;
  size?: TextSize;
  align?: TextAlign;
  bold?: boolean;
  color?: string;
  /** Skip the block wrapper — the caller's element is the box. */
  bare?: boolean;
  onChange: (body: RichText) => void;
  onSpanClick?: (info: { fieldId: string; para: number; path: number[] }) => void;
  /** Reports which embed is open for text editing, for the properties bar. */
  onEnteredField?: (fieldId: string | null) => void;
}>(function InlineTextEditor(
  { body, size, align, bold, color, bare, onChange, onSpanClick, onEnteredField },
  ref,
) {
  const rootRef = useRef<HTMLDivElement>(null);
  const lastEmitted = useRef<string>('');
  const { entered, enteredField, onDoubleClick, onClick, onMouseDown } = useSpanEntry(rootRef);

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
    const json = JSON.stringify(body);
    // Stepping in or out changes which span is editable, so it has to
    // re-render even when the body itself has not changed.
    const key = `${json}|${entered ? `${entered.para}:${entered.path}` : ''}`;
    if (key === lastEmitted.current) return;
    lastEmitted.current = key;
    el.innerHTML = renderRichHTML(body, true, size ?? 'md', entered);
  }, [body, size, entered]);

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
    getBody: () => (rootRef.current ? parseRichDOM(rootRef.current) : body),
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

  /**
   * Paste arrives as PLAIN TEXT, always. Whatever was copied — Word, a
   * web page, another block — brings its own fonts, weights and colours
   * with it, which then override the block's styling and are invisible
   * in the properties bar. Inside an open field the text also folds onto
   * one line: a field value is a single run by definition.
   */
  const onPaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    if (!text) return;
    insertPlainText(text, !!entered);
    emit();
  };

  const editable = (
    <div
      ref={rootRef}
      className={`inline-editor-body ${bare ? 'inline-editor' : ''}`}
      contentEditable
      suppressContentEditableWarning
      onInput={emit}
      onBlur={emit}
      onPaste={onPaste}
      onMouseDown={onMouseDown}
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
  );

  if (bare) return editable;
  return (
    <div
      className={`block-content inline-editor size-${size ?? 'md'}`}
      style={{
        textAlign: align ?? 'left',
        fontWeight: bold ? 600 : undefined,
        color: color || undefined,
      }}
    >
      {editable}
    </div>
  );
});
