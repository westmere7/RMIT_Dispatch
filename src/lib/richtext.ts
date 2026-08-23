import type { FieldSpan, InlineNode, RichText, SyncDirection, TextNode } from '../types';
import { isFieldSpan } from '../types';

/* ============================================================
   Rich text model helpers. Sync fields anchor to FieldSpan
   nodes structurally — all range math here treats a FieldSpan
   as a container that can be recursed into, never split.
   ============================================================ */

export function emptyRich(): RichText {
  return [[{ text: '' }]];
}

export function richFromText(text: string): RichText {
  const paras = text.split('\n');
  return paras.length ? paras.map((t) => [{ text: t }]) : emptyRich();
}

export function cloneRich(rich: RichText): RichText {
  return JSON.parse(JSON.stringify(rich)) as RichText;
}

export function nodeLen(n: InlineNode): number {
  return isFieldSpan(n) ? nodesLen(n.children) : n.text.length;
}

export function nodesLen(nodes: InlineNode[]): number {
  return nodes.reduce((sum, n) => sum + nodeLen(n), 0);
}

export function nodesText(nodes: InlineNode[]): string {
  return nodes.map((n) => (isFieldSpan(n) ? nodesText(n.children) : n.text)).join('');
}

export function plainText(rich: RichText): string {
  return rich.map(nodesText).join('\n');
}

/** Drop empty text nodes, merge adjacent identically-marked text nodes. */
export function normalizeNodes(nodes: InlineNode[]): InlineNode[] {
  const out: InlineNode[] = [];
  for (const n of nodes) {
    if (isFieldSpan(n)) {
      out.push({ ...n, children: normalizeNodes(n.children) });
      continue;
    }
    if (n.text === '') continue;
    const prev = out[out.length - 1];
    if (
      prev &&
      !isFieldSpan(prev) &&
      !!prev.bold === !!n.bold &&
      !!prev.italic === !!n.italic &&
      (prev.color ?? '') === (n.color ?? '')
    ) {
      prev.text += n.text;
    } else {
      out.push({ ...n });
    }
  }
  if (out.length === 0) out.push({ text: '' });
  return out;
}

export function normalizeRich(rich: RichText): RichText {
  const out = rich.map(normalizeNodes);
  return out.length ? out : emptyRich();
}

export function richEquals(a: RichText, b: RichText): boolean {
  return JSON.stringify(normalizeRich(cloneRich(a))) === JSON.stringify(normalizeRich(cloneRich(b)));
}

/* ---------- Range operations ----------
   A range addresses characters inside ONE paragraph by plain-text
   offset. FieldSpans count as their text length. */

export interface TextRange {
  para: number;
  start: number;
  end: number;
}

interface Extraction {
  before: InlineNode[];
  inside: InlineNode[];
  after: InlineNode[];
}

/**
 * Split a node list at [start, end). Returns null when the range
 * partially overlaps a FieldSpan boundary (spans are atomic here).
 * A range that falls entirely INSIDE one span is not handled here —
 * detect that case first with findEnclosingSpan.
 */
export function extractNodes(nodes: InlineNode[], start: number, end: number): Extraction | null {
  const before: InlineNode[] = [];
  const inside: InlineNode[] = [];
  const after: InlineNode[] = [];
  let off = 0;
  for (const n of nodes) {
    const len = nodeLen(n);
    const nStart = off;
    const nEnd = off + len;
    off = nEnd;
    if (nEnd <= start) {
      before.push(n);
    } else if (nStart >= end) {
      after.push(n);
    } else if (isFieldSpan(n)) {
      // Span overlaps the range: only allowed when fully contained.
      if (nStart >= start && nEnd <= end) inside.push(n);
      else return null;
    } else {
      const s = Math.max(start, nStart) - nStart;
      const e = Math.min(end, nEnd) - nStart;
      if (s > 0) before.push({ ...n, text: n.text.slice(0, s) });
      if (e > s) inside.push({ ...n, text: n.text.slice(s, e) });
      if (e < len) after.push({ ...n, text: n.text.slice(e) });
    }
  }
  return { before, inside, after };
}

/**
 * If [start,end) of the paragraph falls strictly inside a single
 * FieldSpan, return that span and the range relative to it (recursing
 * into nested spans). Returns the DEEPEST enclosing span path.
 */
export function findEnclosingSpan(
  nodes: InlineNode[],
  start: number,
  end: number,
  path: number[] = [],
): { span: FieldSpan; path: number[]; relStart: number; relEnd: number } | null {
  let off = 0;
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const len = nodeLen(n);
    if (isFieldSpan(n) && start >= off && end <= off + len && !(start === off && end === off + len)) {
      const deeper = findEnclosingSpan(n.children, start - off, end - off, [...path, i]);
      return deeper ?? { span: n, path: [...path, i], relStart: start - off, relEnd: end - off };
    }
    off += len;
  }
  return null;
}

export type MarkPatch = Partial<Pick<TextNode, 'bold' | 'italic' | 'color'>>;

/** Apply marks to a range. Skips FieldSpans (their content is field-owned). */
export function applyMark(rich: RichText, range: TextRange, patch: MarkPatch): RichText {
  const out = cloneRich(rich);
  const para = out[range.para];
  if (!para) return rich;
  const applyTo = (nodes: InlineNode[], start: number, end: number): InlineNode[] | null => {
    const enclosing = findEnclosingSpan(nodes, start, end);
    if (enclosing) return null; // marking inside a synced span is disallowed at this level
    const ex = extractNodes(nodes, start, end);
    if (!ex) return null;
    const marked = ex.inside.map((n) => (isFieldSpan(n) ? n : { ...n, ...patch }));
    return normalizeNodes([...ex.before, ...marked, ...ex.after]);
  };
  const next = applyTo(para, range.start, range.end);
  if (!next) return rich;
  out[range.para] = next;
  return out;
}

/** Does the range contain only bold (etc.) text? Used for toolbar toggle state. */
export function rangeHasMark(
  rich: RichText,
  range: TextRange,
  mark: 'bold' | 'italic',
): boolean {
  const para = rich[range.para];
  if (!para) return false;
  const ex = extractNodes(para, range.start, range.end);
  if (!ex) return false;
  const texts = ex.inside.filter((n): n is TextNode => !isFieldSpan(n));
  return texts.length > 0 && texts.every((n) => !!n[mark]);
}

/**
 * Wrap a range in a new FieldSpan. Supports nesting: if the range is
 * strictly inside an existing span, the wrap happens within that span's
 * children, and the relative range within the innermost enclosing field
 * is reported so the caller can mirror the wrap into the field's value.
 */
export function wrapField(
  rich: RichText,
  range: TextRange,
  fieldId: string,
  direction: SyncDirection,
):
  | {
      rich: RichText;
      /** Innermost field the wrap landed inside, if any. */
      parentFieldId?: string;
      /** Range relative to the parent field's value (paragraph 0). */
      parentRel?: { start: number; end: number };
      /** Plain text of the wrapped content. */
      text: string;
      children: InlineNode[];
    }
  | null {
  if (range.end <= range.start) return null;
  const out = cloneRich(rich);
  const para = out[range.para];
  if (!para) return null;

  const enclosing = findEnclosingSpan(para, range.start, range.end);
  let targetNodes = para;
  let start = range.start;
  let end = range.end;
  let parentFieldId: string | undefined;
  let parentRel: { start: number; end: number } | undefined;

  if (enclosing) {
    targetNodes = enclosing.span.children;
    start = enclosing.relStart;
    end = enclosing.relEnd;
    parentFieldId = enclosing.span.fieldId;
    parentRel = { start, end };
  }

  const ex = extractNodes(targetNodes, start, end);
  if (!ex || ex.inside.length === 0) return null;
  const children = ex.inside;
  const span: FieldSpan = { fieldId, direction, children };
  const next = normalizeNodes([...ex.before, span, ...ex.after]);
  targetNodes.length = 0;
  targetNodes.push(...next);
  return { rich: out, parentFieldId, parentRel, text: nodesText(children), children };
}

/* ---------- Span traversal ---------- */

export interface SpanRef {
  fieldId: string;
  direction: SyncDirection;
  /** para index + node index path from the paragraph root. */
  para: number;
  path: number[];
}

export function forEachSpan(
  rich: RichText,
  cb: (span: FieldSpan, ref: SpanRef) => void,
): void {
  rich.forEach((para, pi) => {
    const walk = (nodes: InlineNode[], path: number[]) => {
      nodes.forEach((n, i) => {
        if (isFieldSpan(n)) {
          cb(n, { fieldId: n.fieldId, direction: n.direction ?? 'down', para: pi, path: [...path, i] });
          walk(n.children, [...path, i]);
        }
      });
    };
    walk(para, []);
  });
}

export function getSpanAt(rich: RichText, para: number, path: number[]): FieldSpan | null {
  let nodes: InlineNode[] | undefined = rich[para];
  let span: FieldSpan | null = null;
  for (const idx of path) {
    if (!nodes) return null;
    const n: InlineNode | undefined = nodes[idx];
    if (!n || !isFieldSpan(n)) return null;
    span = n;
    nodes = n.children;
  }
  return span;
}

/** Immutably transform the span at a path. Returns new RichText. */
export function updateSpanAt(
  rich: RichText,
  para: number,
  path: number[],
  fn: (span: FieldSpan) => InlineNode[] | FieldSpan,
): RichText {
  const out = cloneRich(rich);
  let nodes: InlineNode[] = out[para];
  if (!nodes) return rich;
  for (let d = 0; d < path.length; d++) {
    const idx = path[d];
    const n = nodes[idx];
    if (!n || !isFieldSpan(n)) return rich;
    if (d === path.length - 1) {
      const result = fn(n);
      if (Array.isArray(result)) nodes.splice(idx, 1, ...result);
      else nodes[idx] = result;
      out[para] = normalizeNodes(out[para]);
      return out;
    }
    nodes = n.children;
  }
  return rich;
}

/** Replace a span with its children (detach from the field, keep a copy). */
export function unlinkSpan(rich: RichText, para: number, path: number[]): RichText {
  return updateSpanAt(rich, para, path, (span) => span.children.map((c) => ({ ...c })));
}

export function setSpanDirection(
  rich: RichText,
  para: number,
  path: number[],
  direction: SyncDirection,
): RichText {
  return updateSpanAt(rich, para, path, (span) => ({ ...span, direction }));
}
