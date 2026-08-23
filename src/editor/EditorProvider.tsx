import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type Dispatch,
  type ReactNode,
} from 'react';
import { effectiveColumns } from '../grid/presets';
import { clampPos, createBlock, duplicateBlock } from '../lib/blocks';
import { newId } from '../lib/ids';
import { applySyncDown, type FieldMap } from '../lib/syncfields';
import type {
  Block,
  BlockType,
  GridConfig,
  GridPos,
  Page,
  PageKind,
  RichText,
  ShapeKind,
} from '../types';

/* ============================================================
   Local-authoritative editor state. Every edit is a synchronous
   reducer action; persistence (debounced draft save) and the
   broadcast fast-path hang off state changes with origin 'local'.
   Remote realtime changes come back in through the same reducer
   with origin 'remote'.
   ============================================================ */

export interface EditorState {
  pages: Page[];
  selection: string[];
  currentPageId: string | null;
  grid: GridConfig;
  /** Block whose text is being edited directly on the canvas. */
  editingBlockId: string | null;
  /**
   * Key identifying an in-progress run of edits (a drag, a burst of
   * typing). While it stays the same, further edits fold into the step
   * that opened the run instead of each adding one.
   */
  coalescing: string | null;
  /** Snapshots behind the current state, oldest first. */
  past: Page[][];
  /** Snapshots ahead of it, produced by undoing. */
  future: Page[][];
  /** Who caused the latest state: local edits schedule persistence. */
  origin: 'init' | 'local' | 'remote' | 'undo';
  rev: number;
}

export type EditorAction =
  | { type: 'INIT'; pages: Page[]; grid: GridConfig }
  | { type: 'REMOTE_PAGES'; pages: Page[] }
  | { type: 'RESTORE_PAGES'; pages: Page[] }
  | { type: 'UNDO' }
  | { type: 'REDO' }
  | { type: 'SET_HISTORY'; past: Page[][] }
  | { type: 'SET_UNDO_LIMIT'; limit: number }
  | { type: 'END_COALESCE' }
  | { type: 'FIELDS_CHANGED'; fields: FieldMap; masterBlocks?: Map<string, Block> }
  | { type: 'SET_PAGE'; pageId: string }
  | { type: 'SELECT'; ids: string[] }
  | { type: 'TOGGLE_SELECT'; id: string }
  | { type: 'CLEAR_SELECT' }
  | { type: 'EDIT_TEXT'; blockId: string | null }
  | {
      type: 'ADD_BLOCK';
      pageId: string;
      blockType: BlockType;
      /** Shape kind, when adding a decorative shape. */
      shape?: ShapeKind;
      /** Pre-filled body, e.g. a text block seeded with a field embed. */
      body?: RichText;
    }
  | {
      type: 'UPDATE_BLOCK';
      pageId: string;
      blockId: string;
      patch: Partial<Block>;
      /** Fold consecutive updates sharing this key into one undo step. */
      coalesce?: string;
    }
  | { type: 'REPLACE_BLOCK'; pageId: string; block: Block }
  | {
      type: 'SET_POSITIONS';
      pageId: string;
      positions: { id: string; pos: GridPos }[];
      /** Set for the duration of one drag or resize gesture. */
      coalesce?: string;
    }
  | { type: 'DELETE_BLOCKS'; pageId: string; ids: string[] }
  | { type: 'DUPLICATE_BLOCKS'; pageId: string; ids: string[] }
  | { type: 'REORDER_BLOCK'; pageId: string; blockId: string; to: 'front' | 'back' }
  | {
      type: 'NUDGE';
      pageId: string;
      ids: string[];
      dCol: number;
      dRow: number;
      coalesce?: string;
    }
  | { type: 'ADD_PAGE'; kind: PageKind }
  | { type: 'DELETE_PAGE'; pageId: string }
  | { type: 'TOGGLE_PAGE_KIND'; pageId: string };

function mutatePage(pages: Page[], pageId: string, fn: (p: Page) => Page): Page[] {
  return pages.map((p) => (p.id === pageId ? fn(p) : p));
}

/** Steps kept in memory; the cloud history is pruned to the same size. */
let UNDO_LIMIT = 50;

/**
 * Record a local edit. The pre-edit pages go onto the undo stack and the
 * redo branch is dropped, which is what makes a new edit after undoing
 * final.
 *
 * `coalesce` groups a run of related edits — the cell-by-cell updates of
 * one drag, or a burst of typing — into a single undo step. Only the
 * first edit of a run records history; the rest just move the pages.
 */
function local(
  state: EditorState,
  pages: Page[],
  extra?: Partial<EditorState>,
  coalesce?: string,
): EditorState {
  const sameRun = !!coalesce && state.coalescing === coalesce;
  return {
    ...state,
    pages,
    past: sameRun ? state.past : [...state.past, state.pages].slice(-UNDO_LIMIT),
    future: sameRun ? state.future : [],
    coalescing: coalesce ?? null,
    origin: 'local',
    rev: state.rev + 1,
    ...extra,
  };
}

function keepExistingSelection(pages: Page[], selection: string[]): string[] {
  const ids = new Set(pages.flatMap((p) => p.blocks.map((b) => b.id)));
  return selection.filter((id) => ids.has(id));
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'INIT': {
      const pages = action.pages;
      return {
        pages,
        selection: [],
        currentPageId: pages[0]?.id ?? null,
        grid: action.grid,
        editingBlockId: null,
        coalescing: null,
        past: [],
        future: [],
        origin: 'init',
        rev: 0,
      };
    }

    case 'REMOTE_PAGES': {
      const pages = action.pages;
      const currentPageId =
        pages.find((p) => p.id === state.currentPageId)?.id ?? pages[0]?.id ?? null;
      const selection = keepExistingSelection(pages, state.selection);
      return {
        ...state,
        pages,
        currentPageId,
        selection,
        editingBlockId:
          state.editingBlockId && selection.includes(state.editingBlockId)
            ? state.editingBlockId
            : null,
        origin: 'remote',
      };
    }

    case 'RESTORE_PAGES': {
      const pages = action.pages;
      const currentPageId =
        pages.find((p) => p.id === state.currentPageId)?.id ?? pages[0]?.id ?? null;
      return local(state, pages, {
        currentPageId,
        selection: keepExistingSelection(pages, state.selection),
      });
    }

    case 'END_COALESCE':
      // The gesture or typing run finished: the next edit starts a new step.
      return state.coalescing === null ? state : { ...state, coalescing: null };

    case 'SET_UNDO_LIMIT': {
      UNDO_LIMIT = Math.max(1, action.limit);
      return { ...state, past: state.past.slice(-UNDO_LIMIT) };
    }

    case 'SET_HISTORY':
      return { ...state, past: action.past.slice(-UNDO_LIMIT) };

    case 'UNDO': {
      if (state.past.length === 0) return state;
      const pages = state.past[state.past.length - 1];
      return {
        ...state,
        pages,
        past: state.past.slice(0, -1),
        future: [state.pages, ...state.future].slice(0, UNDO_LIMIT),
        selection: keepExistingSelection(pages, state.selection),
        editingBlockId: null,
        coalescing: null,
        currentPageId: pages.find((p) => p.id === state.currentPageId)?.id ?? pages[0]?.id ?? null,
        origin: 'undo',
        rev: state.rev + 1,
      };
    }

    case 'REDO': {
      if (state.future.length === 0) return state;
      const pages = state.future[0];
      return {
        ...state,
        pages,
        past: [...state.past, state.pages].slice(-UNDO_LIMIT),
        future: state.future.slice(1),
        selection: keepExistingSelection(pages, state.selection),
        editingBlockId: null,
        coalescing: null,
        currentPageId: pages.find((p) => p.id === state.currentPageId)?.id ?? pages[0]?.id ?? null,
        origin: 'undo',
        rev: state.rev + 1,
      };
    }

    case 'FIELDS_CHANGED': {
      const pages = applySyncDown(state.pages, action.fields, action.masterBlocks);
      // Applying field values is a content change that must persist if we
      // hold the lock — mark as local only when something actually changed.
      if (JSON.stringify(pages) === JSON.stringify(state.pages)) return state;
      return { ...state, pages, origin: 'remote' };
    }

    case 'SET_PAGE':
      return { ...state, currentPageId: action.pageId, selection: [], editingBlockId: null };

    case 'SELECT':
      return {
        ...state,
        selection: action.ids,
        // Leaving a block ends its inline edit session.
        editingBlockId:
          state.editingBlockId && action.ids.includes(state.editingBlockId)
            ? state.editingBlockId
            : null,
      };
    case 'TOGGLE_SELECT': {
      const has = state.selection.includes(action.id);
      return {
        ...state,
        editingBlockId: null,
        selection: has ? state.selection.filter((i) => i !== action.id) : [...state.selection, action.id],
      };
    }
    case 'CLEAR_SELECT':
      return state.selection.length || state.editingBlockId
        ? { ...state, selection: [], editingBlockId: null }
        : state;

    case 'EDIT_TEXT':
      return {
        ...state,
        editingBlockId: action.blockId,
        coalescing: null,
        selection: action.blockId ? [action.blockId] : state.selection,
      };

    case 'ADD_BLOCK': {
      const page = state.pages.find((p) => p.id === action.pageId);
      if (!page) return state;
      const block = createBlock(action.blockType, page, state.grid, {
        shape: action.shape,
        body: action.body,
      });
      const pages = mutatePage(state.pages, action.pageId, (p) => ({
        ...p,
        blocks: [...p.blocks, block],
      }));
      return local(state, pages, { selection: [block.id], editingBlockId: null });
    }

    case 'UPDATE_BLOCK': {
      const pages = mutatePage(state.pages, action.pageId, (p) => ({
        ...p,
        blocks: p.blocks.map((b) =>
          b.id === action.blockId ? ({ ...b, ...action.patch } as Block) : b,
        ),
      }));
      return local(state, pages, undefined, action.coalesce);
    }

    case 'REPLACE_BLOCK': {
      const pages = mutatePage(state.pages, action.pageId, (p) => ({
        ...p,
        blocks: p.blocks.map((b) => (b.id === action.block.id ? action.block : b)),
      }));
      return local(state, pages);
    }

    case 'SET_POSITIONS': {
      const map = new Map(action.positions.map((x) => [x.id, x.pos]));
      const pages = mutatePage(state.pages, action.pageId, (p) => {
        const cols = effectiveColumns(state.grid, p.kind);
        return {
          ...p,
          blocks: p.blocks.map((b) =>
            map.has(b.id) ? { ...b, pos: clampPos(map.get(b.id)!, cols, state.grid.rows) } : b,
          ),
        };
      });
      return local(state, pages, undefined, action.coalesce);
    }

    case 'DELETE_BLOCKS': {
      const ids = new Set(action.ids);
      const pages = mutatePage(state.pages, action.pageId, (p) => ({
        ...p,
        blocks: p.blocks.filter((b) => !ids.has(b.id)),
      }));
      return local(state, pages, {
        selection: state.selection.filter((id) => !ids.has(id)),
        editingBlockId:
          state.editingBlockId && ids.has(state.editingBlockId) ? null : state.editingBlockId,
      });
    }

    case 'DUPLICATE_BLOCKS': {
      const ids = new Set(action.ids);
      const newIds: string[] = [];
      const pages = mutatePage(state.pages, action.pageId, (p) => {
        const cols = effectiveColumns(state.grid, p.kind);
        const copies = p.blocks
          .filter((b) => ids.has(b.id))
          .map((b) => {
            const copy = duplicateBlock(b, cols, state.grid.rows);
            newIds.push(copy.id);
            return copy;
          });
        return { ...p, blocks: [...p.blocks, ...copies] };
      });
      return local(state, pages, { selection: newIds, editingBlockId: null });
    }

    case 'REORDER_BLOCK': {
      const pages = mutatePage(state.pages, action.pageId, (p) => {
        const idx = p.blocks.findIndex((b) => b.id === action.blockId);
        if (idx < 0) return p;
        const blocks = [...p.blocks];
        const [b] = blocks.splice(idx, 1);
        if (action.to === 'front') blocks.push(b);
        else blocks.unshift(b);
        return { ...p, blocks };
      });
      return local(state, pages);
    }

    case 'NUDGE': {
      const ids = new Set(action.ids);
      const pages = mutatePage(state.pages, action.pageId, (p) => {
        const cols = effectiveColumns(state.grid, p.kind);
        return {
          ...p,
          blocks: p.blocks.map((b) =>
            ids.has(b.id)
              ? {
                  ...b,
                  pos: clampPos(
                    { ...b.pos, col: b.pos.col + action.dCol, row: b.pos.row + action.dRow },
                    cols,
                    state.grid.rows,
                  ),
                }
              : b,
          ),
        };
      });
      return local(state, pages, undefined, action.coalesce);
    }

    case 'ADD_PAGE': {
      const page: Page = { id: newId('pg'), index: state.pages.length, kind: action.kind, blocks: [] };
      const pages = [...state.pages, page];
      return local(state, pages, { currentPageId: page.id, selection: [], editingBlockId: null });
    }

    case 'DELETE_PAGE': {
      if (state.pages.length <= 1) return state;
      const pages = state.pages
        .filter((p) => p.id !== action.pageId)
        .map((p, i) => ({ ...p, index: i }));
      const currentPageId =
        state.currentPageId === action.pageId ? (pages[0]?.id ?? null) : state.currentPageId;
      return local(state, pages, { currentPageId, selection: [], editingBlockId: null });
    }

    case 'TOGGLE_PAGE_KIND': {
      const pages = mutatePage(state.pages, action.pageId, (p) => {
        const kind: PageKind = p.kind === 'single' ? 'spread' : 'single';
        const cols = effectiveColumns(state.grid, kind);
        // Clamp blocks when the column count shrinks.
        return {
          ...p,
          kind,
          blocks: p.blocks.map((b) => ({ ...b, pos: clampPos(b.pos, cols, state.grid.rows) })),
        };
      });
      return local(state, pages);
    }
  }
}

/* ============================================================
   Provider
   ============================================================ */

interface EditorCtx {
  state: EditorState;
  dispatch: Dispatch<EditorAction>;
  /** Read-only view (not the lock holder). */
  readOnly: boolean;
  currentPage: Page | null;
  /** Force-save any pending debounced draft write. */
  flush: () => Promise<void>;
  dirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
}

const Ctx = createContext<EditorCtx | null>(null);

export function useEditor(): EditorCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useEditor outside EditorProvider');
  return ctx;
}

/** For components shared with pages that have no editor mounted. */
export function useEditorOptional(): EditorCtx | null {
  return useContext(Ctx);
}

const SAVE_DEBOUNCE_MS = 600;
const BROADCAST_DEBOUNCE_MS = 250;

export function EditorProvider({
  initialPages,
  grid,
  readOnly,
  onPersist,
  onBroadcast,
  onUndoStep,
  undoSteps = 50,
  autosaveMs = SAVE_DEBOUNCE_MS,
  children,
}: {
  initialPages: Page[];
  grid: GridConfig;
  readOnly: boolean;
  onPersist: (pages: Page[]) => Promise<void>;
  onBroadcast?: (pages: Page[]) => void;
  /** Mirror one undo step to the account's cloud history. */
  onUndoStep?: (pages: Page[]) => void;
  undoSteps?: number;
  autosaveMs?: number;
  children: ReactNode;
}) {
  const initialPagesRef = useRef(initialPages);

  const [state, dispatch] = useReducer(editorReducer, undefined, () => ({
    pages: initialPages,
    selection: [],
    currentPageId: initialPages[0]?.id ?? null,
    grid,
    editingBlockId: null,
    coalescing: null as string | null,
    past: [] as Page[][],
    future: [] as Page[][],
    origin: 'init' as const,
    rev: 0,
  }));

  // Keep the in-memory cap in step with the account setting.
  useEffect(() => {
    dispatch({ type: 'SET_UNDO_LIMIT', limit: undoSteps });
  }, [undoSteps]);

  const saveTimer = useRef<number | null>(null);
  const broadcastTimer = useRef<number | null>(null);
  const pendingPages = useRef<Page[] | null>(null);
  const dirtyRef = useRef(false);
  const persistRef = useRef(onPersist);
  persistRef.current = onPersist;
  const broadcastRef = useRef(onBroadcast);
  broadcastRef.current = onBroadcast;
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;

  const undoStepRef = useRef(onUndoStep);
  undoStepRef.current = onUndoStep;
  /** Pages as they were at the previous save — one undo step. */
  const lastSavedRef = useRef<Page[] | null>(null);

  const doSave = useCallback(async () => {
    if (saveTimer.current !== null) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    const pages = pendingPages.current;
    if (!pages || readOnlyRef.current) {
      dirtyRef.current = false;
      pendingPages.current = null;
      return;
    }
    pendingPages.current = null;
    dirtyRef.current = false;
    // The snapshot BEFORE this save is the step you would undo to.
    const previous = lastSavedRef.current;
    lastSavedRef.current = pages;
    if (previous) undoStepRef.current?.(previous);
    await persistRef.current(pages);
  }, []);

  // Local edits → debounced save + fast broadcast.
  useEffect(() => {
    if ((state.origin !== 'local' && state.origin !== 'undo') || readOnly) return;
    if (lastSavedRef.current === null) lastSavedRef.current = initialPagesRef.current;
    pendingPages.current = state.pages;
    dirtyRef.current = true;
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => void doSave(), autosaveMs);

    if (broadcastRef.current) {
      if (broadcastTimer.current !== null) window.clearTimeout(broadcastTimer.current);
      const pages = state.pages;
      broadcastTimer.current = window.setTimeout(() => {
        broadcastRef.current?.(pages);
      }, BROADCAST_DEBOUNCE_MS);
    }
  }, [state.rev, state.origin, state.pages, readOnly, doSave, autosaveMs]);

  // Flush on unmount.
  useEffect(() => {
    return () => {
      if (dirtyRef.current && pendingPages.current && !readOnlyRef.current) {
        void persistRef.current(pendingPages.current);
      }
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
      if (broadcastTimer.current !== null) window.clearTimeout(broadcastTimer.current);
    };
  }, []);

  const currentPage = useMemo(
    () => state.pages.find((p) => p.id === state.currentPageId) ?? state.pages[0] ?? null,
    [state.pages, state.currentPageId],
  );

  const value: EditorCtx = {
    state,
    dispatch,
    readOnly,
    currentPage,
    flush: doSave,
    dirty: dirtyRef.current,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
    undo: () => dispatch({ type: 'UNDO' }),
    redo: () => dispatch({ type: 'REDO' }),
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
