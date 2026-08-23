import type { InlineNode, RichText, SyncDirection, TextNode } from '../types';
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

function renderNodes(nodes: InlineNode[], editable: boolean): string {
  return nodes
    .map((n) => {
      if (isFieldSpan(n)) {
        const dir = n.direction ?? 'down';
        // `down` embeds follow the field: read-only in place.
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
      return `<span data-t="1"${attrs}>${esc(n.text)}</span>`;
    })
    .join('');
}

export function renderRichHTML(rich: RichText, editable: boolean): string {
  return rich
    .map((para) => `<p data-para="1">${renderNodes(para, editable) || '<br>'}</p>`)
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
        direction: (child.getAttribute('data-dir') as SyncDirection) ?? 'down',
        children: children.length ? children : [{ text: '' }],
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
  if (node === para || para.contains(node)) return offset === 0 ? 0 : total;
  return null;
}

/**
 * Current DOM selection as a single-paragraph model range, or null when
 * there is no usable selection (collapsed, outside, or spanning
 * paragraphs — field spans must not straddle paragraphs).
 */
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
