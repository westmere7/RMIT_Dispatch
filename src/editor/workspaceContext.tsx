import { createContext, useContext } from 'react';
import type { FieldMap, UpstreamChanges } from '../lib/syncfields';
import type { Block, DispatchDocument, DocComment, Project, SyncField } from '../types';
import type { PresenceUser } from '../store/realtime';

/* Lives in its own module so canvas-level components can consume the
   workspace without importing the Workspace page (which renders them). */

export type InspectorTab = 'properties' | 'sync' | 'versions' | 'comments';

/** A field span the user clicked, wherever it was clicked from. */
export interface ActiveSpan {
  blockId: string;
  fieldId: string;
  para: number;
  path: number[];
}

export interface WorkspaceCtx {
  doc: DispatchDocument;
  project: Project;
  fields: SyncField[];
  fieldMap: FieldMap;
  setFields: React.Dispatch<React.SetStateAction<SyncField[]>>;
  masterDoc: DispatchDocument | null;
  masterBlocks: Map<string, Block> | null;
  comments: DocComment[];
  setComments: React.Dispatch<React.SetStateAction<DocComment[]>>;
  presence: PresenceUser[];
  isLockHolder: boolean;
  pendingUpstream: UpstreamChanges;
  tab: InspectorTab;
  setTab: (t: InspectorTab) => void;
  activeSpan: ActiveSpan | null;
  setActiveSpan: (s: ActiveSpan | null) => void;
  saveNow: () => Promise<void>;
  versionsKey: number;
}

export const WorkspaceContext = createContext<WorkspaceCtx | null>(null);

export function useWorkspace(): WorkspaceCtx {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error('useWorkspace outside Workspace');
  return ctx;
}

/** For components shared with pages that have no open document. */
export function useWorkspaceOptional(): WorkspaceCtx | null {
  return useContext(WorkspaceContext);
}
