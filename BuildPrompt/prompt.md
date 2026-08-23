# Build: RMIT Dispatch

Build a web app called **RMIT Dispatch** — a multi-user, realtime "single source of
truth" for marketing copy. A contents team writes a **master copy** (pure text, a set of
text/images, or a fully laid-out page); other teams derive **adaptations** (flyer, web
banner, postgrad guide page…) from it. Shared content between master and adaptations is
kept identical via **sync fields** with a selectable sync direction. Anyone with a
document open sees changes land in (near) realtime.

## Stack & constraints
- React 18 + Vite + TypeScript, react-router-dom, framer-motion.
- Plain CSS with CSS-variable design tokens (NO Tailwind, no UI library).
- **Supabase for everything**: Auth, Postgres, Realtime, Storage. Free tier only — no
  Edge Functions, no server code; all enforcement via **RLS policies**. Provide the full
  SQL schema + RLS in `supabase/schema.sql` and document setup steps in the README.
- Client reads/writes Postgres directly via `@supabase/supabase-js`. Keep a thin
  repository seam (`src/store/*`) so the UI never touches the SDK directly.
- Images/media: upload to a Supabase Storage bucket (`media`), store the path in the
  block, render via public/signed URL. No data-URLs.
- Must `npm run build` (tsc + vite) clean. Windows/PowerShell host. Env in `.env.local`
  (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`); app boots to a friendly "not
  configured" screen if env is missing.

## Auth, spaces, roles
- Supabase email+password auth (sign up + sign in screens).
- **Spaces** (teams). Users belong to spaces via `space_members` with Role =
  `'admin' | 'editor' | 'designer'`. Admin/editor: create projects, lock, edit, finalize,
  restore, manage sync fields, add/delete adaptations; designer: read-only + comments.
  Space admins manage members. A space switcher lives in the top bar.
- RLS: every table row is reachable only by members of its space; write policies mirror
  the role rules above (and enforce lock ownership on draft writes).

## Design system (do this first)
- If a `ui-ux-pro-max` skill is available (installed as a plugin or in
  `.claude/skills/`), use it when building the design system and page layouts — but
  keep the RMIT brand tokens below as the palette: the skill informs typography,
  spacing, and UX patterns, NOT brand colors.

**Visual language** — clean, professional, modern-SaaS (think a polished HR/calendar
dashboard, NOT a dense dev tool). A reference screenshot ships next to this file as
`ui-reference.png` — look at it before building the shell; match its feel, not its
content (and ignore its yellow/purple accents — brand colors below win):
- The whole app sits as a large floating panel: a muted cool-gray/lavender page canvas
  (`--bg`) with the app surface (`--surface`) inset on it — big radius
  (`--radius-lg`), soft `--shadow`, a breathing margin around the shell.
- **Left rail**: slim, icon-only vertical nav (~56px), rounded icon buttons, active
  item tinted with `--accent` on a soft accent-wash background; tooltips on hover.
- **Top bar**: page title/breadcrumb left; a centered pill search field
  (`--surface-2`, no border, rounded-full); right side = theme toggle, notifications,
  space switcher, user avatar + role pill.
- **Controls**: segmented pill filter groups (e.g. All | Masters | Adaptations) — the
  active segment is a white (surface) pill with a hairline border and `--shadow-sm`;
  dropdowns and buttons are compact pills/rounded rects, 32–36px tall.
- **Cards & list rows** (projects, adaptations, versions, comments, fields): `--surface`
  on a 1px `--border` hairline, `--radius`, `--shadow-sm`, tight 12–16px padding, and a
  **3px colored left accent bar** for status/kind (navy = master, red = attention/
  locked, green = synced, amber = pending upstream). Meta rows use tiny avatars +
  muted `--fs-xs` labels.
- **Lines & texture**: hairline 1px dividers everywhere instead of heavy borders;
  the editor's out-of-page / margin areas get a subtle **diagonal-hatch texture**
  (repeating-linear-gradient, theme-aware, very low contrast). The editor's
  current-state indicators (lock line, live cursor of the editing user, "now" markers)
  are thin `--primary` red lines with a small red chip label.
- **Typography**: compact and crisp — 13–14px body, 12px meta, 16/20px headings,
  weight 500–600 for titles, generous letter spacing nowhere; muted secondary text.
  System font stack (`"Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial`).
- Whitespace over chrome: prefer spacing and hairlines to boxes-in-boxes.

**Tokens** — spacing `--space-1..8` (4/8/12/16/24/32/48/64), radius
`--radius-sm 6px / --radius 10px / --radius-lg 18px`, shadows
`--shadow-sm/--shadow/--shadow-lg`, `--ring` focus style, motion
`--dur-fast 120ms / --dur 200ms / --ease cubic-bezier(0.4,0,0.2,1)`.
Semantic colors swapped by `[data-theme]`; persist theme, default to
`prefers-color-scheme`. Brand constants: `--rmit-red: #E61E2A`,
`--rmit-navy: #000054` — **all accent colors derive from these** (red = primary
actions, destructive-adjacent, live/now indicators; navy = secondary accent, active
nav, master-document identity). Reusable `.btn/.btn-primary/.btn-ghost`, `.card`,
`.input/.field`, `.pill`, `.segmented`.

**Light theme (default)** — tinted canvas + white floating surfaces:
`--bg: #dcdbe6` (muted lavender-gray canvas), `--surface: #ffffff`,
`--surface-2: #f2f2f7`, `--border: #e4e4ec`, `--border-strong: #c9cdd6`,
`--text: #16181d`, `--text-muted: #5b6472`, `--primary: var(--rmit-red)`,
`--primary-hover: #c8121d`, `--accent: var(--rmit-navy)`, `--accent-hover: #0a0a78`,
`--danger: #d92d20`, `--success: #15803d`, `--warning: #b45309`,
`--ring: 0 0 0 3px rgba(230,30,42,.35)`, text-on-primary/accent white.

**Dark theme** — navy-tinted, use EXACTLY these values (surfaces derive toward RMIT
navy, not neutral gray):
`--bg: #06061a`, `--surface: #0f1030`, `--surface-2: #181a3d`, `--border: #2a2d5a`,
`--border-strong: #3c4076`, `--text: #eef0fb`, `--text-muted: #9aa3c8`,
`--primary: #ff4d57`, `--primary-hover: #ff6b73`, `--accent: #9296f2`,
`--accent-hover: #a8abf7`, `--danger: #f97066`, `--success: #4ade80`,
`--warning: #fbbf24`, `--ring: 0 0 0 3px rgba(255,77,87,.4)`,
shadows: `0 1px 2px rgba(0,0,16,.5)` / `0 4px 14px rgba(0,0,20,.55)` /
`0 18px 48px rgba(0,0,24,.7)`, text-on-primary/accent white. In dark mode the
floating-panel canvas contrast still reads (bg darker than surface).

**App shell**: left icon rail + sticky top bar as above (brand mark "RMIT Dispatch",
space switcher, theme toggle, user + role pill, sign out). The Workspace (editor) is
full-screen within the shell with side panels (pages rail left, inspector right) —
Figma-like, but styled with the same soft floating-panel language.

## Data model (src/types.ts + supabase/schema.sql)
- `Role`, `AppUser { uid, email, displayName }`, `Space`, `SpaceMember`.
- `PageSize 'A4'|'A5'|'Letter'|'Social-Square'|'Social-Story'`, `Orientation`.
- `GridConfig { pageSize, orientation, columns, rows, marginMm, gutterMm, spineMm }`.
- `GridPos { col, row, w, h }` (integers, in grid cells).
- Rich text: block bodies are a minimal structured rich-text model (array of paragraphs;
  paragraph = array of inline nodes; inline node = `{ text, bold?, italic?, color? }` or
  a **field span** `{ fieldId, children: InlineNode[] }`). This structure is REQUIRED —
  sync fields anchor to it (never to character offsets).
- `Block` union (all have `id, type, pos: GridPos, binding?: BlockBinding`):
  - `TextBlock { heading?, body: RichText, size?: 'sm'|'md'|'lg'|'xl',
    align?: 'left'|'center'|'right', bold?, color? }`
  - `TableBlock { headerRow: boolean, rows: RichText[][] }` (cells bindable)
  - `ImageBlock { storagePath?, fit?: 'cover'|'contain', alt?, caption? }`
- `Page { id, index, kind: 'single'|'spread', blocks: Block[] }`.
- `Project { id, spaceId, title, type, createdBy, createdAt }` — a project contains one
  master document and its adaptations.
- `Document { id, projectId, kind: 'master'|'adaptation', parentId? (master id), title,
  grid: GridConfig, status, currentVersionId?, versionCount,
  lock: { uid, displayName, at } | null }`.
- `Draft { documentId, pages: Page[], updatedAt, updatedBy }` (jsonb).
- `Version { id, documentId, number, label?, createdBy, createdAt,
  snapshot: { pages } }` (immutable full snapshots).
- `SyncField { id, projectId, name, value: RichText | scalar, updatedAt, updatedBy }`.
- Bindings (see Sync fields): `BlockBinding { fieldId?, sourceBlockId, direction }` on a
  block; field spans inside rich text; `SyncDirection = 'down' | 'up' | 'two-way'`
  (down = master → this doc; up = this doc → master).
- Tables: `spaces, space_members, projects, documents, drafts, versions, sync_fields,
  comments`. Sensible indexes; `updated_at` triggers.

## Pages & flows
- **Login/Signup** → **Projects** (per space) → **Project view** → **Workspace**
  (the editor) → **Space settings** (members/roles).
- **Projects list**: card grid, each card shows a to-scale GridPreview of the master.
  "+ New project" panel: title, type, page size, orientation, grid granularity presets —
  Simple 6×8, **Editorial 12×16 (default, recommended)**, Fine 16×24, custom — with live
  spread preview. Defaults: A4 portrait, 15mm margin, 4mm gutter, 10mm spine. A spread =
  2 pages wide (effectiveColumns = columns×2) with a center spine.
- **Project view**: the master at top, adaptations listed beneath it as a tree/rail
  ("+ New adaptation"). Each row: thumbnail, title, format, lock/edit status, sync
  health (n fields synced / n diverged). Opening any row → Workspace on that document.

## THE EDITOR (core — build it exactly this way; this is where bugs lived before)
1) **Local-authoritative state core** (EditorProvider + useReducer): it owns pages while
   editing. Every edit (add/move/resize/update/delete/reorder/duplicate/nudge,
   add/delete/toggle page) is a synchronous reducer action — instant, no async in the
   interaction path. Selection = array of block ids (MULTI-SELECT from the start).
   Persistence: a **debounced (~600ms) save** of the draft to Supabase, `flush()` before
   finalize/stop-editing and on unmount. The realtime layer (below) feeds remote changes
   back in through the same reducer.
2) **Absolute-% positioning (NOT CSS grid for placement):** the page is a fixed-aspect
   surface sized in px by the parent. Blocks are absolutely positioned: left =
   col/cols*100%, top = row/rows*100%, width = w/cols*100%, height = h/rows*100%;
   cols = effectiveColumns(grid, page.kind), rows = grid.rows. Grid lines are a
   background-image overlay (edit mode only) plus a dashed margin guide and a center
   spine for spreads. Do NOT use CSS grid tracks (implicit-track ballooning).
3) **Sizing & zoom:** robust `useSize` hook (useLayoutEffect + ResizeObserver; measure
   clientWidth/Height; ignore 0×0 deliveries) on the scrollable stage.
   fitWidth = clamp(min(stageW - pad, (stageH - pad) * aspect)) where aspect =
   canvasAspect(grid, kind). Surface width = fitWidth * zoom — drive zoom through the
   rendered WIDTH, never a CSS transform (transforms clip the top-left when zoomed).
   Stage: overflow:auto, scrollbar-gutter: stable, `safe center` alignment (so a
   zoomed-in page stays reachable). Zoom controls + reset.
4) **Gesture engine (useDragResize):** pointer-based move + resize using POINTER
   CAPTURE. Convert pointer delta → cell delta from the LIVE measured surface rect
   (rect.width/cols, rect.height/rows) so it's automatically zoom-correct. SNAP to whole
   cells; only dispatch a position update when the cell delta CHANGES (natural
   throttling — no per-pixel re-render). Move operates on the WHOLE selection (capture
   each selected block's start pos at gesture start; apply the same delta; clamp each
   within page bounds); resize = single block via a corner handle. Selecting happens on
   pointerdown; shift-click toggles multi-select; a drag crossing no cell boundary = a
   click. Keep in-flight gesture data in refs; commit through the reducer.
5) **Block placement helper:** createBlock picks a sensible default size and the first
   non-overlapping slot, clamped strictly within the page (never below the last row).
6) **Right-hand inspector (tabs: Properties | Sync | Versions | Comments):**
   - Properties: text (heading, body via a small rich-text editor with bold/italic/color
     on selections, size S/M/L/XL, align), table (edit cells, insert/delete row/col,
     header toggle), image (upload to Storage, fit, alt, caption); X/Y/W/H number
     fields; bring to front / send to back. Multi-select → "N selected" +
     Duplicate/Delete.
   - Pages rail on the left: add page/spread, delete, single↔spread toggle (clamp blocks
     when columns change).
   - Keyboard: Delete/Backspace deletes selection, Esc clears, Ctrl/Cmd+D duplicates
     (all ignored when focus is in an input/editor), arrow-key nudge.

## SYNC FIELDS (the headline feature — get this right)
Purpose: content shared between master and adaptations must stay **identical**, at any
granularity the user chooses — a whole block, a table cell, a sentence, a word, a number
(e.g. a year) — including **fields nested inside bigger fields**.

Model:
- A `SyncField` is a first-class project-level entity owning the canonical **value**
  (a rich-text fragment or scalar). Documents never copy-paste synced text; they **embed
  references**: inline **field spans** in rich text (`{ fieldId, children }`, children
  mirror the field value locally for render), **cell bindings** in tables, and **block
  bindings** for whole blocks. Anchoring is structural (the node carries the fieldId) —
  never character offsets, so surrounding edits can't break a field.
- Nesting: a field's value is itself rich text and may contain field spans of other
  fields (e.g. field "intro-paragraph" contains field "year"). Propagation resolves
  inner fields first; guard against cycles (reject any binding that would create one).
- **Direction is per-embed** (per document instance), `down | up | two-way`:
  - `down`: this instance follows the field; its content is read-only in place (subtle
    tint + direction glyph; attempting to type prompts to unlink or narrow).
  - `up`: local edits rewrite the field value **on save** (see timing).
  - `two-way`: both of the above.
- **Propagation timing (fixed policy):** field-value changes flow **downstream
  instantly** (realtime, keystroke-ish granularity via debounce) to every open document.
  **Upstream** (`up`/two-way local edits) apply to the field **when the editor saves /
  stops editing / finalizes**, with a visible "pending upstream change" pill until then.
  Conflicts: last-write-wins per field; record `updatedAt/updatedBy`.
- Creation UX: in the master, select text → toolbar "Make sync field" (auto-named from
  content, renamable); or bind a whole block / table cell from the inspector. The Sync
  tab lists all project fields with value preview, where-used (which documents embed it,
  with direction), and jump-to-usage. In an adaptation, users can: switch an embed's
  direction, **unlink** (detach: keeps a plain copy, stops syncing), or **narrow** —
  unlink the big embed and re-bind smaller selections inside it (this is how "mostly the
  same with slight variations" is handled).
- Rendering: synced spans get a subtle dotted underline/tint (theme-aware) in edit mode
  only; clicking one selects the embed and opens its Sync inspector (field name,
  direction switcher, unlink, go-to-master).

## ADAPTATIONS
- "New adaptation" on a project: name + target format (page size/orientation/grid —
  prefilled from the master, changeable, since a flyer ≠ an A4 guide). It deep-clones
  the master's pages, and **every cloned block gets a block binding with direction
  `down`** to its master source — so a fresh adaptation is exactly the master and
  follows it live by default.
- From there the adaptation team diverges: unlink blocks they'll rewrite, delete blocks
  that don't fit the format, truncate freely inside unlinked content, narrow bindings to
  keep just the sentences/numbers that must stay identical, or flip specific embeds to
  `up`/`two-way` where the adaptation team owns the wording.
- Adaptations live under their master in the project view; deleting a master asks for
  confirmation and unlinks all adaptations (they keep plain copies).

## Realtime & locking
- **Locks**: per-document. Edit → take `documents.lock` (RLS rejects draft writes by
  non-holders); others see "Locked by X" and a read-only live view. Stop editing
  releases; stale locks (no heartbeat > 2 min) can be taken over. Use Supabase Realtime
  **Presence** on a per-document channel for heartbeat + who's-here avatars.
- **Live content**: subscribe via `postgres_changes` on `drafts` (per open document) and
  on `sync_fields` (per project) so viewers see saved changes; ALSO use a **Broadcast**
  channel per document where the lock holder streams debounced (~250ms) draft patches so
  viewers track typing between saves. Broadcast = fast path, Postgres = source of truth;
  reconcile by `updatedAt`.
- Downstream field propagation: an open adaptation applies incoming `sync_fields`
  changes to its rendered embeds immediately (reducer action) — even while its own
  editor holds the lock (their unrelated edits are untouched; a followed field simply
  re-renders).

## Versioning (lock → finalize → restore)
- **Finalize** flushes the draft, applies pending upstream field changes, writes an
  immutable full-snapshot Version (number, label?, author, timestamp), bumps
  versionCount/currentVersionId, and releases the lock. **Stop editing** releases the
  lock without a version (pending upstream changes still apply — that's a save).
- Versions panel: newest first, mark current, **Restore** copies a snapshot into the
  working draft (bindings restore too; embeds re-resolve against current field values).

## Comments
- Per-document comment threads (anchored to the document or a specific block id),
  realtime, resolvable. All roles can comment; designer is otherwise read-only.

## File layout (suggested)
`src/types.ts`; `src/grid/presets.ts` (+ pageDimsMm/pageAspect/canvasAspect/
effectiveColumns); `src/lib/{supabase.ts, theme.tsx, ids.ts, useSize.ts, blocks.ts,
richtext.ts, syncfields.ts}`; `src/store/{auth.tsx, spaces.ts, projects.ts,
documents.ts, drafts.ts, versions.ts, fields.ts, comments.ts, realtime.ts}`;
`src/editor/{EditorProvider.tsx, PageSurface.tsx, BlockFrame.tsx, useDragResize.ts,
EditorCanvas.tsx, canvas.css}`; `src/components/{AppShell, SpaceSwitcher,
NewProjectPanel, NewAdaptationPanel, GridPreview, ThemeToggle, RoleBadge,
editor/{BlockView, BlockInspector, SyncPanel, FieldSpanMenu, PageRail, VersionPanel,
CommentThread}}`; `src/pages/{Login, Projects, ProjectView, Workspace, SpaceSettings,
NotFound}`; `supabase/schema.sql`.

## Acceptance criteria (verify in the browser; use two browser profiles for realtime)
1. Sign up, create a space, manage members with roles; RLS blocks non-members.
2. Create a project; the master appears with the chosen grid; add text/table/image
   blocks; an image uploads to Supabase Storage and renders.
3. Editor: drag/resize snaps to cells, accurate and smooth at 50–200% zoom, multi-select
   moves together, nothing ever leaves the page, the canvas never balloons.
4. Select a sentence in the master → make it a sync field; create an adaptation → it
   clones the master with all-down bindings and follows master edits **live** in a
   second browser.
5. In the adaptation: unlink a block and edit it freely; narrow: re-bind one inner
   number (e.g. "2026") as a nested field — changing it in the master updates the
   adaptation instantly; flip an embed to two-way, edit it in the adaptation, save →
   the master updates (and a third open sibling adaptation updates too).
6. Locking: a second user sees "Locked by X" plus live read-only typing via broadcast;
   lock release and stale-lock takeover work.
7. Finalize creates a version; Restore round-trips, including bindings.
8. Comments appear in realtime for a second user.
9. Light/dark themes work throughout; everything survives reload; `npm run build` clean.

Build incrementally and verify each part in the browser before moving on. Suggested
order: design system → Supabase schema/auth/spaces → projects + editor (against the
store seam) → realtime + locks → sync fields → adaptations → versions → comments.
