# RMIT Dispatch

A multi-user, realtime **single source of truth for marketing copy**. A content team writes
a **master document** (grid-laid-out pages of text / table / image blocks); other teams
derive **adaptations** (flyer, web banner, guide page…). Shared content stays identical
through **sync fields** — project-level values embedded by reference at any granularity
(whole block, table cell, sentence, single number), nestable, with a per-embed direction
(`down` / `up` / `two-way`). Everyone with a document open sees changes land in near
realtime.

Stack: React 18 + Vite + TypeScript, plain CSS design tokens, and **Supabase** for
everything (Auth, Postgres, Realtime, Storage) — free tier, no server code; all
enforcement via RLS.

## Setup

1. **Create a Supabase project** (free) at [supabase.com](https://supabase.com).

2. **Run the schema**: open the project's *SQL Editor*, paste the entire contents of
   [`supabase/schema.sql`](supabase/schema.sql), and run it. It creates all tables,
   RLS policies, triggers, the realtime publication and the public `media` storage
   bucket. The script is idempotent — safe to re-run.

3. **(Recommended for local testing)** In *Authentication → Providers → Email*, turn
   **off** "Confirm email" so sign-ups work instantly without an SMTP setup.

4. **Environment**: create `.env.local` in the project root:

   ```
   VITE_SUPABASE_URL=https://your-project.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-key
   ```

   Both values are under *Project Settings → API*. Without them the app boots to a
   friendly "not configured" screen.

5. **Run**:

   ```
   npm install
   npm run dev
   ```

   `npm run build` runs `tsc` + `vite build`.

## Trying the realtime features locally

Open the app at `http://localhost:5173` **and** `http://127.0.0.1:5173` — different
origins get separate localStorage sessions, so you can sign in as two different users
side by side and watch locks, live typing (broadcast), sync-field propagation and
comments update in realtime.

## Concepts

- **Space** — a team. Members have a role: `admin` / `editor` (create, lock, edit,
  finalize, restore, manage sync fields and adaptations) or `designer` (read-only +
  comments). RLS restricts every row to members of its space.
- **Project** — one **master** document plus any number of **adaptations**.
- **Editing & locks** — *Edit* takes a per-document lock (enforced by RLS on draft
  writes). Others see "Locked by X" with a live read-only view streamed over a
  broadcast channel. Stale locks (no heartbeat for 2 minutes) can be taken over.
- **Sync fields** — create one in the master by selecting text and using the *Field*
  toolbar button (or bind a whole block / table cell from the inspector). Adaptations
  clone the master with all-`down` block bindings; from there teams *unlink* blocks
  they rewrite, *narrow* (unlink a big embed, re-bind smaller selections inside it),
  or flip an embed to `up` / `two-way` where the adaptation owns the wording.
- **Propagation** — field changes flow **downstream instantly** to every open
  document. **Upstream** edits (`up`/`two-way`) apply when the editor presses *Save*,
  *Stop editing* or *Finalize* — until then a "pending upstream" pill is shown.
  Conflicts are last-write-wins per field.
- **Versions** — *Finalize* flushes the draft, applies pending upstream changes,
  writes an immutable snapshot and releases the lock. *Restore* copies a snapshot back
  into the working draft (bindings restore too, re-resolved against current values).
