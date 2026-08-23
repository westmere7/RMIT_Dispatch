import type { FieldSpan, InlineNode, RichText, SyncDirection, TextNode, TextSize } from '../types';
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
      (prev.color ?? '') === (n.color ?? '') &&
      (prev.size ?? '') === (n.size ?? '')
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
 *
 * A COLLAPSED caret must sit strictly between the span's first and last
 * character to count as inside it. At either edge the caret is
 * ambiguous, and reading it as "inside" is what let an insert meant for
 * *after* a field land *within* it — which then mirrored into that
 * field's stored value and leaked one field's content into another.
 * Putting a field inside a field now requires stepping into it first,
 * which is also the only way to get a caret in there.
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
    if (isFieldSpan(n)) {
      const collapsed = start === end;
      const inside = collapsed
        ? start > off && start < off + len
        : start >= off && end <= off + len && !(start === off && end === off + len);
      if (inside) {
        const deeper = findEnclosingSpan(n.children, start - off, end - off, [...path, i]);
        return deeper ?? { span: n, path: [...path, i], relStart: start - off, relEnd: end - off };
      }
    }
    off += len;
  }
  return null;
}

export type MarkPatch = Partial<Pick<TextNode, 'bold' | 'italic' | 'color' | 'size'>>;

/** Marks carried by a node — spans hold their own, same shape as text. */
export function nodeMarks(n: InlineNode): MarkPatch {
  const m: MarkPatch = {};
  if (n.bold) m.bold = true;
  if (n.italic) m.italic = true;
  if (n.color) m.color = n.color;
  if (n.size) m.size = n.size;
  return m;
}

/**
 * Apply marks to exactly the characters in `range` — nothing else — the
 * way a word processor does.
 *
 * A synced span is marked as ONE unit: its children are rewritten from
 * the field value on every sync, so a mark on part of them could not
 * survive. Selecting inside a span therefore styles the whole embed,
 * which is durable and predictable.
 */
export function applyMark(rich: RichText, range: TextRange, patch: MarkPatch): RichText {
  const out = cloneRich(rich);
  const para = out[range.para];
  if (!para) return rich;

  const enclosing = findEnclosingSpan(para, range.start, range.end);
  if (enclosing) {
    // Mutating the located span in the clone is enough: `path` addresses
    // it inside `out`.
    const span = spanAtPath(para, enclosing.path);
    if (!span) return rich;
    Object.assign(span, patch);
    cleanMarks(span);
    return out;
  }

  const ex = extractNodes(para, range.start, range.end);
  if (!ex) return rich;
  const marked = ex.inside.map((n) => {
    const next = { ...n, ...patch } as InlineNode;
    cleanMarks(next);
    return next;
  });
  out[range.para] = normalizeNodes([...ex.before, ...marked, ...ex.after]);
  return out;
}

/** Drop falsy marks so nodes compare and normalize cleanly. */
function cleanMarks(n: InlineNode): void {
  const m = n as { bold?: boolean; italic?: boolean; color?: string; size?: string };
  if (!m.bold) delete m.bold;
  if (!m.italic) delete m.italic;
  if (!m.color) delete m.color;
  if (!m.size) delete m.size;
}

/** Follow a findEnclosingSpan path to the live span node. */
function spanAtPath(nodes: InlineNode[], path: number[]): FieldSpan | null {
  let list = nodes;
  let span: FieldSpan | null = null;
  for (const i of path) {
    const n = list[i];
    if (!n || !isFieldSpan(n)) return null;
    span = n;
    list = n.children;
  }
  return span;
}

/**
 * Is the whole range already marked? Drives the toolbar's toggle state.
 * Spans count by their own mark, since that is what styles them.
 */
export function rangeHasMark(
  rich: RichText,
  range: TextRange,
  mark: 'bold' | 'italic',
): boolean {
  const para = rich[range.para];
  if (!para) return false;
  const enclosing = findEnclosingSpan(para, range.start, range.end);
  if (enclosing) return !!enclosing.span[mark];
  const ex = extractNodes(para, range.start, range.end);
  if (!ex) return false;
  const nodes = ex.inside.filter((n) => nodeLen(n) > 0);
  return nodes.length > 0 && nodes.every((n) => !!n[mark]);
}

/**
 * Apply marks to a whole block of text — every paragraph, end to end.
 * This is the no-selection case: with the block selected but no range
 * chosen, formatting applies to all of its text.
 */
export function applyMarkAll(rich: RichText, patch: MarkPatch): RichText {
  let out = rich;
  for (let i = 0; i < rich.length; i++) {
    out = applyMark(out, { para: i, start: 0, end: nodesLen(out[i]) }, patch);
  }
  return out;
}

/** Is every run in the block already marked? Toggle state for the above. */
export function richHasMark(rich: RichText, mark: 'bold' | 'italic'): boolean {
  const filled = rich
    .map((para, i) => ({ para, i }))
    .filter(({ para }) => nodesLen(para) > 0);
  if (filled.length === 0) return false;
  return filled.every(({ para, i }) =>
    rangeHasMark(rich, { para: i, start: 0, end: nodesLen(para) }, mark),
  );
}

/**
 * Marks shared by every node in a list, used when styled text becomes a
 * field (the marks move onto the span) and when reporting the style at a
 * caret.
 */
export function commonMarks(nodes: InlineNode[]): MarkPatch {
  const real = nodes.filter((n) => nodeLen(n) > 0);
  if (real.length === 0) return {};
  const first = nodeMarks(real[0]);
  return real.slice(1).reduce<MarkPatch>((acc, n) => {
    const m = nodeMarks(n);
    return {
      bold: acc.bold && m.bold ? true : undefined,
      italic: acc.italic && m.italic ? true : undefined,
      color: acc.color && acc.color === m.color ? acc.color : undefined,
      size: acc.size && acc.size === m.size ? acc.size : undefined,
    };
  }, first);
}

/**
 * The size shared by everything in the range, or null when it is mixed
 * or unset (meaning "the block's own size"). Drives the size buttons'
 * active state while a selection is live.
 */
export function rangeSize(rich: RichText, range: TextRange): TextSize | null {
  const para = rich[range.para];
  if (!para) return null;
  const enclosing = findEnclosingSpan(para, range.start, range.end);
  if (enclosing) return enclosing.span.size ?? null;
  const ex = extractNodes(para, range.start, range.end);
  if (!ex) return null;
  return commonMarks(ex.inside).size ?? null;
}

/** The formatting in force at an offset — what typing there would take. */
export function marksAt(nodes: InlineNode[], offset: number): MarkPatch {
  let off = 0;
  let last: MarkPatch = {};
  for (const n of nodes) {
    const len = nodeLen(n);
    if (len === 0) continue;
    // Prefer the run the caret sits inside; at a boundary the run that
    // ENDS there wins, which is what word processors do.
    if (offset > off && offset <= off + len) return nodeMarks(n);
    if (offset === off) last = nodeMarks(n);
    off += len;
  }
  return last;
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
  // Styled text keeps its look: the marks the whole selection shares move
  // onto the span. The field value itself is stored plain, so without
  // this the text would visibly lose its formatting on becoming a field.
  const span: FieldSpan = { fieldId, direction, children, ...commonMarks(children) };
  const next = normalizeNodes([...ex.before, span, ...ex.after]);
  targetNodes.length = 0;
  targetNodes.push(...next);
  return { rich: out, parentFieldId, parentRel, text: nodesText(children), children };
}

/**
 * Insert a field span at a caret (collapsed range) or in place of the
 * selected text. Mirrors wrapField's return shape: when the insertion
 * point sits inside an existing span, the caller must mirror the same
 * insert into that field's canonical value.
 */
export function insertFieldAt(
  rich: RichText,
  range: TextRange,
  fieldId: string,
  direction: SyncDirection,
  children: InlineNode[],
):
  | {
      rich: RichText;
      parentFieldId?: string;
      parentRel?: { start: number; end: number };
    }
  | null {
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
  if (!ex) return null; // the range straddles a span boundary

  // Merge with the surrounding formatting: dropped into the middle of a
  // bold sentence, the embed reads as part of that sentence. A selection
  // being replaced hands over the marks it shared.
  const inherited =
    end > start ? commonMarks(ex.inside) : marksAt(targetNodes, start);
  const span: FieldSpan = {
    fieldId,
    direction,
    children: children.length ? children.map((c) => ({ ...c })) : [{ text: '' }],
    ...inherited,
  };

  /*
   * Separate the embed from its neighbours with a space unless one is
   * already there. Two reasons: words must not run together, and an
   * embed is an ATOMIC object while editing — with nothing either side
   * of it there is nowhere to put the caret, so back-to-back embeds (or
   * one at the very end of a paragraph) become unreachable. Only at the
   * top level: padding inside a parent embed would shift the offsets the
   * caller mirrors into that field's value.
   */
  const pad: InlineNode[] = [];
  const padAfter: InlineNode[] = [];
  if (!enclosing) {
    const prev = ex.before[ex.before.length - 1];
    const nextNode = ex.after[0];
    const marks = inherited as MarkPatch;
    if (prev && (isFieldSpan(prev) || !/\s$/.test(prev.text))) pad.push({ text: ' ', ...marks });
    const noneAfter = !nextNode || (!isFieldSpan(nextNode) && nextNode.text === '');
    if (noneAfter || (nextNode && (isFieldSpan(nextNode) || !/^\s/.test(nextNode.text)))) {
      padAfter.push({ text: ' ', ...marks });
    }
  }

  const next = normalizeNodes([...ex.before, ...pad, span, ...padAfter, ...ex.after]);
  targetNodes.length = 0;
  targetNodes.push(...next);
  return { rich: out, parentFieldId, parentRel };
}

/**
 * Remove character formatting (bold / italic / colour) while preserving
 * structure — nested field spans stay intact. Field values hold content,
 * not styling: the block that embeds a field controls how it looks, so a
 * field carrying its own marks would fight its host.
 */
export function stripMarksNodes(nodes: InlineNode[]): InlineNode[] {
  return normalizeNodes(
    nodes.map((n) =>
      isFieldSpan(n)
        ? // Nested embeds lose their own marks too: a value is content.
          { fieldId: n.fieldId, direction: n.direction, children: stripMarksNodes(n.children) }
        : { text: n.text },
    ),
  );
}

export function stripMarks(rich: RichText): RichText {
  return rich.map(stripMarksNodes);
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
