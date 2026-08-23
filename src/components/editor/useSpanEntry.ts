import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { caretAtEndOf, type EnteredSpan } from '../../lib/richdom';

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

  return { entered, enteredField, leave, onDoubleClick, onClick };
}
