import type { InlineNode, RichText, SyncDirection, TextNode, TextSize } from '../types';
import { runFontSize } from './textsize';
import { isFieldSpan } from '../types';
import { normalizeRich, type TextRange } from './richtext';

/* ============================================================
   Bridge between the structured rich-text model and a
   contentEditable DOM. Shared by the inspector editor and the
   on-canvas inline editor so both round-trip identically.
   ============================================================ */

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Inline style + round-trip attributes for a node's own marks. */
function markAttrs(
  n: { bold?: boolean; italic?: boolean; color?: string; size?: TextSize },
  base: TextSize,
): string {
  const styles: string[] = [];
  if (n.bold) styles.push('font-weight:600');
  if (n.italic) styles.push('font-style:italic');
  if (n.color) styles.push(`color:${esc(n.color)}`);
  const fs = runFontSize(n.size, base);
  if (fs) styles.push(`font-size:${fs}`);
  return (
    (n.bold ? ' data-bold="1"' : '') +
    (n.italic ? ' data-italic="1"' : '') +
    (n.color ? ` data-color="${esc(n.color)}"` : '') +
    (n.size ? ` data-size="${n.size}"` : '') +
    (styles.length ? ` style="${styles.join(';')}"` : '')
  );
}

/** Which embed the user has stepped into, if any. */
export interface EnteredSpan {
  para: number;
  /** JSON of the child-index path, e.g. "[2]" or "[2,0]". */
  path: string;
}

function renderNodes(
  nodes: InlineNode[],
  editable: boolean,
  base: TextSize,
  para: number,
  path: number[],
  entered?: EnteredSpan | null,
): string {
  return nodes
    .map((n, i) => {
      if (isFieldSpan(n)) {
        const dir = n.direction ?? 'down';
        const here = [...path, i];
        const key = JSON.stringify(here);
        const isEntered = !!entered && entered.para === para && entered.path === key;
        /*
         * An embed is ATOMIC while editing: `contenteditable="false"`
         * makes the browser treat it as one object, so typing beside it
         * can never leak into it and two neighbouring embeds cannot
         * merge. Stepping into one (double-click) makes just that span
         * editable again.
         */
        const ce = editable ? ` contenteditable="${isEntered}"` : '';
        const cls =
          `field-span dir-${dir}` +
          (editable ? (isEntered ? ' is-entered' : ' is-atomic') : '');
        const hint =
          editable && !isEntered
            ? dir === 'down'
              ? ' title="Follows the field — edit the field itself to change this text"'
              : ' title="Double-click to edit this field&apos;s text"'
            : '';
        // The span's own marks style the whole embed; its children may
        // still carry marks of their own for parts of it.
        return `<span class="${cls}" data-field="${esc(n.fieldId)}" data-dir="${dir}" data-para="${para}" data-path="${esc(
          key,
        )}"${markAttrs(n, base)}${ce}${hint}>${renderNodes(
          n.children,
          editable,
          n.size ?? base,
          para,
          here,
          entered,
        )}</span>`;
      }
      return `<span data-t="1"${markAttrs(n, base)}>${esc(n.text)}</span>`;
    })
    .join('');
}

/**
 * `base` is the block's own text size: run sizes are expressed relative
 * to it so a run marked LG looks the same in an XS block as in an XL one.
 */
export function renderRichHTML(
  rich: RichText,
  editable: boolean,
  base: TextSize = 'md',
  entered?: EnteredSpan | null,
): string {
  return rich
    .map(
      (para, pi) =>
        `<p data-para="1">${renderNodes(para, editable, base, pi, [], entered) || '<br>'}</p>`,
    )
    .join('');
}

interface Marks {
  bold?: boolean;
  italic?: boolean;
  color?: string;
  size?: TextSize;
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
      // Children are parsed with no inherited marks: the span's marks
      // belong to the span itself, so they must not be copied down onto
      // children that the next sync will replace.
      parseInline(child, {}, children);
      const color = child.getAttribute('data-color') || undefined;
      const size = (child.getAttribute('data-size') as TextSize | null) ?? undefined;
      out.push({
        fieldId,
        direction: (child.getAttribute('data-dir') as SyncDirection) ?? 'down',
        children: children.length ? children : [{ text: '' }],
        ...(child.getAttribute('data-bold') ? { bold: true } : {}),
        ...(child.getAttribute('data-italic') ? { italic: true } : {}),
        ...(color ? { color } : {}),
        ...(size ? { size } : {}),
      });
      return;
    }

    const next: Marks = { ...marks };
    const tag = child.tagName;
    const fw = child.style.fontWeight;
    if (tag === 'B' || tag === 'STRONG' || child.getAttribute('data-bold') || fw === '600' || fw === 'bold') {
      next.bold = true;
    }
    if (tag === 'I' || tag === 'EM' || child.getAttribute('data-italic') || child.style.fontStyle === 'italic') {
      next.italic = true;
    }
    const color = child.getAttribute('data-color') || child.style.color;
    if (color) next.color = color;
    const size = child.getAttribute('data-size') as TextSize | null;
    if (size) next.size = size;
    parseInline(child, next, out);
  });
}

export function parseRichDOM(root: HTMLElement): RichText {
  const paras: RichText = [];
  const loose: InlineNode[] = [];

  root.childNodes.forEach((child) => {
    const isBlock =
      child instanceof HTMLElement && (child.tagName === 'P' || child.tagName === 'DIV');
    if (isBlock) {
      const nodes: InlineNode[] = [];
      parseInline(child, {}, nodes);
      paras.push(nodes.length ? nodes : [{ text: '' }]);
    } else {
      // Stray inline content at the root (browsers do this on first keypress).
      const holder = document.createElement('span');
      holder.appendChild(child.cloneNode(true));
      parseInline(holder, {}, loose);
    }
  });

  if (loose.length) {
    if (paras.length) paras[0] = [...loose, ...paras[0]];
    else paras.push(loose);
  }
  return normalizeRich(paras.length ? paras : [[{ text: '' }]]);
}

/**
 * Plain-text offset of (node, offset) within a paragraph element.
 *
 * The container can be an ELEMENT rather than a text node, in which case
 * `offset` is a child index. That is not an edge case here: a caret
 * placed between two atomic embeds has no text node to sit in, so it
 * lands on the paragraph with a child index. Treating that as "the end
 * of the paragraph" (the old fallback) silently inserted fields in the
 * wrong place.
 */
function offsetInPara(para: HTMLElement, node: Node, offset: number): number | null {
  const isElement = node.nodeType === Node.ELEMENT_NODE;
  if (isElement && node !== para && !para.contains(node)) return null;

  // Text inside the container element that precedes the child index.
  let inside = 0;
  if (isElement) {
    const kids = Array.from(node.childNodes);
    for (let i = 0; i < Math.min(offset, kids.length); i++) {
      inside += kids[i].textContent?.length ?? 0;
    }
  }

  let total = 0;
  const walker = document.createTreeWalker(para, NodeFilter.SHOW_TEXT);
  let cur = walker.nextNode();
  while (cur) {
    if (!isElement) {
      if (cur === node) return total + offset;
    } else {
      // Walking in document order: stop at the container's own text or
      // anything after it; everything before it counts.
      if (node.contains(cur)) break;
      if (node.compareDocumentPosition(cur) & Node.DOCUMENT_POSITION_FOLLOWING) break;
    }
    total += cur.textContent?.length ?? 0;
    cur = walker.nextNode();
  }
  if (isElement) return total + inside;
  return para.contains(node) ? total : null;
}

/**
 * Current DOM selection as a single-paragraph model range, or null when
 * there is no usable selection (collapsed, outside, or spanning
 * paragraphs — field spans must not straddle paragraphs).
 */
/**
 * The live selection, taken from the first of `roots` that contains it.
 * Lets the properties panel act on a selection made on the canvas —
 * whichever editor the user is actually working in.
 */
export function rangeFromAny(roots: (HTMLElement | null)[]): TextRange | null {
  for (const r of roots) {
    const range = rangeFromSelection(r);
    if (range) return range;
  }
  return null;
}

export function rangeFromSelection(root: HTMLElement | null): TextRange | null {
  const sel = window.getSelection();
  if (!root || !sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  const paras = Array.from(root.querySelectorAll(':scope > [data-para]')) as HTMLElement[];
  const findPara = (n: Node): number => paras.findIndex((p) => p === n || p.contains(n));
  const p1 = findPara(range.startContainer);
  const p2 = findPara(range.endContainer);
  if (p1 < 0 || p1 !== p2) return null;
  const start = offsetInPara(paras[p1], range.startContainer, range.startOffset);
  const end = offsetInPara(paras[p1], range.endContainer, range.endOffset);
  if (start === null || end === null) return null;
  return { para: p1, start: Math.min(start, end), end: Math.max(start, end) };
}

/**
 * Place the DOM selection over a model range — the inverse of
 * `rangeFromSelection`. Applying a mark re-renders the editor's HTML,
 * which drops the selection; the offsets survive that (marking never
 * changes the text), so the selection can be put back.
 */
export function selectRange(root: HTMLElement | null, range: TextRange): boolean {
  if (!root) return false;
  const paras = Array.from(root.querySelectorAll(':scope > [data-para]')) as HTMLElement[];
  const para = paras[range.para];
  if (!para) return false;

  const locate = (offset: number): { node: Node; offset: number } => {
    const walker = document.createTreeWalker(para, NodeFilter.SHOW_TEXT);
    let total = 0;
    let last: Text | null = null;
    let cur = walker.nextNode() as Text | null;
    while (cur) {
      const len = cur.textContent?.length ?? 0;
      if (offset <= total + len) return { node: cur, offset: offset - total };
      total += len;
      last = cur;
      cur = walker.nextNode() as Text | null;
    }
    // Past the end (or an empty paragraph): clamp to what is there.
    return last ? { node: last, offset: last.textContent?.length ?? 0 } : { node: para, offset: 0 };
  };

  const sel = window.getSelection();
  if (!sel) return false;
  const a = locate(range.start);
  const b = locate(range.end);
  const r = document.createRange();
  try {
    r.setStart(a.node, a.offset);
    r.setEnd(b.node, b.offset);
  } catch {
    return false;
  }
  sel.removeAllRanges();
  sel.addRange(r);
  return true;
}

/**
 * Restore a selection once the editor has re-rendered. The re-render is
 * a React effect, so the first animation frame is the earliest the new
 * DOM exists; the result is verified and retried for a few frames rather
 * than assumed, because a single guess is exactly what made the
 * selection vanish after every formatting click.
 */
export function restoreSelectionSoon(
  getRoot: () => HTMLElement | null,
  range: TextRange,
  frames = 5,
): void {
  let n = 0;
  const tick = () => {
    const root = getRoot();
    if (root && selectRange(root, range)) {
      const now = rangeFromSelection(root);
      if (now && now.para === range.para && now.start === range.start && now.end === range.end) {
        return;
      }
    }
    if (++n < frames) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/** Collapse the caret at the end of an element's text. */
export function caretAtEndOf(el: HTMLElement): void {
  const sel = window.getSelection();
  if (!sel) return;
  const r = document.createRange();
  r.selectNodeContents(el);
  r.collapse(false);
  sel.removeAllRanges();
  sel.addRange(r);
}
