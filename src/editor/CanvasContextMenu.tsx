import { useNavigate } from 'react-router-dom';
import { ContextMenu, type MenuItem } from '../components/ContextMenu';
import { useDialog } from '../components/Dialog';
import {
  IconArrowUpDown,
  IconCopy,
  IconImage,
  IconLink,
  IconMessage,
  IconPencil,
  IconPlus,
  IconShapes,
  IconSliders,
  IconTable,
  IconTrash,
  IconType,
  IconUnlink,
} from '../components/Icons';
import { activeEditorRoot } from '../components/editor/BlockProps';
import { restoreSelectionSoon } from '../lib/richdom';
import { SIZE_LABEL, TEXT_SIZES } from '../lib/textsize';
import {
  blockTarget,
  fieldShapeLabel,
  partitionByFit,
  type FieldTarget,
} from '../lib/fieldtypes';
import { emptyRich, insertFieldAt } from '../lib/richtext';
import {
  applyMark,
  applyMarkAll,
  plainText,
  rangeHasMark,
  richHasMark,
  setSpanDirection,
  unlinkSpan,
  wholeTextRange,
  type TextRange,
} from '../lib/richtext';
import {
  autoFieldName,
  collectUsages,
  isContentLocked,
  locateSpan,
  resolveFieldInline,
  valueAsRich,
} from '../lib/syncfields';
import { setCellContent } from '../lib/tables';
import { uuid } from '../lib/ids';
import { useAuth } from '../store/auth';
import { createField, deleteField as deleteFieldRow, renameField } from '../store/fields';
import type {
  Block,
  RichText,
  ShapeKind,
  SyncDirection,
  SyncField,
  TextAlign,
} from '../types';
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


const DIRECTIONS: { dir: SyncDirection; label: string; hint: string }[] = [
  { dir: 'down', label: '↓ Down', hint: 'follow' },
  { dir: 'up', label: '↑ Up', hint: 'push' },
  { dir: 'two-way', label: '⇅ Two-way', hint: 'both' },
];


/** Field rows grouped by scope, so long lists stay organised. */
function fieldItems(
  list: SyncField[],
  onPick: (f: SyncField) => void,
  disabled = false,
): MenuItem[] {
  const out: MenuItem[] = [];
  for (const scope of ['global', 'local'] as const) {
    const scoped = list.filter((f) =>
      scope === 'global' ? f.scope === 'global' : f.scope !== 'global',
    );
    if (scoped.length === 0) continue;
    out.push({ kind: 'note', label: scope === 'global' ? 'Global' : 'This project' });
    for (const f of scoped) {
      out.push({
        kind: 'item',
        label: f.folder ? `${f.folder}/${f.name}` : f.name,
        hint: fieldShapeLabel(f.value),
        disabled,
        onSelect: () => onPick(f),
      });
    }
  }
  return out;
}

/**
 * Right-click menu for the page surface. Covers the whole sync-field
 * workflow — create, bind, nest (narrow), re-direct, unlink, rename,
 * delete, jump to usages — plus text formatting and block actions, so
 * the inspector is never required.
 */
export function CanvasContextMenu({
  target,
  onClose,
  onEditField,
  onInsertTable,
}: {
  target: CanvasTarget;
  onClose: () => void;
  onEditField: (field: SyncField) => void;
  /** Tables ask for their size first, which needs a panel the menu cannot host. */
  onInsertTable?: () => void;
}) {
  const { state, dispatch, readOnly, currentPage } = useEditor();
  const { doc, project, masterDoc, fields, fieldMap, setFields, setActiveSpan, setTab, activeCell } =
    useWorkspace();
  const {
    bindRange,
    insertField,
    bindBlockToField,
    createFieldFromBlock,
    defaultDirection,
    checkFit,
  } = useFieldOps();
  const { user } = useAuth();
  const dialog = useDialog();
  const navigate = useNavigate();

  const page = currentPage;
  const block: Block | null = target.blockId
    ? (page?.blocks.find((b) => b.id === target.blockId) ?? null)
    : null;
  const isText = block?.type === 'text';
  const blockBinding = block?.binding;

  const patch = (p: Partial<Block>) => {
    if (!page || !block) return;
    dispatch({ type: 'UPDATE_BLOCK', pageId: page.id, blockId: block.id, patch: p });
  };

  /*
   * Which text the field actions act on.
   *
   * A table has one body per CELL, so "make a field from this selection"
   * has to know which one — otherwise the menu can only offer to sync
   * the whole table, which is what it used to do. When the menu was
   * opened on an existing span, that span's own cell wins over the
   * selected one; otherwise it is the cell the author last clicked.
   */
  const spanLoc = block && target.fieldId ? locateSpan(block, target.fieldId) : null;
  const cell =
    block?.type === 'table'
      ? spanLoc?.kind === 'cell'
        ? { row: spanLoc.row ?? 0, col: spanLoc.col ?? 0 }
        : {
            row: activeCell?.blockId === block.id ? activeCell.row : 0,
            col: activeCell?.blockId === block.id ? activeCell.col : 0,
          }
      : null;
  const cellBinding =
    block?.type === 'table' && cell
      ? block.cellBindings?.find((b) => b.row === cell.row && b.col === cell.col)
      : undefined;
  const bodyLocked = isContentLocked(blockBinding) || isContentLocked(cellBinding);

  const getBodyRich = (): RichText | null => {
    if (block?.type === 'text') return block.body;
    if (block?.type === 'table' && cell) return block.rows[cell.row]?.[cell.col] ?? null;
    return null;
  };

  const setBody = (rich: RichText) => {
    if (block?.type === 'table' && cell) {
      patch({ rows: setCellContent(block, cell.row, cell.col, rich) } as Partial<Block>);
      return;
    }
    patch({ body: rich } as Partial<Block>);
  };


  /**
   * Insert any sync field as a new block on the page matching its kind.
   */
  const addFieldBlock = async (f: SyncField) => {
    if (!page) return;
    if (f.value.kind === 'table') {
      dispatch({
        type: 'ADD_BLOCK',
        pageId: page.id,
        blockType: 'table',
        table: { headerRow: f.value.headerRow, rows: f.value.rows },
        binding: { fieldId: f.id, sourceBlockId: '', direction: defaultDirection },
      });
      return;
    }
    if (f.value.kind === 'image') {
      dispatch({
        type: 'ADD_BLOCK',
        pageId: page.id,
        blockType: 'image',
        storagePath: f.value.storagePath,
        alt: f.value.alt,
        caption: f.value.caption,
        fit: f.value.fit,
        binding: { fieldId: f.id, sourceBlockId: '', direction: defaultDirection },
      });
      return;
    }
    const children = resolveFieldInline(f.id, fieldMap) ?? [{ text: f.name }];
    const wrapped = insertFieldAt(
      emptyRich(),
      { para: 0, start: 0, end: 0 },
      f.id,
      defaultDirection,
      children,
    );
    dispatch({
      type: 'ADD_BLOCK',
      pageId: page.id,
      blockType: 'text',
      body: wrapped?.rich ?? emptyRich(),
      binding:
        f.value.kind === 'richtext' && f.value.rich.length > 1
          ? { fieldId: f.id, sourceBlockId: '', direction: defaultDirection }
          : undefined,
    });
  };

  /* ---------- Field-span section ---------- */

  const spanItems = (): MenuItem[] => {
    if (!target.fieldId || !block) return [];
    const loc = spanLoc;
    // A span inside a table CELL gets the same actions as one in a body.
    if (!loc) return [];
    const field = fieldMap.get(target.fieldId);
    const rich = getBodyRich();
    if (!rich) return [];

    const usages = fields.length ? collectUsages(state.pages).filter((u) => u.fieldId === target.fieldId) : [];
    const preview = field ? plainText(valueAsRich(field.value)) : '';
    const shape = field ? fieldShapeLabel(field.value) : '';
    const scope = field?.scope === 'global' ? 'Global' : 'Project';

    const items: MenuItem[] = [
      {
        kind: 'header',
        label: field?.name ?? '(deleted field)',
        sub: `${shape.toUpperCase()} · ${scope}${preview ? ` · “${preview.slice(0, 32)}${preview.length > 32 ? '…' : ''}”` : ''}`,
      },
    ];

    if (field) {
      items.push({
        kind: 'item',
        label: 'Edit field value…',
        icon: <IconPencil size={13} />,
        onSelect: () => onEditField(field),
      });
    }

    if (!readOnly) {
      items.push({
        kind: 'submenu',
        label: 'Sync direction',
        icon: <IconArrowUpDown size={13} />,
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
        label: 'Unlink field',
        hint: 'keep text',
        icon: <IconUnlink size={13} />,
        onSelect: () => {
          setBody(unlinkSpan(rich, loc.para, loc.path));
          setActiveSpan(null);
        },
      });

      // Field settings submenu for secondary actions
      const settings: MenuItem[] = [];

      settings.push({
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

      if (target.range) {
        settings.push({
          kind: 'item',
          label: 'Narrow: field from selection',
          icon: <IconLink size={13} />,
          onSelect: () => {
            void bindRange(rich, target.range).then((next) => next && setBody(next));
          },
        });
      }

      settings.push({
        kind: 'item',
        label: `Open in Sync panel${usages.length ? ` (${usages.length} usages)` : ''}`,
        icon: <IconLink size={13} />,
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
        settings.push({
          kind: 'item',
          label: `Go to ${masterDoc.kind === 'master' ? 'master' : 'parent'}`,
          onSelect: () => navigate(`/docs/${masterDoc.id}`),
        });
      }

      if (field) {
        settings.push({ kind: 'separator' });
        settings.push({
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

      items.push({
        kind: 'submenu',
        label: 'Field settings',
        icon: <IconSliders size={13} />,
        items: settings,
      });
    }

    return items;
  };

  /* ---------- Cell section ----------
     A table syncs at three levels, and each one has to be reachable from
     the thing it acts on:

       1. the whole table   — a table field, `block.binding`
       2. one whole cell    — a cell binding, one cell only
       3. the text or the picture inside a cell — an embed

     A cell binding beats the table field for that cell: `applySyncDown`
     lays the table field's rows down first and the cell bindings over
     them, so the narrower claim wins. */

  const cellItems = (): MenuItem[] => {
    if (readOnly || block?.type !== 'table' || !cell) return [];
    const sel = activeCell?.blockId === block.id ? activeCell : null;
    const multi = !!sel && (sel.row !== sel.toRow || sel.col !== sel.toCol);
    const items: MenuItem[] = [];
    const label = `Cell R${cell.row + 1}C${cell.col + 1}`;

    if (cellBinding) {
      const cf = fieldMap.get(cellBinding.fieldId);
      items.push({ kind: 'header', label, sub: `follows “${cf?.name ?? 'field'}”` });
      if (cf) {
        items.push({
          kind: 'item',
          label: 'Edit field value…',
          icon: <IconPencil size={13} />,
          onSelect: () => onEditField(cf),
        });
      }
      items.push({
        kind: 'submenu',
        label: 'Cell sync direction',
        icon: <IconArrowUpDown size={13} />,
        items: DIRECTIONS.map((d) => ({
          kind: 'check' as const,
          label: d.label,
          checked: cellBinding.direction === d.dir,
          onSelect: () =>
            patch({
              cellBindings: (block.cellBindings ?? []).map((b) =>
                b.row === cell.row && b.col === cell.col ? { ...b, direction: d.dir } : b,
              ),
            } as Partial<Block>),
        })),
      });
      items.push({
        kind: 'item',
        label: 'Unlink this cell',
        hint: 'keep copy',
        icon: <IconUnlink size={13} />,
        onSelect: () =>
          patch({
            cellBindings: (block.cellBindings ?? []).filter(
              (b) => !(b.row === cell.row && b.col === cell.col),
            ),
          } as Partial<Block>),
      });
      return items;
    }

    // A cell field owns ONE cell's content, so a range has no meaning here.
    if (multi) {
      items.push({ kind: 'note', label: 'Select a single cell to sync it on its own.' });
      return items;
    }

    const { fits, unfit } = partitionByFit(fields, 'tableCell');
    const rich = block.rows[cell.row]?.[cell.col] ?? emptyRich();
    items.push({
      kind: 'item',
      label: `Make ${label} a sync field`,
      icon: <IconLink size={13} />,
      onSelect: () => void bindCellToField(uuid(), true, rich),
    });
    items.push({
      kind: 'submenu',
      label: 'Bind this cell to existing field',
      icon: <IconLink size={13} />,
      disabled: fields.length === 0,
      items: [
        ...(fits.length
          ? fieldItems(fits, (f) => void bindCellToField(f.id, false, rich))
          : ([{ kind: 'note', label: 'No fields that fit one cell.' }] as MenuItem[])),
        ...(unfit.length
          ? ([{ kind: 'separator' }, { kind: 'note', label: 'Wrong shape for one cell' }] as MenuItem[])
          : []),
        ...fieldItems(unfit.map((u) => u.field), () => {}, true),
      ],
    });
    return items;
  };

  /** Bind the selected cell, creating the field from its content first. */
  const bindCellToField = async (fieldId: string, createNew: boolean, rich: RichText) => {
    if (!block || block.type !== 'table' || !cell || !user) return;
    if (!createNew) {
      const f = fieldMap.get(fieldId);
      if (!f || !(await checkFit(f, 'tableCell'))) return;
    }
    if (createNew) {
      const name = autoFieldName(plainText(rich), new Set(fields.map((f) => f.name)));
      const field = await createField({
        id: fieldId,
        projectId: doc.projectId,
        spaceId: project.spaceId,
        scope: 'local',
        name,
        value: { kind: 'richtext', rich },
        userId: user.uid,
      });
      setFields((prev) => [...prev, field]);
    }
    patch({
      cellBindings: [
        ...(block.cellBindings ?? []).filter((b) => !(b.row === cell.row && b.col === cell.col)),
        { row: cell.row, col: cell.col, fieldId, direction: defaultDirection },
      ],
    } as Partial<Block>);
  };

  /* ---------- Making a field from the selection ---------- */

  const selectionSyncItems = (): MenuItem[] => {
    // A cell is not running text: a table field cannot live in one, and
    // the fit check has to say so.
    const embedTarget: FieldTarget = block?.type === 'table' ? 'tableCell' : 'inline';
    const rich = getBodyRich();
    // Shapes hold no content: no field actions apply.
    if (readOnly || !rich || bodyLocked || block?.type === 'shape') return [];
    const range = target.range;
    const hasSel = !!range && range.start !== range.end;
    /** With no caret (block not being edited), append to the end. */
    const caretFallback = (): TextRange => {
      const last = Math.max(0, rich.length - 1);
      const len = plainText([rich[last] ?? []]).length;
      return { para: last, start: len, end: len };
    };
    // Selecting the block and selecting its text are the same intent.
    const bindTarget = hasSel ? range : wholeTextRange(rich);

    const items: MenuItem[] = [];

    // Only offer a top-level field bind when not already inside a span
    // (inside one, "Narrow" above is the right action).
    if (!target.fieldId) {
      const { fits, unfit } = partitionByFit(fields, embedTarget);
      items.push({
        kind: 'submenu',
        label: hasSel ? 'Make sync field' : 'Make this text a sync field',
        icon: <IconLink size={13} />,
        items: bindTarget
          ? [
              {
                kind: 'item',
                label: `＋ New field (${defaultDirection})`,
                onSelect: () => {
                  void bindRange(rich, bindTarget).then((next) => next && setBody(next));
                },
              },
              ...(fits.length ? ([{ kind: 'separator' }] as MenuItem[]) : []),
              ...fieldItems(fits, (f) => {
                void bindRange(rich, bindTarget, { fieldId: f.id }).then(
                  (next) => next && setBody(next),
                );
              }),
              ...(unfit.length
                ? ([{ kind: 'separator' }, { kind: 'note', label: 'Not usable inline' }] as MenuItem[])
                : []),
              ...fieldItems(unfit.map((u) => u.field), () => {}, true),
            ]
          : ([
              {
                kind: 'note',
                label: 'Select the text to sync — an embed lives inside one paragraph.',
              },
              {
                kind: 'note',
                label: 'For all of it at once, use “Make this block a sync field”.',
              },
            ] as MenuItem[]),
      });
    }

    // Insert an existing field at the caret — its own value supplies the
    // text, so no selection is required.
    {
      const { fits, unfit } = partitionByFit(fields, embedTarget);
      items.push({
        kind: 'submenu',
        label: 'Insert sync field here',
        icon: <IconPlus size={13} />,
        disabled: fields.length === 0,
        items: [
          ...(fits.length
            ? fieldItems(fits, (f) => {
                void insertField(rich, range ?? caretFallback(), f.id, {
                  target: embedTarget,
                }).then((next) => next && setBody(next));
              })
            : ([{ kind: 'note', label: 'No inline-compatible fields yet.' }] as MenuItem[])),
          ...(unfit.length
            ? ([
                { kind: 'separator' },
                { kind: 'note', label: 'Wrong shape for inline text' },
              ] as MenuItem[])
            : []),
          ...fieldItems(unfit.map((u) => u.field), () => {}, true),
        ],
      });
    }

    return items;
  };

  /* ---------- Text formatting on the selection ----------
     Not a sync action, so it stays out of the sync section — it just
     happens to need the same selection. */

  const selectionFormatItems = (): MenuItem[] => {
    const rich = getBodyRich();
    if (readOnly || !rich || bodyLocked || block?.type === 'shape') return [];
    const range = target.range;
    const hasSel = !!range && range.start !== range.end;
    const items: MenuItem[] = [];

    /* Formatting applies to the selection, or to all of the block's text
       when nothing is selected — the word-processor rule. The selection
       is put back afterwards, since marking re-renders the editor. */
    const mark = (patch: Parameters<typeof applyMarkAll>[1]) => {
      setBody(hasSel ? applyMark(rich, range!, patch) : applyMarkAll(rich, patch));
      if (hasSel && block) {
        const id = block.id;
        // A table has one editor per cell; the first is not necessarily
        // the one the selection is in.
        restoreSelectionSoon(() => activeEditorRoot(id), range!);
      }
    };
    const has = (m: 'bold' | 'italic') =>
      hasSel ? rangeHasMark(rich, range!, m) : richHasMark(rich, m);

    items.push({
      kind: 'submenu',
      label: hasSel ? 'Format selection' : 'Format all text',
      items: [
        {
          kind: 'check',
          label: 'Bold',
          checked: has('bold'),
          onSelect: () => mark({ bold: !has('bold') }),
        },
        {
          kind: 'check',
          label: 'Italic',
          checked: has('italic'),
          onSelect: () => mark({ italic: !has('italic') }),
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
          onSelect: () => mark({ color: c === '#16181d' ? undefined : c }),
        })),
      ],
    });

    return items;
  };

  /* ---------- Whole-block binding ---------- */

  const blockSyncItems = (): MenuItem[] => {
    if (!block || !page || readOnly) return [];
    const items: MenuItem[] = [];
    if (!readOnly && blockBinding) {
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
      if (blockBinding.fieldId) {
        const bf = fieldMap.get(blockBinding.fieldId);
        if (bf) {
          items.push({
            kind: 'item',
            label: 'Edit field value…',
            hint: 'isolated',
            icon: <IconPencil size={13} />,
            onSelect: () => onEditField(bf),
          });
        }
      }
      items.push({
        kind: 'item',
        label: 'Unlink whole block',
        hint: 'keep copy',
        icon: <IconUnlink size={13} />,
        onSelect: () => patch({ binding: undefined }),
      });
    } else if (!readOnly && (block.type === 'text' || block.type === 'table' || block.type === 'image')) {
      // Unbound block: promote it to a field, or bind it to an existing
      // one of the matching shape.
      const bt = blockTarget(block)!;
      const { fits, unfit } = partitionByFit(fields, bt);
      items.push({
        kind: 'item',
        label: block.type === 'table' ? 'Make this table a sync field' : 'Make this block a sync field',
        icon: block.type === 'table' ? <IconTable size={13} /> : <IconLink size={13} />,
        onSelect: () => {
          void createFieldFromBlock(block).then((p) => p && patch(p));
        },
      });
      items.push({
        kind: 'submenu',
        label: 'Bind block to existing field',
        icon: <IconLink size={13} />,
        disabled: fields.length === 0,
        items: [
          ...(fits.length
            ? fieldItems(fits, (f) => {
                void bindBlockToField(block, f.id).then((p) => p && patch(p));
              })
            : ([
                {
                  kind: 'note',
                  label:
                    block.type === 'table'
                      ? 'No table fields yet — make one from a table first.'
                      : 'No text fields available.',
                },
              ] as MenuItem[])),
          ...(unfit.length
            ? ([{ kind: 'separator' }, { kind: 'note', label: 'Wrong shape for this block' }] as MenuItem[])
            : []),
          ...fieldItems(unfit.map((u) => u.field), () => {}, true),
        ],
      });
    }

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
        items: TEXT_SIZES.map((s) => ({
          kind: 'check' as const,
          label: SIZE_LABEL[s],
          checked: (block.type === 'text' ? (block.size ?? 'md') : 'md') === s,
          onSelect: () => patch({ size: s } as Partial<Block>),
        })),
      });
      items.push({
        kind: 'submenu',
        label: 'Align',
        items: (['left', 'center', 'right'] as TextAlign[]).map((a) => ({
          kind: 'check' as const,
          label: a[0].toUpperCase() + a.slice(1),
          checked: (block.type === 'text' ? (block.align ?? 'left') : 'left') === a,
          onSelect: () => patch({ align: a } as Partial<Block>),
        })),
      });
    }

    if (!readOnly) {
      // Only when something precedes it, or the group opens on a rule and
      // the join adds a second one.
      if (items.length > 0) items.push({ kind: 'separator' });
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

  /** On empty page: drop any defined field in as a block of its own matching its shape. */
  const pageSyncItems = (): MenuItem[] => {
    if (block || readOnly || !page || fields.length === 0) return [];
    return [
      {
        kind: 'submenu',
        label: 'Insert sync field as a new block',
        icon: <IconLink size={13} />,
        items: fieldItems(fields, (f) => void addFieldBlock(f)),
      },
    ];
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
        // The size is chosen before the block exists — see NewTablePanel.
        onSelect: () => onInsertTable?.(),
      },
      {
        kind: 'item',
        label: 'Image',
        icon: <IconImage size={13} />,
        onSelect: () => dispatch({ type: 'ADD_BLOCK', pageId: page.id, blockType: 'image' }),
      },
      {
        kind: 'submenu',
        label: 'Shape',
        icon: <IconShapes size={13} />,
        items: (
          [
            ['rect', 'Rectangle'],
            ['rounded', 'Rounded rectangle'],
            ['circle', 'Ellipse'],
            ['triangle', 'Triangle'],
            ['line', 'Line'],
            ['arrow', 'Arrow'],
          ] as [ShapeKind, string][]
        ).map(([shape, label]) => ({
          kind: 'item' as const,
          label,
          onSelect: () =>
            dispatch({ type: 'ADD_BLOCK', pageId: page.id, blockType: 'shape', shape }),
        })),
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

  /** Groups joined by a rule, with no leading or doubled separators. */
  const joinSections = (sections: MenuItem[][]): MenuItem[] => {
    const out: MenuItem[] = [];
    for (const section of sections) {
      if (section.length === 0) continue;
      if (out.length > 0) out.push({ kind: 'separator' });
      out.push(...section);
    }
    return out;
  };

  /*
   * Everything to do with sync fields lives in ONE section, under one
   * heading. Scattered through the menu — an embed's actions at the top,
   * "make a field" in the middle, the block binding below Duplicate —
   * they read as unrelated commands that happen to share a word, and the
   * question "what is synced here?" has no single place to look.
   *
   * Within the section: narrowest claim first. The embed under the
   * pointer, then the selection, then the cell, then the whole block.
   */
  /*
   * Clean menu hierarchy:
   * 1. If clicking on an active Field Span:
   *    Show the selected field first (Name, preview, Edit, Direction, Unlink, Field settings submenu),
   *    followed by selection formatting (if range) and block actions.
   * 2. If clicking on a Bound Cell or Bound Block:
   *    Show the binding first (Name, Edit, Direction, Unlink), followed by block actions.
   * 3. If clicking on regular text / selection / empty canvas:
   *    Show sync creation/insertion submenus, text formatting, and block/page actions.
   */
  const isSpanTarget = !!target.fieldId;
  const isBoundTarget = !!blockBinding || !!cellBinding;

  const items: MenuItem[] = isSpanTarget
    ? joinSections([
        spanItems(),
        selectionFormatItems(),
        blockItems(),
      ])
    : isBoundTarget
      ? joinSections([
          block?.type === 'table' && cellBinding ? cellItems() : blockSyncItems(),
          selectionFormatItems(),
          blockItems(),
        ])
      : joinSections([
          selectionSyncItems(),
          block?.type === 'table' ? cellItems() : blockSyncItems(),
          pageSyncItems(),
          selectionFormatItems(),
          blockItems(),
          pageItems(),
        ]);

  if (readOnly && items.length === 0) {
    items.push({ kind: 'note', label: 'Read-only — press Edit to take the lock.' });
  }
  if (items.length === 0) items.push({ kind: 'note', label: 'Nothing to do here.' });

  // Trim a trailing separator.
  while (items.length && items[items.length - 1].kind === 'separator') items.pop();

  return <ContextMenu x={target.x} y={target.y} items={items} onClose={onClose} />;
}
