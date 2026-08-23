import { useNavigate } from 'react-router-dom';
import { ContextMenu, type MenuItem } from '../components/ContextMenu';
import { useDialog } from '../components/Dialog';
import {
  IconAlignCenter,
  IconAlignLeft,
  IconAlignRight,
  IconBold,
  IconCopy,
  IconImage,
  IconItalic,
  IconLink,
  IconMessage,
  IconPencil,
  IconTable,
  IconTrash,
  IconType,
  IconUnlink,
} from '../components/Icons';
import {
  applyMark,
  plainText,
  rangeHasMark,
  setSpanDirection,
  unlinkSpan,
  type TextRange,
} from '../lib/richtext';
import { collectUsages, locateSpan, valueAsRich } from '../lib/syncfields';
import { deleteField as deleteFieldRow, renameField } from '../store/fields';
import type { Block, RichText, SyncDirection, TextAlign, TextSize } from '../types';
import { useEditor } from './EditorProvider';
import { useFieldOps } from './useFieldOps';
import { useWorkspace } from './workspaceContext';

/** What the user right-clicked. */
export interface CanvasTarget {
  x: number;
  y: number;
  blockId: string | null;
  /** Field span under the pointer, if any. */
  fieldId: string | null;
  /** Text selection inside the block being edited, if any. */
  range: TextRange | null;
}

const SIZES: TextSize[] = ['xs', 'sm', 'md', 'lg', 'xl'];
const DIRECTIONS: { dir: SyncDirection; label: string; hint: string }[] = [
  { dir: 'down', label: '↓ Down', hint: 'follow' },
  { dir: 'up', label: '↑ Up', hint: 'push' },
  { dir: 'two-way', label: '⇅ Two-way', hint: 'both' },
];

/**
 * Right-click menu for the page surface. Covers the whole sync-field
 * workflow — create, bind, nest (narrow), re-direct, unlink, rename,
 * delete, jump to usages — plus text formatting and block actions, so
 * the inspector is never required.
 */
export function CanvasContextMenu({
  target,
  onClose,
}: {
  target: CanvasTarget;
  onClose: () => void;
}) {
  const { state, dispatch, readOnly, currentPage } = useEditor();
  const { doc, masterDoc, fields, fieldMap, setFields, setActiveSpan, setTab } = useWorkspace();
  const { bindRange, defaultDirection } = useFieldOps();
  const dialog = useDialog();
  const navigate = useNavigate();

  const page = currentPage;
  const block: Block | null = target.blockId
    ? (page?.blocks.find((b) => b.id === target.blockId) ?? null)
    : null;
  const isText = block?.type === 'text';
  const blockBinding = block?.binding;
  const bodyLocked = !!blockBinding && blockBinding.direction !== 'up';

  const patch = (p: Partial<Block>) => {
    if (!page || !block) return;
    dispatch({ type: 'UPDATE_BLOCK', pageId: page.id, blockId: block.id, patch: p });
  };

  const getBodyRich = (): RichText | null => (block?.type === 'text' ? block.body : null);

  const setBody = (rich: RichText) => patch({ body: rich } as Partial<Block>);

  /* ---------- Field-span section ---------- */

  const spanItems = (): MenuItem[] => {
    if (!target.fieldId || !block) return [];
    const loc = locateSpan(block, target.fieldId);
    if (!loc || loc.kind !== 'body') return [];
    const field = fieldMap.get(target.fieldId);
    const rich = getBodyRich();
    if (!rich) return [];

    const usages = fields.length ? collectUsages(state.pages).filter((u) => u.fieldId === target.fieldId) : [];
    const preview = field ? plainText(valueAsRich(field.value)) : '';

    const items: MenuItem[] = [
      {
        kind: 'header',
        label: field?.name ?? '(deleted field)',
        sub: preview ? `“${preview.slice(0, 44)}${preview.length > 44 ? '…' : ''}”` : undefined,
      },
    ];

    if (!readOnly) {
      items.push({
        kind: 'submenu',
        label: 'Sync direction',
        items: DIRECTIONS.map((d) => ({
          kind: 'check' as const,
          label: d.label,
          hint: d.hint,
          checked: loc.direction === d.dir,
          onSelect: () => setBody(setSpanDirection(rich, loc.para, loc.path, d.dir)),
        })),
      });

      items.push({
        kind: 'item',
        label: 'Unlink this embed',
        hint: 'keep text',
        icon: <IconUnlink size={13} />,
        onSelect: () => {
          setBody(unlinkSpan(rich, loc.para, loc.path));
          setActiveSpan(null);
        },
      });

      // Narrow: re-bind a smaller selection sitting inside this span.
      items.push({
        kind: 'item',
        label: 'Narrow: field from selection',
        hint: target.range ? undefined : 'select first',
        icon: <IconLink size={13} />,
        disabled: !target.range,
        onSelect: () => {
          void bindRange(rich, target.range).then((next) => next && setBody(next));
        },
      });

      items.push({
        kind: 'item',
        label: 'Rename field…',
        icon: <IconPencil size={13} />,
        disabled: !field,
        onSelect: () => {
          if (!field) return;
          void dialog
            .prompt('Rename sync field', { defaultValue: field.name, confirmLabel: 'Rename' })
            .then(async (name) => {
              const trimmed = name?.trim();
              if (!trimmed || trimmed === field.name) return;
              await renameField(field.id, trimmed);
              setFields((prev) => prev.map((f) => (f.id === field.id ? { ...f, name: trimmed } : f)));
            });
        },
      });
    }

    items.push({ kind: 'separator' });
    items.push({
      kind: 'item',
      label: `Open in Sync panel${usages.length ? ` · ${usages.length} here` : ''}`,
      onSelect: () => {
        setActiveSpan({
          blockId: block.id,
          fieldId: target.fieldId!,
          para: loc.para,
          path: loc.path,
        });
        setTab('sync');
      },
    });

    if (doc.kind === 'adaptation' && masterDoc) {
      items.push({
        kind: 'item',
        label: 'Go to master',
        onSelect: () => navigate(`/docs/${masterDoc.id}`),
      });
    }

    if (!readOnly && field) {
      items.push({
        kind: 'item',
        label: 'Delete field (project-wide)',
        danger: true,
        icon: <IconTrash size={13} />,
        onSelect: () => {
          void dialog
            .confirm(`Delete field “${field.name}”?`, {
              message: 'Every embed keeps its current text but stops syncing.',
              confirmLabel: 'Delete field',
              danger: true,
            })
            .then(async (ok) => {
              if (!ok) return;
              await deleteFieldRow(field.id);
              setFields((prev) => prev.filter((f) => f.id !== field.id));
              setActiveSpan(null);
            });
        },
      });
    }

    items.push({ kind: 'separator' });
    return items;
  };

  /* ---------- Text selection section ---------- */

  const selectionItems = (): MenuItem[] => {
    const rich = getBodyRich();
    if (readOnly || !rich || bodyLocked) return [];
    const range = target.range;
    const hasSel = !!range && range.start !== range.end;

    const items: MenuItem[] = [];

    // Only offer a top-level field bind when not already inside a span
    // (inside one, "Narrow" above is the right action).
    if (!target.fieldId) {
      items.push({
        kind: 'submenu',
        label: 'Make sync field',
        icon: <IconLink size={13} />,
        disabled: !hasSel,
        items: [
          {
            kind: 'item',
            label: `＋ New field (${defaultDirection})`,
            onSelect: () => {
              void bindRange(rich, range).then((next) => next && setBody(next));
            },
          },
          ...(fields.length
            ? ([{ kind: 'separator' }] as MenuItem[]).concat(
                fields.map((f) => ({
                  kind: 'item' as const,
                  label: f.name,
                  hint: 'bind',
                  onSelect: () => {
                    void bindRange(rich, range, { fieldId: f.id }).then(
                      (next) => next && setBody(next),
                    );
                  },
                })),
              )
            : []),
        ],
      });
    }

    items.push({
      kind: 'submenu',
      label: 'Format selection',
      disabled: !hasSel,
      items: [
        {
          kind: 'check',
          label: 'Bold',
          checked: hasSel ? rangeHasMark(rich, range!, 'bold') : false,
          onSelect: () =>
            setBody(applyMark(rich, range!, { bold: !rangeHasMark(rich, range!, 'bold') })),
        },
        {
          kind: 'check',
          label: 'Italic',
          checked: hasSel ? rangeHasMark(rich, range!, 'italic') : false,
          onSelect: () =>
            setBody(applyMark(rich, range!, { italic: !rangeHasMark(rich, range!, 'italic') })),
        },
        { kind: 'separator' },
        ...(['#e61e2a', '#000054', '#15803d', '#b45309', '#16181d'] as const).map((c) => ({
          kind: 'item' as const,
          label: c === '#16181d' ? 'Default colour' : `Colour ${c}`,
          icon: (
            <span
              style={{ width: 11, height: 11, borderRadius: 3, background: c, display: 'block' }}
            />
          ),
          onSelect: () => setBody(applyMark(rich, range!, { color: c === '#16181d' ? undefined : c })),
        })),
      ],
    });

    return items;
  };

  /* ---------- Block section ---------- */

  const blockItems = (): MenuItem[] => {
    if (!block || !page) return [];
    const items: MenuItem[] = [];

    if (!readOnly && isText && !bodyLocked) {
      items.push({
        kind: 'item',
        label: state.editingBlockId === block.id ? 'Stop editing text' : 'Edit text here',
        icon: <IconPencil size={13} />,
        onSelect: () =>
          dispatch({
            type: 'EDIT_TEXT',
            blockId: state.editingBlockId === block.id ? null : block.id,
          }),
      });
    }

    if (!readOnly && isText) {
      items.push({
        kind: 'submenu',
        label: 'Text size',
        items: SIZES.map((s) => ({
          kind: 'check' as const,
          label: s.toUpperCase(),
          checked: (block.type === 'text' ? (block.size ?? 'md') : 'md') === s,
          onSelect: () => patch({ size: s } as Partial<Block>),
        })),
      });
      items.push({
        kind: 'submenu',
        label: 'Align',
        items: (
          [
            ['left', IconAlignLeft],
            ['center', IconAlignCenter],
            ['right', IconAlignRight],
          ] as [TextAlign, typeof IconAlignLeft][]
        ).map(([a, Icon]) => ({
          kind: 'check' as const,
          label: a[0].toUpperCase() + a.slice(1),
          checked: (block.type === 'text' ? (block.align ?? 'left') : 'left') === a,
          onSelect: () => patch({ align: a } as Partial<Block>),
        })),
      });
    }

    // Whole-block binding controls.
    if (!readOnly && blockBinding) {
      items.push({ kind: 'separator' });
      items.push({
        kind: 'header',
        label: 'Block binding',
        sub: blockBinding.fieldId
          ? (fieldMap.get(blockBinding.fieldId)?.name ?? 'field')
          : 'follows master block',
      });
      items.push({
        kind: 'submenu',
        label: 'Block direction',
        items: DIRECTIONS.map((d) => ({
          kind: 'check' as const,
          label: d.label,
          checked: blockBinding.direction === d.dir,
          onSelect: () => patch({ binding: { ...blockBinding, direction: d.dir } }),
        })),
      });
      items.push({
        kind: 'item',
        label: 'Unlink whole block',
        hint: 'keep copy',
        icon: <IconUnlink size={13} />,
        onSelect: () => patch({ binding: undefined }),
      });
    } else if (!readOnly && isText && doc.kind === 'master' && block.type === 'text') {
      items.push({ kind: 'separator' });
      items.push({
        kind: 'item',
        label: 'Bind whole block to a new field',
        icon: <IconLink size={13} />,
        onSelect: () => {
          void bindRange(
            block.body,
            { para: 0, start: 0, end: plainText([block.body[0] ?? []]).length },
            {},
          ).then((next) => next && setBody(next));
        },
      });
    }

    if (!readOnly) {
      items.push({ kind: 'separator' });
      items.push({
        kind: 'item',
        label: 'Duplicate',
        hint: 'Ctrl+D',
        icon: <IconCopy size={13} />,
        onSelect: () => dispatch({ type: 'DUPLICATE_BLOCKS', pageId: page.id, ids: [block.id] }),
      });
      items.push({
        kind: 'submenu',
        label: 'Order',
        items: [
          {
            kind: 'item',
            label: 'Bring to front',
            onSelect: () =>
              dispatch({ type: 'REORDER_BLOCK', pageId: page.id, blockId: block.id, to: 'front' }),
          },
          {
            kind: 'item',
            label: 'Send to back',
            onSelect: () =>
              dispatch({ type: 'REORDER_BLOCK', pageId: page.id, blockId: block.id, to: 'back' }),
          },
        ],
      });
    }

    items.push({
      kind: 'item',
      label: 'Comment on this block',
      icon: <IconMessage size={13} />,
      onSelect: () => {
        dispatch({ type: 'SELECT', ids: [block.id] });
        setTab('comments');
      },
    });

    if (!readOnly) {
      items.push({
        kind: 'item',
        label: state.selection.length > 1 ? `Delete ${state.selection.length} blocks` : 'Delete block',
        hint: 'Del',
        danger: true,
        icon: <IconTrash size={13} />,
        onSelect: () =>
          dispatch({
            type: 'DELETE_BLOCKS',
            pageId: page.id,
            ids: state.selection.includes(block.id) ? state.selection : [block.id],
          }),
      });
    }

    return items;
  };

  /* ---------- Empty page section ---------- */

  const pageItems = (): MenuItem[] => {
    if (block || readOnly || !page) return [];
    return [
      { kind: 'header', label: 'Add block' },
      {
        kind: 'item',
        label: 'Text',
        icon: <IconType size={13} />,
        onSelect: () => dispatch({ type: 'ADD_BLOCK', pageId: page.id, blockType: 'text' }),
      },
      {
        kind: 'item',
        label: 'Table',
        icon: <IconTable size={13} />,
        onSelect: () => dispatch({ type: 'ADD_BLOCK', pageId: page.id, blockType: 'table' }),
      },
      {
        kind: 'item',
        label: 'Image',
        icon: <IconImage size={13} />,
        onSelect: () => dispatch({ type: 'ADD_BLOCK', pageId: page.id, blockType: 'image' }),
      },
      { kind: 'separator' },
      {
        kind: 'submenu',
        label: 'Page',
        items: [
          {
            kind: 'check',
            label: 'Spread (two pages wide)',
            checked: page.kind === 'spread',
            onSelect: () => dispatch({ type: 'TOGGLE_PAGE_KIND', pageId: page.id }),
          },
          {
            kind: 'item',
            label: 'Add page after',
            onSelect: () => dispatch({ type: 'ADD_PAGE', kind: 'single' }),
          },
          {
            kind: 'item',
            label: 'Add spread after',
            onSelect: () => dispatch({ type: 'ADD_PAGE', kind: 'spread' }),
          },
        ],
      },
    ];
  };

  const items: MenuItem[] = [
    ...spanItems(),
    ...selectionItems(),
    ...(target.fieldId || (getBodyRich() && !readOnly) ? [] : []),
    ...blockItems(),
    ...pageItems(),
  ];

  if (readOnly && items.length === 0) {
    items.push({ kind: 'note', label: 'Read-only — press Edit to take the lock.' });
  }
  if (items.length === 0) items.push({ kind: 'note', label: 'Nothing to do here.' });

  // Trim a trailing separator.
  while (items.length && items[items.length - 1].kind === 'separator') items.pop();

  return <ContextMenu x={target.x} y={target.y} items={items} onClose={onClose} />;
}
