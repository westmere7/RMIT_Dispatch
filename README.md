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

5. **Run** — double-click `server.bat`, or:

   ```
   npm install
   npm run dev -- --port 5174 --host
   ```

   `npm run build` runs `tsc` + `vite build`.

## Test account

For local testing, signing in with **`admin`** / **`admin`** works even though it
isn't email-shaped: the pair maps to fixed internal credentials
(`admin@rmit-dispatch.local`) and is auto-provisioned on first sign-in. It behaves
exactly like any other account — same roles, RLS and space membership rules apply,
and it starts with no spaces until you create or are invited to one.

## Trying the realtime features locally

Open the app at `http://localhost:5174` **and** `http://127.0.0.1:5174` — different
origins get separate localStorage sessions, so you can sign in as two different users
side by side and watch locks, live typing (broadcast), sync-field propagation and
comments update in realtime. (`server.bat` passes `--host` so both origins resolve.)

## Concepts

- **Space** — a team. Members have a role: `admin` / `editor` (create, lock, edit,
  finalize, restore, manage sync fields and adaptations) or `designer` (read-only +
  comments). RLS restricts every row to members of its space.
- **Project** — one **master** document plus any number of **adaptations**.
  *Project settings* (on the project page) reopens the setup panel to change the
  title, type and master format later.
- **Grid** — cells are always **square**. You choose the column count; the row
  count is derived from the page proportions, so a 2×2 block is always a square.
  Granularity runs from Simple (6 columns) to Micro (48), or any custom count.
  Once a project exists the grid can only be **refined**, never coarsened —
  enlarging cells would throw away layout precision that existing documents
  depend on. Refining rescales existing blocks so the layout keeps its shape.
- **Editing text** — double-click a text block on the page (or press Enter with it
  selected) to type directly on the canvas. A format bar appears with bold, italic,
  colour, five sizes (XS–XL), alignment and **Field**, so sync fields can be made
  from a selection without leaving the page. Esc or *Done* exits.
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
