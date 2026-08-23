import type {
  Block,
  FieldPart,
  FieldValue,
  ImagePayload,
  InlineNode,
  Page,
  RichText,
  SyncDirection,
  SyncField,
} from '../types';
import { isFieldSpan } from '../types';
import { cloneRich, nodesText, normalizeNodes, plainText, richEquals } from './richtext';

export type FieldMap = Map<string, SyncField>;

export function toFieldMap(fields: SyncField[]): FieldMap {
  return new Map(fields.map((f) => [f.id, f]));
}

export function valueAsRich(value: FieldValue): RichText {
  if (value.kind === 'richtext') return value.rich;
  if (value.kind === 'scalar') return [[{ text: value.text }]];
  if (value.kind === 'table') {
    // Flattened for preview purposes only.
    return value.rows.map((row) =>
      row.flatMap((cell, i) => (i ? [{ text: ' · ' }, ...cell.flat()] : cell.flat())),
    );
  }
  if (value.kind === 'image') return [[{ text: value.caption || value.alt || '' }]];
  // A combination: concatenate whatever its text-bearing parts hold.
  return value.parts.flatMap((part) =>
    part.kind === 'text'
      ? part.rich
      : part.kind === 'table'
        ? part.rows.map((row) =>
            row.flatMap((cell, i) => (i ? [{ text: ' · ' }, ...cell.flat()] : cell.flat())),
          )
        : [[{ text: part.caption || part.alt || '' }]],
  );
}

/** Table payload of a field, or null when it isn't a table field. */
export function valueAsTable(value: FieldValue): { headerRow: boolean; rows: RichText[][] } | null {
  return value.kind === 'table' ? { headerRow: value.headerRow, rows: value.rows } : null;
}

/** Image payload of a field, or null when it isn't an image field. */
export function valueAsImage(value: FieldValue): ImagePayload | null {
  return value.kind === 'image' ? value : null;
}

/** Every image path referenced by a document's pages. */
export function pageMediaPaths(pages: Page[]): string[] {
  const out: string[] = [];
  for (const page of pages) {
    for (const b of page.blocks) {
      if (b.type === 'image' && b.storagePath) out.push(b.storagePath);
    }
  }
  return out;
}

/** Every storage path a field value owns — used to clean up on delete. */
export function valueMediaPaths(value: FieldValue): string[] {
  if (value.kind === 'image') return value.storagePath ? [value.storagePath] : [];
  if (value.kind === 'group') {
    return value.parts
      .filter((p): p is Extract<FieldPart, { kind: 'image' }> => p.kind === 'image')
      .map((p) => p.storagePath)
      .filter((p): p is string => !!p);
  }
  return [];
}

/* ============================================================
   Resolution — a field's value may itself contain field spans
   (nested fields). Resolve inner fields first; cycles guard.
   ============================================================ */

/**
 * Collect the local direction of every nested span, keyed by fieldId.
 * Direction is a property of the EMBED (this document's instance), not of
 * the field's canonical value — so when we refresh content from the field
 * we must not let the stored value dictate local directions.
 */
function localDirections(nodes: InlineNode[], out = new Map<string, SyncDirection>()): Map<string, SyncDirection> {
  for (const n of nodes) {
    if (!isFieldSpan(n)) continue;
    if (n.direction) out.set(n.fieldId, n.direction);
    localDirections(n.children, out);
  }
  return out;
}

/** Re-apply remembered local directions onto refreshed content. */
function restoreDirections(nodes: InlineNode[], dirs: Map<string, SyncDirection>): InlineNode[] {
  return nodes.map((n) => {
    if (!isFieldSpan(n)) return n;
    const dir = dirs.get(n.fieldId);
    return {
      ...n,
      ...(dir ? { direction: dir } : {}),
      children: restoreDirections(n.children, dirs),
    };
  });
}

/** Refresh every FieldSpan in a node list from the field map (recursive). */
export function refreshNodes(nodes: InlineNode[], fields: FieldMap, seen: Set<string>): InlineNode[] {
  return normalizeNodes(
    nodes.map((n) => {
      if (!isFieldSpan(n)) return { ...n };
      const dir = n.direction ?? 'down';
      // Recurse into children regardless, then overwrite from the field
      // value when this embed follows the field (down / two-way).
      let children = refreshNodes(n.children, fields, seen);
      if (dir !== 'up') {
        const resolved = resolveFieldInline(n.fieldId, fields, seen);
        if (resolved) children = restoreDirections(resolved, localDirections(n.children));
      }
      return { ...n, direction: dir, children };
    }),
  );
}

/** Fully-resolved single-line node list for a field value (null on
    missing field or cycle). */
export function resolveFieldInline(
  fieldId: string,
  fields: FieldMap,
  seen: Set<string> = new Set(),
): InlineNode[] | null {
  if (seen.has(fieldId)) return null;
  const field = fields.get(fieldId);
  if (!field) return null;
  const nextSeen = new Set(seen).add(fieldId);
  const rich = valueAsRich(field.value);
  const flat = rich.flatMap((para, i) => (i === 0 ? para : [{ text: ' ' }, ...para]));
  return refreshNodes(cloneRich([flat])[0], fields, nextSeen);
}

/** Fully-resolved RichText for a field (multi-paragraph, for block embeds). */
export function resolveFieldRich(
  fieldId: string,
  fields: FieldMap,
  seen: Set<string> = new Set(),
): RichText | null {
  if (seen.has(fieldId)) return null;
  const field = fields.get(fieldId);
  if (!field) return null;
  const nextSeen = new Set(seen).add(fieldId);
  return cloneRich(valueAsRich(field.value)).map((para) => refreshNodes(para, fields, nextSeen));
}

/** Would setting `parentFieldId`'s value to contain `childFieldId` create
    a cycle? True when child's value transitively references parent. */
export function wouldCreateCycle(childFieldId: string, parentFieldId: string, fields: FieldMap): boolean {
  if (childFieldId === parentFieldId) return true;
  const visited = new Set<string>();
  const stack = [childFieldId];
  while (stack.length) {
    const id = stack.pop()!;
    if (id === parentFieldId) return true;
    if (visited.has(id)) continue;
    visited.add(id);
    const field = fields.get(id);
    if (!field) continue;
    for (const para of valueAsRich(field.value)) {
      const walk = (nodes: InlineNode[]) => {
        for (const n of nodes) {
          if (isFieldSpan(n)) {
            stack.push(n.fieldId);
            walk(n.children);
          }
        }
      };
      walk(para);
    }
  }
  return false;
}

/* ============================================================
   Downstream application — rewrite every following embed from
   the canonical field values (and master blocks, for adaptation
   block bindings without a field).
   ============================================================ */

/** Copy content props (never id/pos/binding) from source into target. */
export function copyBlockContent(target: Block, source: Block): Block {
  if (target.type === 'text' && source.type === 'text') {
    return {
      ...target,
      body: cloneRich(source.body),
      size: source.size,
      align: source.align,
      bold: source.bold,
      color: source.color,
    };
  }
  if (target.type === 'table' && source.type === 'table') {
    return {
      ...target,
      headerRow: source.headerRow,
      rows: source.rows.map((row) => row.map((cell) => cloneRich(cell))),
    };
  }
  if (target.type === 'image' && source.type === 'image') {
    return {
      ...target,
      storagePath: source.storagePath,
      fit: source.fit,
      alt: source.alt,
      caption: source.caption,
    };
  }
  return target;
}

export function applySyncDown(
  pages: Page[],
  fields: FieldMap,
  masterBlocks?: Map<string, Block>,
): Page[] {
  return pages.map((page) => ({
    ...page,
    blocks: page.blocks.map((block) => {
      let b: Block = JSON.parse(JSON.stringify(block)) as Block;

      // 1) Whole-block binding. Read the ids up front: reassigning `b`
      //    below would otherwise lose the narrowing on b.binding.
      const binding = b.binding;
      if (binding && binding.direction !== 'up') {
        const boundFieldId = binding.fieldId;
        if (boundFieldId) {
          const field = fields.get(boundFieldId);
          const img = field ? valueAsImage(field.value) : null;
          const table = field ? valueAsTable(field.value) : null;
          if (img && b.type === 'image') {
            b = {
              ...b,
              storagePath: img.storagePath,
              alt: img.alt,
              caption: img.caption,
              fit: img.fit ?? b.fit,
            };
          } else if (table && b.type === 'table') {
            b = {
              ...b,
              headerRow: table.headerRow,
              rows: table.rows.map((row) =>
                row.map((cell) => cell.map((para) => refreshNodes(para, fields, new Set()))),
              ),
            };
          } else if (b.type === 'text') {
            const rich = resolveFieldRich(boundFieldId, fields);
            if (rich) b = { ...b, body: rich };
          }
        } else if (masterBlocks) {
          const src = masterBlocks.get(binding.sourceBlockId);
          if (src) b = copyBlockContent(b, src);
        }
      }

      // 2) Inline field spans in text bodies.
      if (b.type === 'text') {
        b = { ...b, body: b.body.map((para) => refreshNodes(para, fields, new Set())) };
      }

      // 3) Tables: cell bindings + spans inside cells.
      if (b.type === 'table') {
        const rows = b.rows.map((row, ri) =>
          row.map((cell, ci) => {
            const cb = b.type === 'table' ? b.cellBindings?.find((c) => c.row === ri && c.col === ci) : undefined;
            if (cb && cb.direction !== 'up') {
              const resolved = resolveFieldInline(cb.fieldId, fields);
              if (resolved) return [resolved];
            }
            return cell.map((para) => refreshNodes(para, fields, new Set()));
          }),
        );
        b = { ...b, rows };
      }

      return b;
    }),
  }));
}

/* ============================================================
   Upstream collection — find up / two-way embeds whose local
   content differs from the canonical value.
   ============================================================ */

export interface UpstreamFieldChange {
  fieldId: string;
  fieldName: string;
  value: FieldValue;
  preview: string;
}

export interface UpstreamBlockChange {
  sourceBlockId: string;
  content: Block;
}

export interface UpstreamChanges {
  fields: UpstreamFieldChange[];
  blocks: UpstreamBlockChange[];
}

function collectSpanUpstream(
  nodes: InlineNode[],
  fields: FieldMap,
  out: Map<string, UpstreamFieldChange>,
) {
  for (const n of nodes) {
    if (!isFieldSpan(n)) continue;
    const dir = n.direction ?? 'down';
    const field = fields.get(n.fieldId);
    if (field && dir !== 'down') {
      const local: RichText = [normalizeNodes(cloneRich([n.children])[0])];
      if (!richEquals(local, valueAsRich(field.value))) {
        out.set(field.id, {
          fieldId: field.id,
          fieldName: field.name,
          value: { kind: 'richtext', rich: local },
          preview: nodesText(n.children),
        });
      }
    }
    collectSpanUpstream(n.children, fields, out);
  }
}

export function collectUpstream(pages: Page[], fields: FieldMap): UpstreamChanges {
  const fieldChanges = new Map<string, UpstreamFieldChange>();
  const blockChanges: UpstreamBlockChange[] = [];

  for (const page of pages) {
    for (const block of page.blocks) {
      // Whole-block bindings.
      if (block.binding && block.binding.direction !== 'down') {
        if (block.binding.fieldId) {
          const field = fields.get(block.binding.fieldId);
          if (field && block.type === 'text' && !richEquals(block.body, valueAsRich(field.value))) {
            fieldChanges.set(field.id, {
              fieldId: field.id,
              fieldName: field.name,
              value: { kind: 'richtext', rich: cloneRich(block.body) },
              preview: plainText(block.body).slice(0, 80),
            });
          }
          if (field && block.type === 'image') {
            const img = valueAsImage(field.value);
            const changed =
              !img ||
              img.storagePath !== block.storagePath ||
              (img.alt ?? '') !== (block.alt ?? '') ||
              (img.caption ?? '') !== (block.caption ?? '');
            if (changed) {
              fieldChanges.set(field.id, {
                fieldId: field.id,
                fieldName: field.name,
                value: {
                  kind: 'image',
                  storagePath: block.storagePath,
                  alt: block.alt,
                  caption: block.caption,
                  fit: block.fit,
                },
                preview: block.alt || block.caption || 'image',
              });
            }
          }
          if (field && block.type === 'table') {
            const table = valueAsTable(field.value);
            const localRows = block.rows.map((row) => row.map((cell) => cloneRich(cell)));
            const changed =
              !table ||
              table.headerRow !== block.headerRow ||
              JSON.stringify(table.rows) !== JSON.stringify(localRows);
            if (changed) {
              fieldChanges.set(field.id, {
                fieldId: field.id,
                fieldName: field.name,
                value: { kind: 'table', headerRow: block.headerRow, rows: localRows },
                preview: localRows[0]?.map((c) => plainText(c)).join(' · ').slice(0, 80) ?? '',
              });
            }
          }
        } else {
          blockChanges.push({ sourceBlockId: block.binding.sourceBlockId, content: block });
        }
      }

      if (block.type === 'text') {
        for (const para of block.body) collectSpanUpstream(para, fields, fieldChanges);
      }
      if (block.type === 'table') {
        block.rows.forEach((row, ri) =>
          row.forEach((cell, ci) => {
            const cb = block.cellBindings?.find((c) => c.row === ri && c.col === ci);
            if (cb && cb.direction !== 'down') {
              const field = fields.get(cb.fieldId);
              if (field && !richEquals(cell, valueAsRich(field.value))) {
                fieldChanges.set(field.id, {
                  fieldId: field.id,
                  fieldName: field.name,
                  value: { kind: 'richtext', rich: cloneRich(cell) },
                  preview: plainText(cell).slice(0, 80),
                });
              }
            }
            for (const para of cell) collectSpanUpstream(para, fields, fieldChanges);
          }),
        );
      }
    }
  }

  return { fields: [...fieldChanges.values()], blocks: blockChanges };
}

/* ============================================================
   Where-used + adaptation cloning helpers
   ============================================================ */

export interface FieldUsage {
  fieldId: string;
  blockId: string;
  pageId: string;
  kind: 'span' | 'block' | 'cell';
  direction: SyncDirection;
}

export function collectUsages(pages: Page[]): FieldUsage[] {
  const out: FieldUsage[] = [];
  const walkNodes = (nodes: InlineNode[], blockId: string, pageId: string) => {
    for (const n of nodes) {
      if (isFieldSpan(n)) {
        out.push({
          fieldId: n.fieldId,
          blockId,
          pageId,
          kind: 'span',
          direction: n.direction ?? 'down',
        });
        walkNodes(n.children, blockId, pageId);
      }
    }
  };
  for (const page of pages) {
    for (const block of page.blocks) {
      if (block.binding?.fieldId) {
        out.push({
          fieldId: block.binding.fieldId,
          blockId: block.id,
          pageId: page.id,
          kind: 'block',
          direction: block.binding.direction,
        });
      }
      if (block.type === 'text') {
        for (const para of block.body) walkNodes(para, block.id, page.id);
      }
      if (block.type === 'table') {
        block.cellBindings?.forEach((cb) =>
          out.push({ fieldId: cb.fieldId, blockId: block.id, pageId: page.id, kind: 'cell', direction: cb.direction }),
        );
        block.rows.forEach((row) => row.forEach((cell) => cell.forEach((para) => walkNodes(para, block.id, page.id))));
      }
    }
  }
  return out;
}

/** Force every inline field span in a node list to follow the field. */
function forceSpansDown(nodes: InlineNode[]): InlineNode[] {
  return nodes.map((n) =>
    isFieldSpan(n) ? { ...n, direction: 'down' as SyncDirection, children: forceSpansDown(n.children) } : n,
  );
}

/**
 * Deep-clone master pages for a new adaptation: every block gets a fresh
 * id and a `down` binding to its master source, and every embed inside it
 * (inline spans, table cells) also starts as `down` — so a fresh
 * adaptation is exactly the master and follows it live by default.
 */
export function cloneForAdaptation(masterPages: Page[], newBlockId: () => string, newPageId: () => string): Page[] {
  return masterPages.map((page) => ({
    ...page,
    id: newPageId(),
    blocks: page.blocks.map((block) => {
      const copy = JSON.parse(JSON.stringify(block)) as Block;
      const sourceId = block.id;
      copy.id = newBlockId();
      copy.binding = { sourceBlockId: sourceId, direction: 'down' };
      if (copy.type === 'text') copy.body = copy.body.map(forceSpansDown);
      if (copy.type === 'table') {
        copy.rows = copy.rows.map((row) => row.map((cell) => cell.map(forceSpansDown)));
        copy.cellBindings = copy.cellBindings?.map((cb) => ({ ...cb, direction: 'down' }));
      }
      return copy;
    }),
  }));
}

/** Strip every binding (block, cell, span) — used when a master is
    deleted and adaptations keep plain copies. */
export function stripAllBindings(pages: Page[]): Page[] {
  const stripNodes = (nodes: InlineNode[]): InlineNode[] =>
    nodes.flatMap((n) => (isFieldSpan(n) ? stripNodes(n.children) : [n]));
  return pages.map((page) => ({
    ...page,
    blocks: page.blocks.map((block) => {
      const b = JSON.parse(JSON.stringify(block)) as Block;
      delete b.binding;
      if (b.type === 'text') b.body = b.body.map(stripNodes).map(normalizeNodes);
      if (b.type === 'table') {
        delete b.cellBindings;
        b.rows = b.rows.map((row) => row.map((cell) => cell.map(stripNodes).map(normalizeNodes)));
      }
      return b;
    }),
  }));
}

/* ---------- Locating a span inside a block ---------- */

export interface SpanLocation {
  kind: 'body' | 'cell';
  row?: number;
  col?: number;
  para: number;
  path: number[];
  direction: SyncDirection;
}

/**
 * Find where a field is embedded inside one block. Returns the first
 * occurrence — a field appears at most once per block in practice, and
 * callers only need a handle to operate on it.
 */
export function locateSpan(block: Block, fieldId: string): SpanLocation | null {
  let found: SpanLocation | null = null;
  const search = (rich: RichText, kind: 'body' | 'cell', row?: number, col?: number) => {
    forEachSpanRef(rich, (ref) => {
      if (!found && ref.fieldId === fieldId) {
        found = { kind, row, col, para: ref.para, path: ref.path, direction: ref.direction };
      }
    });
  };
  if (block.type === 'text') search(block.body, 'body');
  if (block.type === 'table') {
    block.rows.forEach((row, r) => row.forEach((cell, c) => search(cell, 'cell', r, c)));
  }
  return found;
}

function forEachSpanRef(
  rich: RichText,
  cb: (ref: { fieldId: string; direction: SyncDirection; para: number; path: number[] }) => void,
): void {
  rich.forEach((para, pi) => {
    const walk = (nodes: InlineNode[], path: number[]) => {
      nodes.forEach((n, i) => {
        if (isFieldSpan(n)) {
          cb({ fieldId: n.fieldId, direction: n.direction ?? 'down', para: pi, path: [...path, i] });
          walk(n.children, [...path, i]);
        }
      });
    };
    walk(para, []);
  });
}

/** Auto-name a field from its content ("intro-paragraph" style). */
export function autoFieldName(text: string, existing: Set<string>): string {
  const base =
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .split(/\s+/)
      .slice(0, 4)
      .join('-')
      .slice(0, 40) || 'field';
  let name = base;
  let i = 2;
  while (existing.has(name)) name = `${base}-${i++}`;
  return name;
}
