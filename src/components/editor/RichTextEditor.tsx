import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  type ReactNode,
} from 'react';
import type { InlineNode, RichText, TextNode } from '../../types';
import { isFieldSpan } from '../../types';
import { normalizeRich, type TextRange } from '../../lib/richtext';

/* ============================================================
   Minimal contentEditable editor bound to the structured model.
   - Model → DOM render is imperative (innerHTML) and only runs
     when the value changed EXTERNALLY (avoids caret resets).
   - DOM → model parse runs on input.
   - Field spans render as atomic (down) or editable (up/two-way)
     spans; structure is preserved through the parse.
   ============================================================ */

export interface RichTextEditorHandle {
  /** Current selection as a single-paragraph text range, or null. */
  getRange: () => TextRange | null;
  focus: () => void;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderNodes(nodes: InlineNode[], editable: boolean): string {
  return nodes
    .map((n) => {
      if (isFieldSpan(n)) {
        const dir = n.direction ?? 'down';
        const ce = dir === 'down' && editable ? ' contenteditable="false"' : '';
        return `<span class="field-span dir-${dir}" data-field="${esc(n.fieldId)}" data-dir="${dir}"${ce}>${renderNodes(
          n.children,
          editable,
        )}</span>`;
      }
      const styles: string[] = [];
      if (n.bold) styles.push('font-weight:600');
      if (n.italic) styles.push('font-style:italic');
      if (n.color) styles.push(`color:${esc(n.color)}`);
      const attrs =
        (n.bold ? ' data-bold="1"' : '') +
        (n.italic ? ' data-italic="1"' : '') +
        (n.color ? ` data-color="${esc(n.color)}"` : '') +
        (styles.length ? ` style="${styles.join(';')}"` : '');
      return `<span data-t="1"${attrs}>${esc(n.text) || ''}</span>`;
    })
    .join('');
}

function renderHTML(rich: RichText, editable: boolean): string {
  return rich
    .map((para) => {
      const inner = renderNodes(para, editable);
      return `<p data-para="1">${inner || '<br>'}</p>`;
    })
    .join('');
}

interface Marks {
  bold?: boolean;
  italic?: boolean;
  color?: string;
}

function parseInline(el: Node, marks: Marks, out: InlineNode[]): void {
  el.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = child.textContent ?? '';
      if (text) out.push({ text, ...marks } as TextNode);
      return;
    }
    if (!(child instanceof HTMLElement)) return;
    if (child.tagName === 'BR') return;
    const fieldId = child.getAttribute('data-field');
    if (fieldId) {
      const children: InlineNode[] = [];
      parseInline(child, {}, children);
      out.push({
        fieldId,
        direction: (child.getAttribute('data-dir') as 'down' | 'up' | 'two-way') ?? 'down',
        children: children.length ? children : [{ text: '' }],
      });
      return;
    }
    const next: Marks = { ...marks };
    const tag = child.tagName;
    if (tag === 'B' || tag === 'STRONG' || child.getAttribute('data-bold') || child.style.fontWeight === '600' || child.style.fontWeight === 'bold') {
      next.bold = true;
    }
    if (tag === 'I' || tag === 'EM' || child.getAttribute('data-italic') || child.style.fontStyle === 'italic') {
      next.italic = true;
    }
    const color = child.getAttribute('data-color') || child.style.color;
    if (color) next.color = color;
    parseInline(child, next, out);
  });
}

function parseDOM(root: HTMLElement): RichText {
  const paras: RichText = [];
  let pending: InlineNode[] | null = null;
  root.childNodes.forEach((child) => {
    const isBlock =
      child instanceof HTMLElement && (child.tagName === 'P' || child.tagName === 'DIV');
    if (isBlock) {
      if (pending) {
        paras.push(pending);
        pending = null;
      }
      const nodes: InlineNode[] = [];
      parseInline(child, {}, nodes);
      paras.push(nodes.length ? nodes : [{ text: '' }]);
    } else {
      // stray inline content at root
      pending = pending ?? [];
      parseInline({ childNodes: [child] } as unknown as Node, {}, pending);
      if (child.nodeType === Node.TEXT_NODE && child.textContent) {
        // parseInline above handled it only if childNodes worked; guard:
      }
    }
  });
  if (pending) paras.push(pending);
  return normalizeRich(paras.length ? paras : [[{ text: '' }]]);
}

/** Plain-text offset of (node, offset) within a paragraph element. */
function offsetInPara(para: HTMLElement, node: Node, offset: number): number | null {
  let total = 0;
  const walker = document.createTreeWalker(para, NodeFilter.SHOW_TEXT);
  let cur = walker.nextNode();
  while (cur) {
    if (cur === node) return total + offset;
    total += cur.textContent?.length ?? 0;
    cur = walker.nextNode();
  }
  // Selection anchored on an element rather than a text node.
  if (node === para || para.contains(node)) return offset === 0 ? 0 : total;
  return null;
}

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

  // Render into the DOM only when the value changed externally.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const json = JSON.stringify(value);
    if (json === lastEmitted.current) return;
    lastEmitted.current = json;
    el.innerHTML = renderHTML(value, !readOnly);
  }, [value, readOnly]);

  useImperativeHandle(ref, () => ({
    focus: () => rootRef.current?.focus(),
    getRange: () => {
      const el = rootRef.current;
      const sel = window.getSelection();
      if (!el || !sel || sel.rangeCount === 0) return null;
      const range = sel.getRangeAt(0);
      if (!el.contains(range.startContainer) || !el.contains(range.endContainer)) return null;
      const paras = Array.from(el.querySelectorAll(':scope > [data-para]')) as HTMLElement[];
      const findPara = (n: Node): number =>
        paras.findIndex((p) => p === n || p.contains(n));
      const p1 = findPara(range.startContainer);
      const p2 = findPara(range.endContainer);
      if (p1 < 0 || p1 !== p2) return null;
      const start = offsetInPara(paras[p1], range.startContainer, range.startOffset);
      const end = offsetInPara(paras[p1], range.endContainer, range.endOffset);
      if (start === null || end === null) return null;
      return { para: p1, start: Math.min(start, end), end: Math.max(start, end) };
    },
  }));

  const handleInput = () => {
    const el = rootRef.current;
    if (!el) return;
    const parsed = parseDOM(el);
    lastEmitted.current = JSON.stringify(parsed);
    onChange(parsed);
  };

  const handleClick = (e: React.MouseEvent) => {
    if (!onSpanClick) return;
    const el = (e.target as HTMLElement).closest('[data-field]');
    if (!el || !rootRef.current?.contains(el)) return;
    const paras = Array.from(rootRef.current.querySelectorAll(':scope > [data-para]'));
    const paraIdx = Math.max(0, paras.findIndex((p) => p.contains(el)));
    // The consumer resolves the exact span path from the model (fieldId
    // occurrences within one block are effectively unique).
    onSpanClick({ fieldId: el.getAttribute('data-field')!, para: paraIdx, path: [] });
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
        onClick={handleClick}
        role="textbox"
        aria-multiline="true"
      />
    </div>
  );
});
