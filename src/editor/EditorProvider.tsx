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
import type { Block, BlockType, GridConfig, GridPos, Page, PageKind } from '../types';

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
  /** Who caused the latest state: local edits schedule persistence. */
  origin: 'init' | 'local' | 'remote';
  rev: number;
}

export type EditorAction =
  | { type: 'INIT'; pages: Page[]; grid: GridConfig }
  | { type: 'REMOTE_PAGES'; pages: Page[] }
  | { type: 'RESTORE_PAGES'; pages: Page[] }
  | { type: 'FIELDS_CHANGED'; fields: FieldMap; masterBlocks?: Map<string, Block> }
  | { type: 'SET_PAGE'; pageId: string }
  | { type: 'SELECT'; ids: string[] }
  | { type: 'TOGGLE_SELECT'; id: string }
  | { type: 'CLEAR_SELECT' }
  | { type: 'EDIT_TEXT'; blockId: string | null }
  | { type: 'ADD_BLOCK'; pageId: string; blockType: BlockType }
  | { type: 'UPDATE_BLOCK'; pageId: string; blockId: string; patch: Partial<Block> }
  | { type: 'REPLACE_BLOCK'; pageId: string; block: Block }
  | { type: 'SET_POSITIONS'; pageId: string; positions: { id: string; pos: GridPos }[] }
  | { type: 'DELETE_BLOCKS'; pageId: string; ids: string[] }
  | { type: 'DUPLICATE_BLOCKS'; pageId: string; ids: string[] }
  | { type: 'REORDER_BLOCK'; pageId: string; blockId: string; to: 'front' | 'back' }
  | { type: 'NUDGE'; pageId: string; ids: string[]; dCol: number; dRow: number }
  | { type: 'ADD_PAGE'; kind: PageKind }
  | { type: 'DELETE_PAGE'; pageId: string }
  | { type: 'TOGGLE_PAGE_KIND'; pageId: string };

function mutatePage(pages: Page[], pageId: string, fn: (p: Page) => Page): Page[] {
  return pages.map((p) => (p.id === pageId ? fn(p) : p));
}

function local(state: EditorState, pages: Page[], extra?: Partial<EditorState>): EditorState {
  return { ...state, pages, origin: 'local', rev: state.rev + 1, ...extra };
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
        selection: action.blockId ? [action.blockId] : state.selection,
      };

    case 'ADD_BLOCK': {
      const page = state.pages.find((p) => p.id === action.pageId);
      if (!page) return state;
      const block = createBlock(action.blockType, page, state.grid);
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
      return local(state, pages);
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
      return local(state, pages);
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
      return local(state, pages);
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
}

const Ctx = createContext<EditorCtx | null>(null);

export function useEditor(): EditorCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useEditor outside EditorProvider');
  return ctx;
}

const SAVE_DEBOUNCE_MS = 600;
const BROADCAST_DEBOUNCE_MS = 250;

export function EditorProvider({
  initialPages,
  grid,
  readOnly,
  onPersist,
  onBroadcast,
  children,
}: {
  initialPages: Page[];
  grid: GridConfig;
  readOnly: boolean;
  onPersist: (pages: Page[]) => Promise<void>;
  onBroadcast?: (pages: Page[]) => void;
  children: ReactNode;
}) {
  const [state, dispatch] = useReducer(editorReducer, undefined, () => ({
    pages: initialPages,
    selection: [],
    currentPageId: initialPages[0]?.id ?? null,
    grid,
    editingBlockId: null,
    origin: 'init' as const,
    rev: 0,
  }));

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
    await persistRef.current(pages);
  }, []);

  // Local edits → debounced save + fast broadcast.
  useEffect(() => {
    if (state.origin !== 'local' || readOnly) return;
    pendingPages.current = state.pages;
    dirtyRef.current = true;
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => void doSave(), SAVE_DEBOUNCE_MS);

    if (broadcastRef.current) {
      if (broadcastTimer.current !== null) window.clearTimeout(broadcastTimer.current);
      const pages = state.pages;
      broadcastTimer.current = window.setTimeout(() => {
        broadcastRef.current?.(pages);
      }, BROADCAST_DEBOUNCE_MS);
    }
  }, [state.rev, state.origin, state.pages, readOnly, doSave]);

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
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
