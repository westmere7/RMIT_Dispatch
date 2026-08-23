import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useCrumbs } from '../components/AppShell';
import {
  IconCheck,
  IconImage,
  IconLock,
  IconPencil,
  IconTable,
  IconType,
  IconUnlock,
} from '../components/Icons';
import { useDialog } from '../components/Dialog';
import { BlockInspector } from '../components/editor/BlockInspector';
import { PageRail } from '../components/editor/PageRail';
import { InsertFieldButton, ShapeMenu } from '../components/editor/ToolbarInsert';
import type { SpanClickInfo } from '../editor/BlockFrame';
import { EditorCanvas } from '../editor/EditorCanvas';
import { EditorProvider, useEditor } from '../editor/EditorProvider';
import {
  WorkspaceContext,
  type ActiveSpan,
  type InspectorTab,
  type WorkspaceCtx,
} from '../editor/workspaceContext';
import {
  applySyncDown,
  collectUpstream,
  copyBlockContent,
  pageMediaPaths,
  toFieldMap,
  type FieldMap,
} from '../lib/syncfields';
import { useAuth } from '../store/auth';
import { fetchComments } from '../store/comments';
import {
  acquireLock,
  fetchDocument,
  heartbeatLock,
  releaseLock,
} from '../store/documents';
import { fetchDraft, saveDraft } from '../store/drafts';
import { gcMedia } from '../store/mediagc';
import { fetchFieldsForProject, updateFieldValue } from '../store/fields';
import { fetchProject } from '../store/projects';
import {
  subscribeDocument,
  subscribeDraft,
  subscribeSpaceFields,
  type DraftPatch,
  type PresenceUser,
} from '../store/realtime';
import { createVersion } from '../store/versions';
import { useSettings } from '../store/settings';
import { useSpaces } from '../store/spaces';
import {
  fetchUndoHistory,
  pruneUndoHistory,
  pushUndoEntry,
  truncateUndoAbove,
} from '../store/undo';
import type {
  Block,
  DispatchDocument,
  DocComment,
  Page,
  Project,
  SyncField,
} from '../types';

/* ============================================================
   Data loading wrapper
   ============================================================ */

export function Workspace() {
  const { documentId } = useParams<{ documentId: string }>();
  const { user } = useAuth();
  const [loaded, setLoaded] = useState<{
    doc: DispatchDocument;
    project: Project;
    pages: Page[];
    fields: SyncField[];
    masterDoc: DispatchDocument | null;
    masterPages: Page[] | null;
  } | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoaded(null);
    setMissing(false);
    if (!documentId) return;
    void (async () => {
      const doc = await fetchDocument(documentId);
      if (!doc) {
        if (!cancelled) setMissing(true);
        return;
      }
      const project = await fetchProject(doc.projectId);
      if (!project) {
        if (!cancelled) setMissing(true);
        return;
      }
      const [draft, fields] = await Promise.all([
        fetchDraft(doc.id),
        // Local fields of this project plus the space's global ones.
        fetchFieldsForProject(doc.projectId, project.spaceId),
      ]);
      let masterDoc: DispatchDocument | null = null;
      let masterPages: Page[] | null = null;
      if (doc.kind === 'adaptation' && doc.parentId) {
        masterDoc = await fetchDocument(doc.parentId);
        if (masterDoc) masterPages = (await fetchDraft(masterDoc.id))?.pages ?? [];
      }
      if (cancelled) return;
      setLoaded({ doc, project, pages: draft?.pages ?? [], fields, masterDoc, masterPages });
    })();
    return () => {
      cancelled = true;
    };
  }, [documentId]);

  if (missing) {
    return (
      <div className="content-pad">
        <p className="muted">Document not found (or you don&apos;t have access).</p>
      </div>
    );
  }
  if (!loaded || !user) {
    return (
      <div className="center-screen">
        <div className="spinner" />
      </div>
    );
  }
  return <WorkspaceLoaded key={loaded.doc.id} {...loaded} />;
}

/* ============================================================
   Loaded workspace — owns lock/doc state and the EditorProvider.
   ============================================================ */

function blockMap(pages: Page[] | null): Map<string, Block> | null {
  if (!pages) return null;
  return new Map(pages.flatMap((p) => p.blocks.map((b) => [b.id, b] as const)));
}

const TAB_NAMES: InspectorTab[] = ['properties', 'sync', 'versions', 'comments'];

function WorkspaceLoaded(props: {
  doc: DispatchDocument;
  project: Project;
  pages: Page[];
  fields: SyncField[];
  masterDoc: DispatchDocument | null;
  masterPages: Page[] | null;
}) {
  const { user } = useAuth();
  const { canEdit } = useSpaces();
  const { settings } = useSettings();
  const [doc, setDoc] = useState(props.doc);
  const [fields, setFields] = useState<SyncField[]>(props.fields);
  const [masterPages, setMasterPages] = useState<Page[] | null>(props.masterPages);
  const [comments, setComments] = useState<DocComment[]>([]);
  const [presence, setPresence] = useState<PresenceUser[]>([]);
  // A ?tab= link (e.g. from a comment badge) opens that panel directly.
  const [search] = useSearchParams();
  const [tab, setTab] = useState<InspectorTab>(() => {
    const wanted = search.get('tab') as InspectorTab | null;
    return wanted && TAB_NAMES.includes(wanted) ? wanted : 'properties';
  });
  const [activeSpan, setActiveSpan] = useState<ActiveSpan | null>(null);
  const [versionsKey, setVersionsKey] = useState(0);

  const fieldMap = useMemo(() => toFieldMap(fields), [fields]);
  const masterBlocks = useMemo(() => blockMap(masterPages), [masterPages]);

  const isLockHolder = !!user && doc.lock?.uid === user.uid;
  const readOnly = !isLockHolder || !canEdit;

  const sendPatchRef = useRef<((patch: DraftPatch) => void) | null>(null);
  /** Images referenced at the last save, so removals can be collected. */
  const mediaRef = useRef<Set<string>>(new Set(pageMediaPaths(props.pages)));

  // Initial pages resolved against current fields/master.
  const initialPages = useMemo(
    () => applySyncDown(props.pages, toFieldMap(props.fields), blockMap(props.masterPages) ?? undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const onPersist = useCallback(
    async (pages: Page[]) => {
      if (!user) return;
      try {
        await saveDraft(doc.id, pages, user.uid);
        // Any image that left the document is a deletion candidate, but only
        // gets removed once nothing in the project still points at it.
        const now = new Set(pageMediaPaths(pages));
        const gone = [...mediaRef.current].filter((p) => !now.has(p));
        mediaRef.current = now;
        if (gone.length) void gcMedia(doc.projectId, props.project.spaceId, gone);
      } catch (e) {
        console.error('draft save failed', e);
      }
    },
    [doc.id, doc.projectId, props.project.spaceId, user],
  );

  const onBroadcast = useCallback(
    (pages: Page[]) => {
      if (!user) return;
      sendPatchRef.current?.({ pages, by: user.uid, at: new Date().toISOString() });
    },
    [user],
  );

  useEffect(() => {
    void fetchComments(doc.id).then(setComments);
  }, [doc.id]);

  /* ---------- Cloud undo history ---------- */
  const undoSeq = useRef(0);
  const [initialHistory, setInitialHistory] = useState<Page[][] | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void (async () => {
      try {
        const rows = await fetchUndoHistory(doc.id, user.uid, settings.undoSteps);
        if (cancelled) return;
        undoSeq.current = rows.length ? rows[rows.length - 1].seq : 0;
        setInitialHistory(rows.map((r) => r.pages));
      } catch {
        if (!cancelled) setInitialHistory([]);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.id, user?.uid]);

  /** Mirror one undo step to the account's history. */
  const onUndoStep = useCallback(
    (pages: Page[]) => {
      if (!user) return;
      const seq = ++undoSeq.current;
      void (async () => {
        // A fresh edit invalidates any redo branch above this point.
        await truncateUndoAbove(doc.id, user.uid, seq - 1);
        try {
          await pushUndoEntry({
            documentId: doc.id,
            userId: user.uid,
            seq,
            label: `edit ${seq}`,
            pages,
          });
          if (seq % 10 === 0) await pruneUndoHistory(doc.id, user.uid, settings.undoSteps);
        } catch (e) {
          console.warn('undo step not saved', (e as Error).message);
        }
      })();
    },
    [doc.id, user, settings.undoSteps],
  );

  return (
    <EditorProvider
      initialPages={initialPages}
      grid={doc.grid}
      readOnly={readOnly}
      onPersist={onPersist}
      onBroadcast={onBroadcast}
      onUndoStep={onUndoStep}
      undoSteps={settings.undoSteps}
      autosaveMs={settings.autosaveMs}
    >
      <WorkspaceInner
        doc={doc}
        setDoc={setDoc}
        project={props.project}
        fields={fields}
        setFields={setFields}
        fieldMap={fieldMap}
        masterDoc={props.masterDoc}
        masterBlocks={masterBlocks}
        setMasterPages={setMasterPages}
        comments={comments}
        setComments={setComments}
        presence={presence}
        setPresence={setPresence}
        isLockHolder={isLockHolder && canEdit}
        sendPatchRef={sendPatchRef}
        tab={tab}
        setTab={setTab}
        activeSpan={activeSpan}
        setActiveSpan={setActiveSpan}
        versionsKey={versionsKey}
        bumpVersions={() => setVersionsKey((k) => k + 1)}
        initialHistory={initialHistory}
      />
    </EditorProvider>
  );
}

/* ============================================================
   Inner — inside EditorProvider; wires realtime + lock lifecycle.
   ============================================================ */

function WorkspaceInner({
  doc,
  setDoc,
  project,
  fields,
  setFields,
  fieldMap,
  masterDoc,
  masterBlocks,
  setMasterPages,
  comments,
  setComments,
  presence,
  setPresence,
  isLockHolder,
  sendPatchRef,
  tab,
  setTab,
  activeSpan,
  setActiveSpan,
  versionsKey,
  bumpVersions,
  initialHistory,
}: {
  doc: DispatchDocument;
  setDoc: React.Dispatch<React.SetStateAction<DispatchDocument>>;
  project: Project;
  fields: SyncField[];
  setFields: React.Dispatch<React.SetStateAction<SyncField[]>>;
  fieldMap: FieldMap;
  masterDoc: DispatchDocument | null;
  masterBlocks: Map<string, Block> | null;
  setMasterPages: React.Dispatch<React.SetStateAction<Page[] | null>>;
  comments: DocComment[];
  setComments: React.Dispatch<React.SetStateAction<DocComment[]>>;
  presence: PresenceUser[];
  setPresence: React.Dispatch<React.SetStateAction<PresenceUser[]>>;
  isLockHolder: boolean;
  sendPatchRef: React.MutableRefObject<((patch: DraftPatch) => void) | null>;
  tab: InspectorTab;
  setTab: (t: InspectorTab) => void;
  activeSpan: ActiveSpan | null;
  setActiveSpan: (s: ActiveSpan | null) => void;
  versionsKey: number;
  bumpVersions: () => void;
  initialHistory: Page[][] | null;
}) {
  const { user } = useAuth();
  const { canEdit } = useSpaces();
  const { setCrumbs } = useCrumbs();
  const { state, dispatch, flush, undo, redo } = useEditor();

  // Seed the undo stack once the cloud history has loaded.
  useEffect(() => {
    if (initialHistory && initialHistory.length) {
      dispatch({ type: 'SET_HISTORY', past: initialHistory });
    }
  }, [initialHistory, dispatch]);

  // Ctrl/Cmd+Z and Ctrl+Shift+Z / Ctrl+Y, ignored while typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((k === 'z' && e.shiftKey) || k === 'y') {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);
  const dialog = useDialog();

  const isHolderRef = useRef(isLockHolder);
  isHolderRef.current = isLockHolder;
  const fieldMapRef = useRef(fieldMap);
  fieldMapRef.current = fieldMap;
  const masterBlocksRef = useRef(masterBlocks);
  masterBlocksRef.current = masterBlocks;
  const pagesRef = useRef(state.pages);
  pagesRef.current = state.pages;

  useEffect(() => {
    setCrumbs([
      <Link key="p" to="/">
        Projects
      </Link>,
      <Link key="pr" to={`/projects/${project.id}`}>
        {project.title}
      </Link>,
      doc.title,
    ]);
  }, [setCrumbs, project, doc.title]);

  /* ---------- Realtime: document channel ---------- */
  useEffect(() => {
    if (!user) return;
    const sub = subscribeDocument({
      documentId: doc.id,
      presence: { uid: user.uid, name: user.displayName },
      onPresence: setPresence,
      onDraftRow: (draft) => {
        if (isHolderRef.current) return; // our own save echo
        dispatch({
          type: 'REMOTE_PAGES',
          pages: applySyncDown(draft.pages, fieldMapRef.current, masterBlocksRef.current ?? undefined),
        });
      },
      onDocumentRow: (d) => setDoc(d),
      onPatch: (patch) => {
        if (patch.by === user.uid) return;
        dispatch({
          type: 'REMOTE_PAGES',
          pages: applySyncDown(patch.pages, fieldMapRef.current, masterBlocksRef.current ?? undefined),
        });
      },
      onCommentEvent: (event, comment, oldId) => {
        setComments((prev) => {
          if (event === 'DELETE') return prev.filter((c) => c.id !== oldId);
          if (!comment) return prev;
          const without = prev.filter((c) => c.id !== comment.id);
          return [...without, comment].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        });
      },
    });
    sendPatchRef.current = sub.sendPatch;
    return () => {
      sendPatchRef.current = null;
      sub.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.id, user?.uid]);

  /* ---------- Realtime: project fields ---------- */
  useEffect(() => {
    const unsub = subscribeSpaceFields(project.spaceId, (event, field, oldId) => {
      setFields((prev) => {
        if (event === 'DELETE') return prev.filter((f) => f.id !== oldId);
        if (!field) return prev;
        // Keep only what this project can see: its own local fields and
        // every global field in the space.
        const relevant = field.scope === 'global' || field.projectId === project.id;
        const without = prev.filter((f) => f.id !== field.id);
        if (!relevant) return without;
        return [...without, field].sort(
          (a, b) => a.folder.localeCompare(b.folder) || a.name.localeCompare(b.name),
        );
      });
    });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, project.spaceId]);

  /* ---------- Realtime: master draft (adaptations follow live) ---------- */
  useEffect(() => {
    if (!masterDoc) return;
    const unsub = subscribeDraft(masterDoc.id, (draft) => setMasterPages(draft.pages));
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [masterDoc?.id]);

  /* ---------- Downstream propagation into the open editor ---------- */
  useEffect(() => {
    dispatch({ type: 'FIELDS_CHANGED', fields: fieldMap, masterBlocks: masterBlocks ?? undefined });
  }, [fieldMap, masterBlocks, dispatch]);

  /* ---------- Lock heartbeat ---------- */
  useEffect(() => {
    if (!isLockHolder || !user) return;
    const t = window.setInterval(() => void heartbeatLock(doc.id, user.uid), 45_000);
    return () => window.clearInterval(t);
  }, [isLockHolder, doc.id, user]);

  // Release the lock when the holder navigates away.
  useEffect(() => {
    return () => {
      if (isHolderRef.current && user) void releaseLock(doc.id, user.uid);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.id]);

  /* ---------- Pending upstream ---------- */
  const pendingUpstream = useMemo(
    () => (isLockHolder ? collectUpstream(state.pages, fieldMap) : { fields: [], blocks: [] }),
    [state.pages, fieldMap, isLockHolder],
  );

  const applyUpstream = useCallback(async () => {
    if (!user) return;
    const changes = collectUpstream(pagesRef.current, fieldMapRef.current);
    for (const fc of changes.fields) {
      try {
        await updateFieldValue(fc.fieldId, fc.value, user.uid);
      } catch (e) {
        console.error('field upstream failed', e);
      }
    }
    if (changes.blocks.length > 0 && masterDoc) {
      try {
        const masterDraft = await fetchDraft(masterDoc.id);
        if (masterDraft) {
          const byId = new Map(changes.blocks.map((c) => [c.sourceBlockId, c.content]));
          const nextPages = masterDraft.pages.map((p) => ({
            ...p,
            blocks: p.blocks.map((b) => {
              const src = byId.get(b.id);
              return src ? copyBlockContent(b, src) : b;
            }),
          }));
          await saveDraft(masterDoc.id, nextPages, user.uid);
        }
      } catch (e) {
        console.error('block upstream failed (master may be locked)', e);
      }
    }
  }, [user, masterDoc]);

  const saveNow = useCallback(async () => {
    await flush();
    await applyUpstream();
  }, [flush, applyUpstream]);

  /* ---------- Lock actions ---------- */
  const startEditing = useCallback(async () => {
    if (!user) return;
    const ok = await acquireLock(doc.id, user.uid, user.displayName);
    if (!ok) {
      await dialog.alert('Could not take the lock', {
        message: 'Someone else is editing this document right now.',
      });
      return;
    }
    setDoc((d) => ({ ...d, lock: { uid: user.uid, displayName: user.displayName, at: new Date().toISOString() } }));
  }, [doc.id, user, setDoc, dialog]);

  const stopEditing = useCallback(async () => {
    if (!user) return;
    await saveNow();
    await releaseLock(doc.id, user.uid);
    setDoc((d) => ({ ...d, lock: null }));
  }, [doc.id, user, saveNow, setDoc]);

  const finalize = useCallback(async () => {
    if (!user) return;
    const label = await dialog.prompt('Finalize this version', {
      message:
        'Writes an immutable snapshot, applies pending upstream field changes and releases the lock.',
      confirmLabel: 'Finalize',
    });
    if (label === null) return; // cancelled
    await saveNow();
    try {
      await createVersion({
        documentId: doc.id,
        number: doc.versionCount + 1,
        label: label?.trim() || undefined,
        userId: user.uid,
        userName: user.displayName,
        pages: pagesRef.current,
      });
      await releaseLock(doc.id, user.uid);
      setDoc((d) => ({
        ...d,
        lock: null,
        versionCount: d.versionCount + 1,
      }));
      bumpVersions();
    } catch (e) {
      console.error(e);
      await dialog.alert('Finalize failed', { message: String(e) });
    }
  }, [doc.id, doc.versionCount, user, saveNow, setDoc, bumpVersions, dialog]);

  /* ---------- Lock status ---------- */
  const lockStale =
    doc.lock && Date.now() - new Date(doc.lock.at).getTime() > 2 * 60_000 && !isLockHolder;
  const lockedByOther = doc.lock && !isLockHolder;

  const onSpanClick = useCallback(
    (info: SpanClickInfo) => {
      dispatch({ type: 'SELECT', ids: [info.blockId] });
      setActiveSpan(info);
      setTab('sync');
    },
    [dispatch, setActiveSpan, setTab],
  );

  const currentPage = state.pages.find((p) => p.id === state.currentPageId) ?? state.pages[0];

  const ctx: WorkspaceCtx = {
    doc,
    project,
    fields,
    fieldMap,
    setFields,
    masterDoc,
    masterBlocks,
    comments,
    setComments,
    presence,
    isLockHolder,
    pendingUpstream,
    tab,
    setTab,
    activeSpan,
    setActiveSpan,
    saveNow,
    versionsKey: versionsKey,
  };

  return (
    <WorkspaceContext.Provider value={ctx}>
      <div className="workspace">
        <PageRail />
        <div className="workspace-center">
          {lockedByOther && (
            <div className="live-banner">
              <span className="live-chip">
                <IconLock size={10} /> Locked by {doc.lock!.displayName}
              </span>
              <span className="muted">Read-only live view — changes stream in as they type.</span>
              {lockStale && canEdit && (
                <button className="btn btn-sm" onClick={() => void startEditing()}>
                  Take over stale lock
                </button>
              )}
            </div>
          )}
          <div className="editor-toolbar">
            {isLockHolder && currentPage && (
              <>
                <button
                  className="btn btn-sm"
                  onClick={() => dispatch({ type: 'ADD_BLOCK', pageId: currentPage.id, blockType: 'text' })}
                >
                  <IconType size={13} /> Text
                </button>
                <button
                  className="btn btn-sm"
                  onClick={() => dispatch({ type: 'ADD_BLOCK', pageId: currentPage.id, blockType: 'table' })}
                >
                  <IconTable size={13} /> Table
                </button>
                <button
                  className="btn btn-sm"
                  onClick={() => dispatch({ type: 'ADD_BLOCK', pageId: currentPage.id, blockType: 'image' })}
                >
                  <IconImage size={13} /> Image
                </button>
                <ShapeMenu pageId={currentPage.id} />
                <span className="bar-sep" />
                {/* Works with nothing selected: the field lands in a new block. */}
                <InsertFieldButton pageId={currentPage.id} />
                <span style={{ width: 8 }} />
              </>
            )}

            {pendingUpstream.fields.length + pendingUpstream.blocks.length > 0 && (
              <span
                className="pill pill-warning"
                title="Local up / two-way edits apply to the master on save"
              >
                {pendingUpstream.fields.length + pendingUpstream.blocks.length} pending upstream ↑
              </span>
            )}

            <div className="presence-stack" style={{ marginLeft: 'auto' }} title="Currently here">
              {presence.slice(0, 5).map((p) => (
                <span key={p.uid} className="avatar avatar-sm" title={p.name}>
                  {p.name[0]?.toUpperCase() ?? '?'}
                </span>
              ))}
            </div>

            {canEdit &&
              (isLockHolder ? (
                <>
                  <button className="btn btn-sm" onClick={() => void saveNow()}>
                    Save
                  </button>
                  <button className="btn btn-sm" onClick={() => void stopEditing()}>
                    <IconUnlock size={13} /> Stop editing
                  </button>
                  <button className="btn btn-sm btn-primary" onClick={() => void finalize()}>
                    <IconCheck size={13} /> Finalize
                  </button>
                </>
              ) : (
                !doc.lock && (
                  <button className="btn btn-sm btn-primary" onClick={() => void startEditing()}>
                    <IconPencil size={13} /> Edit
                  </button>
                )
              ))}
          </div>
          <EditorCanvas onSpanClick={onSpanClick} />
        </div>
        <BlockInspector />
      </div>
    </WorkspaceContext.Provider>
  );
}
