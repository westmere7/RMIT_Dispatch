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

   Then run everything in [`supabase/migrations/`](supabase/migrations) in order:

   | Migration | Adds |
   | --- | --- |
   | [`002_field_scope_and_folders.sql`](supabase/migrations/002_field_scope_and_folders.sql) | sync-field scope (local/global) and folders |
   | [`003_settings_and_undo.sql`](supabase/migrations/003_settings_and_undo.sql) | per-account settings and cloud-saved undo |
   | [`004_project_folders_and_flags.sql`](supabase/migrations/004_project_folders_and_flags.sql) | project folders and colour flags |

   Each is idempotent too. If the app is ahead of the database it says which
   migration is missing rather than failing silently.

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
- **Project** — one **master** document plus a tree of **adaptations**. An adaptation
  may itself be derived from another adaptation, up to two levels below the master,
  and each one follows the document directly above it. The project page draws that
  lineage with connector rails and a "follows X" line on every child; deleting or
  detaching a parent leaves its children with plain copies rather than dead links.
- **Every document carries its own settings** — page size, orientation, grid and
  margins live on the document, not the project, because a flyer is not an A4 guide.
  Open them from the gear on any row. A document's grid can only be refined, never
  coarsened, and refining rescales that document's blocks alone.
- **Grid** — cells are always **square**. You choose the column count; the row
  count is derived from the page proportions, so a 2×2 block is always a square.
  Granularity runs from Simple (6 columns) to Micro (48), or any custom count.
- **Editing text** — double-click a text block on the page (or press Enter with it
  selected) to type directly on the canvas. A format bar appears with bold, italic,
  colour, five sizes (XS–XL), alignment and **Field**, so sync fields can be made
  from a selection without leaving the page. Esc or *Done* exits.
- **Right-click anything** — the canvas context menu covers the whole sync-field
  workflow without the inspector: on a synced span it offers the field's name and
  value, *Edit field value*, direction (↓ down / ↑ up / ⇅ two-way), *Unlink*,
  *Narrow* (bind a smaller selection inside it), rename, jump to the Sync panel,
  go to master, and project-wide delete. Elsewhere it offers *Make sync field*
  (new or existing), formatting, size, alignment, whole-block binding, duplicate,
  z-order, comment and delete — and on empty page space, adding blocks and pages.
- **Local vs global fields** — a field is either **project-local** (only its own
  project can use it) or **global** (shared by every project in the space). Promote
  or demote one from the Sync panel or the manager page; the database keeps scope and
  ownership consistent, so a global field has no home project.
- **Folders** — fields carry a `/`-separated folder path, so `Pricing/2026/tuition-fee`
  nests two levels deep. Folders are derived from the paths, so there is nothing extra
  to keep in sync; renaming a folder moves everything beneath it.
- **The Sync panel** groups fields into GLOBAL and THIS PROJECT sections, each a
  collapsible folder tree, one compact line per field showing its name, shape and
  how many times this document embeds it. Hovering a row reveals actions: edit in
  isolation (pen), change scope, move to a folder, delete. A filter box narrows long
  lists, and WHERE USED lists live embeds you can jump to.
- **Values open in a popup** — no list ever prints a field's contents. Each row shows
  a compact chip; clicking it opens the full value (text as paragraphs, a table as its
  real grid) together with that field's actions — edit, move to folder, change scope,
  delete. In the Sync panel the field name opens the same popup.
- **Fields hold plain content** — a field value never stores bold, italic or colour.
  Styling belongs to the block that embeds the field, so the same value can appear as a
  heading in one document and body copy in another without fighting its host. Stripping
  happens in the store, so no path can write a formatted value. Structure is preserved:
  nested field spans survive, and a table field keeps its header flag, rows and columns.
- **The Sync fields page** (link icon in the left rail, or *Manage* in the panel) is a
  space-level manager outside any project: create global fields, organise them into
  folders, edit their values, and promote project-local fields to global — all without
  opening a document. It is a real table (field, type, value, availability, actions)
  whose columns stay aligned at any folder depth, because the tree indent lives inside
  the name cell rather than shifting the row. Table fields show their actual grid in the
  value column instead of being flattened to a sentence.
- **Field shapes and where they fit** — a field holds either a *value*, a line of
  *text*, *multi-paragraph* text, or a whole *table*. Two distinct actions exist
  everywhere text is edited: **Field** binds the current selection to a field (the
  selected text becomes the field's value), while **Insert** drops an existing field
  at the caret and takes the text from the field — that's how one price, year or
  sentence appears in many places. Only compatible fields can be chosen: a table
  field fills a whole table block and nothing else; a multi-paragraph field can fill
  a text block but not sit inside a line; a value or single-line field goes anywhere
  text does. Incompatible fields still appear in the menus, greyed out with the
  reason, so the rules are visible rather than mysterious.
- **Editing a field in isolation** — *Edit field value* opens the field on its own,
  so you can change what every document shows without opening any of them. Simple
  fields edit as text; a table field exposes every cell with its header row,
  formatting and row/column editing intact. Saving propagates immediately.
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
