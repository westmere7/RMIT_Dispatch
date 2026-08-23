import type {
  Block,
  FieldValue,
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
  return value.kind === 'richtext' ? value.rich : [[{ text: value.text }]];
}

/* ============================================================
   Resolution — a field's value may itself contain field spans
   (nested fields). Resolve inner fields first; cycles guard.
   ============================================================ */

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
        if (resolved) children = resolved;
      }
      return { ...n, children };
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
      heading: source.heading,
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

      // 1) Whole-block binding.
      if (b.binding && b.binding.direction !== 'up') {
        if (b.binding.fieldId) {
          const rich = resolveFieldRich(b.binding.fieldId, fields);
          if (rich && b.type === 'text') b = { ...b, body: rich };
        } else if (masterBlocks) {
          const src = masterBlocks.get(b.binding.sourceBlockId);
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

/** Deep-clone master pages for a new adaptation: every block gets a
    fresh id and a `down` binding to its master source. */
export function cloneForAdaptation(masterPages: Page[], newBlockId: () => string, newPageId: () => string): Page[] {
  return masterPages.map((page) => ({
    ...page,
    id: newPageId(),
    blocks: page.blocks.map((block) => {
      const copy = JSON.parse(JSON.stringify(block)) as Block;
      const sourceId = block.id;
      copy.id = newBlockId();
      copy.binding = { sourceBlockId: sourceId, direction: 'down' };
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
