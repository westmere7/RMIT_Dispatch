import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { DispatchDocument, DocComment, Draft, Page, SyncField } from '../types';
import { mapComment } from './comments';
import { mapDocument } from './documents';
import { mapDraft } from './drafts';
import { mapField } from './fields';

/* ============================================================
   Realtime wiring. Broadcast is the fast path (lock holder streams
   debounced draft patches); postgres_changes is the source of truth.
   Presence powers who's-here avatars + lock liveness.
   ============================================================ */

export interface PresenceUser {
  uid: string;
  name: string;
}

export interface DraftPatch {
  pages: Page[];
  by: string;
  at: string;
}

export type RowEvent = 'INSERT' | 'UPDATE' | 'DELETE';

export function subscribeDocument(args: {
  documentId: string;
  presence: PresenceUser | null;
  onPresence?: (users: PresenceUser[]) => void;
  onDraftRow?: (draft: Draft) => void;
  onDocumentRow?: (doc: DispatchDocument) => void;
  onPatch?: (patch: DraftPatch) => void;
  onCommentEvent?: (event: RowEvent, comment: DocComment | null, oldId: string | null) => void;
}): { sendPatch: (patch: DraftPatch) => void; unsubscribe: () => void } {
  const { documentId } = args;
  const channel: RealtimeChannel = supabase.channel(`doc:${documentId}`, {
    config: { presence: { key: args.presence?.uid ?? `viewer-${Math.random().toString(36).slice(2)}` } },
  });

  if (args.onPresence) {
    channel.on('presence', { event: 'sync' }, () => {
      const state = channel.presenceState<PresenceUser>();
      const users: PresenceUser[] = [];
      for (const key of Object.keys(state)) {
        const metas = state[key];
        if (metas.length > 0) users.push({ uid: metas[0].uid, name: metas[0].name });
      }
      args.onPresence?.(users);
    });
  }

  if (args.onPatch) {
    channel.on('broadcast', { event: 'draft-patch' }, ({ payload }) => {
      args.onPatch?.(payload as DraftPatch);
    });
  }

  if (args.onDraftRow) {
    channel.on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'drafts', filter: `document_id=eq.${documentId}` },
      (payload) => args.onDraftRow?.(mapDraft(payload.new as Record<string, unknown>)),
    );
  }

  if (args.onDocumentRow) {
    channel.on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'documents', filter: `id=eq.${documentId}` },
      (payload) => args.onDocumentRow?.(mapDocument(payload.new as Record<string, unknown>)),
    );
  }

  if (args.onCommentEvent) {
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'comments', filter: `document_id=eq.${documentId}` },
      (payload) => {
        const event = payload.eventType as RowEvent;
        const row = (event === 'DELETE' ? null : (payload.new as Record<string, unknown>)) ?? null;
        const oldId = event === 'DELETE' ? ((payload.old as Record<string, unknown>)?.id as string) ?? null : null;
        args.onCommentEvent?.(event, row ? mapComment(row) : null, oldId);
      },
    );
  }

  channel.subscribe(async (status) => {
    if (status === 'SUBSCRIBED' && args.presence) {
      await channel.track(args.presence);
    }
  });

  return {
    sendPatch: (patch: DraftPatch) => {
      void channel.send({ type: 'broadcast', event: 'draft-patch', payload: patch });
    },
    unsubscribe: () => {
      void supabase.removeChannel(channel);
    },
  };
}

/**
 * Space-wide sync_fields channel. Filtering on space_id catches both
 * local and global fields in one subscription (space_id is set on both);
 * the caller decides which rows are relevant to its project.
 */
export function subscribeSpaceFields(
  spaceId: string,
  onFieldEvent: (event: RowEvent, field: SyncField | null, oldId: string | null) => void,
): () => void {
  const channel = supabase.channel(`space-fields:${spaceId}`);
  channel.on(
    'postgres_changes',
    { event: '*', schema: 'public', table: 'sync_fields', filter: `space_id=eq.${spaceId}` },
    (payload) => {
      const event = payload.eventType as RowEvent;
      const row = event === 'DELETE' ? null : (payload.new as Record<string, unknown>);
      const oldId =
        event === 'DELETE' ? (((payload.old as Record<string, unknown>)?.id as string) ?? null) : null;
      onFieldEvent(event, row ? mapField(row) : null, oldId);
    },
  );
  channel.subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}

/** Watch another document's draft (adaptations follow their master). */
export function subscribeDraft(documentId: string, onDraftRow: (draft: Draft) => void): () => void {
  const channel = supabase.channel(`draft:${documentId}:${Math.random().toString(36).slice(2, 7)}`);
  channel.on(
    'postgres_changes',
    { event: 'UPDATE', schema: 'public', table: 'drafts', filter: `document_id=eq.${documentId}` },
    (payload) => onDraftRow(mapDraft(payload.new as Record<string, unknown>)),
  );
  channel.subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}
