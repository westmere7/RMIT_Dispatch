import type { Block, FieldValue, SyncField } from '../types';

/* ============================================================
   Field/target type compatibility. A field's value has a shape,
   and each place you can put a field accepts only some shapes —
   a table can't go inside a sentence, a sentence can't fill a
   table. All rules live here so every entry point agrees.
   ============================================================ */

export type FieldTarget =
  /** A caret or selection inside running text. */
  | 'inline'
  /** A whole text block's body. */
  | 'textBlock'
  /** A whole table block. */
  | 'tableBlock'
  /** A whole image block. */
  | 'imageBlock'
  /** One table cell. */
  | 'tableCell';

export type FieldShape = 'value' | 'text' | 'rich-multi' | 'table' | 'image' | 'group';

export function fieldShape(value: FieldValue): FieldShape {
  if (value.kind === 'scalar') return 'value';
  if (value.kind === 'table') return 'table';
  if (value.kind === 'image') return 'image';
  if (value.kind === 'group') return 'group';
  return value.rich.length > 1 ? 'rich-multi' : 'text';
}

const SHAPE_LABEL: Record<FieldShape, string> = {
  value: 'value',
  text: 'text',
  'rich-multi': 'multi-paragraph',
  table: 'table',
  image: 'image',
  group: 'combination',
};

export function fieldShapeLabel(value: FieldValue): string {
  return SHAPE_LABEL[fieldShape(value)];
}

export interface Compatibility {
  ok: boolean;
  /** Why not — shown to the user instead of silently hiding the option. */
  reason?: string;
}

const OK: Compatibility = { ok: true };

/** Can a field of this shape go into this kind of place? */
export function fieldFits(value: FieldValue, target: FieldTarget): Compatibility {
  const shape = fieldShape(value);

  switch (target) {
    case 'inline':
    case 'tableCell': {
      if (shape === 'table') {
        return {
          ok: false,
          reason: 'A table field can only fill a whole table block.',
        };
      }
      if (shape === 'image') {
        return { ok: false, reason: 'An image field can only fill an image block.' };
      }
      if (shape === 'group') {
        return {
          ok: false,
          reason:
            'A combination field holds several pieces at once, so it cannot sit inside a line. Bind its parts individually.',
        };
      }
      if (shape === 'rich-multi') {
        return {
          ok: false,
          reason:
            'This field holds several paragraphs, so it cannot sit inside a line. Bind a whole text block to it instead.',
        };
      }
      return OK;
    }
    case 'textBlock': {
      if (shape === 'table' || shape === 'image' || shape === 'group') {
        return {
          ok: false,
          reason: `A ${SHAPE_LABEL[shape]} field cannot fill a text block.`,
        };
      }
      return OK;
    }
    case 'tableBlock': {
      if (shape !== 'table') {
        return {
          ok: false,
          reason: `Only a table field can fill a table — this one holds ${SHAPE_LABEL[shape]}.`,
        };
      }
      return OK;
    }
    case 'imageBlock': {
      if (shape !== 'image') {
        return {
          ok: false,
          reason: `Only an image field can fill an image block — this one holds ${SHAPE_LABEL[shape]}.`,
        };
      }
      return OK;
    }
  }
}

/** The target kind implied by binding a whole block of this type. */
export function blockTarget(block: Block): FieldTarget | null {
  if (block.type === 'text') return 'textBlock';
  if (block.type === 'table') return 'tableBlock';
  if (block.type === 'image') return 'imageBlock';
  // Shapes are decoration: they hold no content to sync.
  return null;
}

/** Split a field list into what fits here and what doesn't, with reasons. */
export function partitionByFit(
  fields: SyncField[],
  target: FieldTarget,
): { fits: SyncField[]; unfit: { field: SyncField; reason: string }[] } {
  const fits: SyncField[] = [];
  const unfit: { field: SyncField; reason: string }[] = [];
  for (const f of fields) {
    const c = fieldFits(f.value, target);
    if (c.ok) fits.push(f);
    else unfit.push({ field: f, reason: c.reason ?? 'Incompatible type.' });
  }
  return { fits, unfit };
}
