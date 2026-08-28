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

/**
 * Zero-width space — a place for the caret to stand.
 *
 * An atomic embed is `contenteditable="false"`, so the browser will not
 * put a caret next to it unless there is a TEXT NODE on that side. A
 * field that fills a whole line therefore had no reachable "before" or
 * "after": you could not type in front of it or behind it at all. Each
 * such gap gets an anchor holding one of these, and the model never sees
 * it — `modelLength` counts it as nothing, so every offset in the file
 * stays a true model offset.
 */
const ZWSP = '\u200b';
const ZWSP_RE = /\u200b/g;

/** A text node's length as the MODEL sees it: caret anchors are nothing. */
function modelLength(node: Node): number {
  const text = node.textContent ?? '';
  return text.includes(ZWSP) ? text.replace(ZWSP_RE, '').length : text.length;
}

/** DOM offset within a text node, given a model offset into it. */
function domOffsetFor(node: Node, modelOffset: number): number {
  const text = node.textContent ?? '';
  if (!text.includes(ZWSP)) return modelOffset;
  let seen = 0;
  for (let i = 0; i < text.length; i++) {
    if (seen === modelOffset && text[i] !== ZWSP) return i;
    if (text[i] !== ZWSP) seen++;
  }
  return text.length;
}

/** Model offset within a text node, given a DOM offset into it. */
function modelOffsetFor(node: Node, domOffset: number): number {
  const text = node.textContent ?? '';
  if (!text.includes(ZWSP)) return domOffset;
  let seen = 0;
  for (let i = 0; i < Math.min(domOffset, text.length); i++) {
    if (text[i] !== ZWSP) seen++;
  }
  return seen;
}

const anchor = `<span data-anchor="1">${ZWSP}</span>`;

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
        /*
         * An embed with no ordinary text beside it is unreachable: the
         * caret cannot stand against a `contenteditable="false"` element
         * without a text node to sit in. Anchors fill exactly those gaps
         * — a field on a line of its own gets one on each side — so
         * text can be typed before and after it like anywhere else.
         */
        const lead = editable && (i === 0 || isFieldSpan(nodes[i - 1])) ? anchor : '';
        const tail = editable && (i === nodes.length - 1 || isFieldSpan(nodes[i + 1])) ? anchor : '';
        return `${lead}<span class="${cls}" data-field="${esc(n.fieldId)}" data-dir="${dir}" data-para="${para}" data-path="${esc(
          key,
        )}"${markAttrs(n, base)}${ce}${hint}>${renderNodes(
          n.children,
          editable,
          n.size ?? base,
          para,
          here,
          entered,
        )}</span>${tail}`;
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
      // A caret anchor's own zero-width space is not content; a character
      // the user typed while standing in one is.
      const text = (child.textContent ?? '').replace(ZWSP_RE, '');
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
      inside += modelLength(kids[i]);
    }
  }

  let total = 0;
  const walker = document.createTreeWalker(para, NodeFilter.SHOW_TEXT);
  let cur = walker.nextNode();
  while (cur) {
    if (!isElement) {
      if (cur === node) return total + modelOffsetFor(cur, offset);
    } else {
      // Walking in document order: stop at the container's own text or
      // anything after it; everything before it counts.
      if (node.contains(cur)) break;
      if (node.compareDocumentPosition(cur) & Node.DOCUMENT_POSITION_FOLLOWING) break;
    }
    total += modelLength(cur);
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
      const len = modelLength(cur);
      // A caret anchor holds no model text, so it can never be the node a
      // model offset resolves to — skipping it keeps the caret in real
      // text, where deletion and typing behave.
      if (len > 0 && offset <= total + len) {
        return { node: cur, offset: domOffsetFor(cur, offset - total) };
      }
      total += len;
      if (len > 0) last = cur;
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

/**
 * Collapse the caret at the end of an element's own text.
 *
 * Anchored to the last TEXT NODE, not to (element, childIndex): both are
 * valid end positions, but editing commands like Backspace ignore the
 * element form, so typing worked there while deleting did nothing. Text
 * inside a nested embed is skipped — that part is not editable from here.
 */
export function caretAtEndOf(el: HTMLElement): void {
  const sel = window.getSelection();
  if (!sel) return;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) =>
      (n.parentElement?.closest('[data-field]') ?? el) === el &&
      !n.parentElement?.closest('[data-anchor]') &&
      modelLength(n) > 0
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT,
  });
  let last: Text | null = null;
  let cur = walker.nextNode() as Text | null;
  while (cur) {
    last = cur;
    cur = walker.nextNode() as Text | null;
  }
  const r = document.createRange();
  if (last) {
    r.setStart(last, last.textContent?.length ?? 0);
    r.collapse(true);
  } else {
    r.selectNodeContents(el);
    r.collapse(false);
  }
  sel.removeAllRanges();
  sel.addRange(r);
}

/**
 * Insert text at the caret with NO formatting whatsoever.
 *
 * Pasting from Word, a browser or another block otherwise carries the
 * source's fonts, colours and weights into the document, where they win
 * over the block's own styling and cannot be seen in the model. Only
 * `text/plain` is ever read, and it is inserted through the browser's
 * own editing command so the caret, the selection it replaces and the
 * native undo stack all behave exactly as they do for typing.
 *
 * `singleLine` folds line breaks into spaces — for a field value, which
 * is one run of text by definition.
 */
export function insertPlainText(text: string, singleLine = false): void {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  if (singleLine) {
    document.execCommand('insertText', false, lines.join(' '));
    return;
  }
  lines.forEach((line, i) => {
    if (i > 0) document.execCommand('insertParagraph');
    if (line) document.execCommand('insertText', false, line);
  });
}

/**
 * Put the caret immediately before or after an atomic embed.
 *
 * The browser cannot be relied on to do this: the embed is
 * `contenteditable="false"` and carries `user-select: all`, so a click
 * anywhere on it selects the whole thing instead of landing a caret, and
 * a click in the blank space beside it gets snapped to the nearest
 * VISIBLE position — past the caret anchor, which has none. Placing the
 * selection explicitly is what makes the gap reachable.
 *
 * Prefers the anchor rendered for exactly this purpose, then any
 * adjacent text, and falls back to a child-index position on the parent.
 */
export function caretBesideSpan(span: HTMLElement, before: boolean): void {
  const sel = window.getSelection();
  if (!sel) return;
  const sibling = before ? span.previousSibling : span.nextSibling;

  /** Nearest text node in `n` on the side facing the embed. */
  const facingText = (n: Node | null): Text | null => {
    if (!n) return null;
    if (n.nodeType === Node.TEXT_NODE) return n as Text;
    const walker = document.createTreeWalker(n, NodeFilter.SHOW_TEXT);
    if (!before) return walker.nextNode() as Text | null;
    let last: Text | null = null;
    let cur = walker.nextNode() as Text | null;
    while (cur) {
      last = cur;
      cur = walker.nextNode() as Text | null;
    }
    return last;
  };

  const r = document.createRange();
  const text = facingText(sibling);
  if (text) {
    r.setStart(text, before ? (text.textContent?.length ?? 0) : 0);
  } else {
    const parent = span.parentNode;
    if (!parent) return;
    const index = Array.prototype.indexOf.call(parent.childNodes, span);
    r.setStart(parent, before ? index : index + 1);
  }
  r.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r);
}
