import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { caretAtEndOf, caretBesideSpan, type EnteredSpan } from '../../lib/richdom';

/* ============================================================
   Stepping into a sync field to edit its text.

   While editing a text block every embed is atomic, so ordinary text
   around it can be typed freely and neighbouring embeds cannot bleed
   into one another. Editing the *content* of one embed is a deliberate
   second step: double-click it. Formatting never needs this — marks
   apply to a whole embed and work while it is atomic.
   ============================================================ */

export interface SpanEntry {
  /** The embed currently open for text editing, if any. */
  entered: EnteredSpan | null;
  /** Name of the field being edited, for the on-canvas hint. */
  enteredField: string | null;
  leave: () => void;
  /** Attach to the editable root. */
  onDoubleClick: (e: ReactMouseEvent) => void;
  /** Attach to the editable root: a click outside the open embed leaves it. */
  onClick: (e: ReactMouseEvent) => void;
  /** Attach to the editable root: makes the gaps beside an embed clickable. */
  onMouseDown: (e: ReactMouseEvent) => void;
}

export function useSpanEntry(
  rootRef: React.RefObject<HTMLElement>,
  opts: { onBlocked?: (fieldId: string) => void } = {},
): SpanEntry {
  const [entered, setEntered] = useState<EnteredSpan | null>(null);
  const [enteredField, setEnteredField] = useState<string | null>(null);
  /** Set when we have just stepped in, so the caret lands inside it. */
  const focusWanted = useRef(false);
  const onBlocked = opts.onBlocked;

  const leave = useCallback(() => {
    setEntered(null);
    setEnteredField(null);
  }, []);

  /** Leaving on Escape, and never leaving the editor stuck in this mode. */
  useEffect(() => {
    if (!entered) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // The canvas also listens for Escape (deselect); leaving the embed
      // is the more specific action, so it wins and stops there.
      e.stopPropagation();
      leave();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [entered, leave]);

  /**
   * Put the caret inside the embed once it has re-rendered as editable.
   *
   * The "wanted" flag is only cleared once the caret is ACTUALLY placed.
   * StrictMode runs effects twice (run → cleanup → run), and the cleanup
   * cancels the pending frame: clearing the flag up front meant the
   * second run bailed out and the caret was never placed, so the first
   * keystroke after stepping in landed at the start of the paragraph.
   */
  useEffect(() => {
    if (!entered || !focusWanted.current) return;
    let frames = 0;
    let raf = 0;
    const tick = () => {
      const el = rootRef.current?.querySelector(
        `[data-para="${entered.para}"][data-path='${entered.path}']`,
      ) as HTMLElement | null;
      // The re-render is a React effect, so the editable span does not
      // exist yet on the first frame.
      if (el && el.isContentEditable) {
        el.focus?.();
        caretAtEndOf(el);
        focusWanted.current = false;
        return;
      }
      if (++frames < 8) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [entered, rootRef]);

  /**
   * Field edit mode ISOLATES the field: while it is open, every edit has
   * to land inside that one embed.
   *
   * The block around it stays a live contentEditable — it has to, or a
   * click on the text beside the field could not place a caret and
   * leaving would take two clicks. So the confinement is enforced per
   * edit instead: an input whose target range reaches outside the embed
   * is refused. Without it Backspace at the embed's first character ate
   * the word in front of it, Enter split the block from inside a field,
   * and Ctrl+A + type replaced the lot — each one editing the block
   * while the user believed they were editing the field.
   *
   * The one exception is replacing the embed's ENTIRE text, which is a
   * legitimate edit the browser implements by deleting the wrapper
   * element. That is performed by hand on a text node we keep, so the
   * field survives it.
   */
  useEffect(() => {
    if (!entered) return;
    const root = rootRef.current;
    if (!root) return;

    /*
     * Looked up per event, never captured: the editor rewrites its own
     * innerHTML when the body changes underneath (a remote edit, a field
     * resolving), and a captured element would then be detached — every
     * edit measured against a node no longer in the document, so every
     * edit refused.
     */
    const findSpan = () =>
      root.querySelector(
        `[data-para="${entered.para}"][data-path='${entered.path}']`,
      ) as HTMLElement | null;

    /** The range this input would actually change. */
    const targetRange = (e: InputEvent): Range | null => {
      const targets = e.getTargetRanges?.() ?? [];
      if (targets.length > 0) {
        const t = targets[0];
        const r = document.createRange();
        r.setStart(t.startContainer, t.startOffset);
        r.setEnd(t.endContainer, t.endOffset);
        return r;
      }
      const sel = window.getSelection();
      return sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
    };

    const onBeforeInput = (e: InputEvent) => {
      const span = findSpan();
      if (!span) return;
      const r = targetRange(e);
      if (!r) return;
      if (!span.contains(r.startContainer) || !span.contains(r.endContainer)) {
        // Reaches past the field: that is an edit to the block, and the
        // block is not what is open.
        e.preventDefault();
        return;
      }

      const whole = document.createRange();
      whole.selectNodeContents(span);
      const coversAll =
        !r.collapsed &&
        r.compareBoundaryPoints(Range.START_TO_START, whole) <= 0 &&
        r.compareBoundaryPoints(Range.END_TO_END, whole) >= 0;
      if (!coversAll) return;
      if (e.inputType !== 'insertText' && !e.inputType.startsWith('delete')) return;
      e.preventDefault();
      span.textContent = e.inputType === 'insertText' ? (e.data ?? '') : '';
      const text = span.firstChild;
      const sel = window.getSelection();
      if (text && sel) {
        const next = document.createRange();
        next.setStart(text, text.textContent?.length ?? 0);
        next.collapse(true);
        sel.removeAllRanges();
        sel.addRange(next);
      }
      // Let the editor parse the DOM back into the model as usual.
      span.dispatchEvent(new Event('input', { bubbles: true }));
    };

    // On the ROOT, capturing: an edit aimed at the block never reaches
    // the span, so a listener on the span alone could not refuse it.
    root.addEventListener('beforeinput', onBeforeInput as EventListener, true);
    return () => root.removeEventListener('beforeinput', onBeforeInput as EventListener, true);
  }, [entered, rootRef]);

  const onDoubleClick = useCallback(
    (e: ReactMouseEvent) => {
      const root = rootRef.current;
      if (!root) return;
      const el = (e.target as HTMLElement).closest('[data-field]') as HTMLElement | null;
      if (!el || !root.contains(el)) {
        leave();
        return;
      }
      const fieldId = el.getAttribute('data-field') ?? '';
      // `down` embeds mirror the field: their text cannot be edited in
      // place, so stepping in would promise something we cannot deliver.
      if (el.getAttribute('data-dir') === 'down') {
        onBlocked?.(fieldId);
        return;
      }
      e.stopPropagation();
      focusWanted.current = true;
      setEntered({
        para: Number(el.getAttribute('data-para') ?? 0),
        path: el.getAttribute('data-path') ?? '[]',
      });
      setEnteredField(fieldId);
    },
    [rootRef, leave, onBlocked],
  );

  /**
   * Reach the text positions either side of an atomic embed.
   *
   * The browser will not put a caret there on its own: the embed is
   * `contenteditable="false"` with `user-select: all`, so a click on it
   * selects the whole embed, and a click in the blank space beside it is
   * snapped to the nearest visible position — never the zero-width caret
   * anchor. An embed filling a whole line therefore had no reachable
   * "before" at all: you could not type in front of it.
   *
   * Only the OUTER EDGES of an embed steer the caret; a click in the
   * middle still selects the whole thing, which is how a single embed
   * gets formatted.
   */
  const onMouseDown = useCallback(
    (e: ReactMouseEvent) => {
      if (e.button !== 0) return;
      const root = rootRef.current;
      if (!root) return;
      const target = e.target as HTMLElement;
      // Inside an open field the caret behaves normally.
      if (target.closest('.field-span.is-entered')) return;

      const place = (span: HTMLElement, before: boolean) => {
        e.preventDefault();
        root.focus();
        caretBesideSpan(span, before);
      };

      const atomic = target.closest('.field-span.is-atomic') as HTMLElement | null;
      if (atomic && root.contains(atomic)) {
        const rect = atomic.getBoundingClientRect();
        const edge = Math.max(4, Math.min(rect.width / 3, 14));
        if (e.clientX <= rect.left + edge) place(atomic, true);
        else if (e.clientX >= rect.right - edge) place(atomic, false);
        return;
      }

      // A click in a line's empty margin, where the paragraph itself is
      // the target: the browser has no text there to aim at.
      const para = target.closest('[data-para]') as HTMLElement | null;
      if (!para || !root.contains(para)) return;
      if (target !== para && target !== root) return;
      const kids = Array.from(para.children) as HTMLElement[];
      const spans = kids.filter((k) => k.classList.contains('field-span'));
      const first = spans[0];
      const last = spans[spans.length - 1];
      // `<= 1` / `>= length - 2`: a caret anchor may sit outside it.
      if (first && kids.indexOf(first) <= 1) {
        const r = first.getBoundingClientRect();
        if (e.clientX < r.left && e.clientY >= r.top && e.clientY <= r.bottom) {
          place(first, true);
          return;
        }
      }
      if (last && kids.indexOf(last) >= kids.length - 2) {
        const r = last.getBoundingClientRect();
        if (e.clientX > r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
          place(last, false);
        }
      }
    },
    [rootRef],
  );

  const onClick = useCallback(
    (e: ReactMouseEvent) => {
      if (!entered) return;
      const el = (e.target as HTMLElement).closest('[data-field]') as HTMLElement | null;
      const samePath = el?.getAttribute('data-path') === entered.path;
      const samePara = Number(el?.getAttribute('data-para') ?? -1) === entered.para;
      if (!el || !samePath || !samePara) leave();
    },
    [entered, leave],
  );

  return { entered, enteredField, leave, onDoubleClick, onClick, onMouseDown };
}
