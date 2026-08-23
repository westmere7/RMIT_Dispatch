# RMIT Dispatch — knowledgebase

Working notes for picking this project back up: what exists, why it is built
that way, and the traps that already cost time. Read alongside `README.md`
(which is the user-facing description).

---

## 1. What the app is

A multi-user realtime **single source of truth for marketing copy**. A content
team writes a **master document**; other teams derive **adaptations** (flyer,
banner, guide page). Shared content stays identical through **sync fields** —
project- or space-level values embedded *by reference*, at any granularity
(whole block, table cell, sentence, single word), nestable, each embed carrying
its own direction (`down` / `up` / `two-way`).

Stack: React 18 + Vite + TypeScript, plain CSS with design tokens (no Tailwind,
no UI library), Supabase for everything (Auth, Postgres, Realtime, Storage),
free tier, **no server code — all enforcement is RLS**.

## 2. Setup

1. Supabase project → SQL editor → run `supabase/schema.sql`.
2. Then run, in order, everything in `supabase/migrations/`:
   - `002_field_scope_and_folders.sql` — field scope + folders
   - `003_settings_and_undo.sql` — account settings + cloud undo
   - `004_project_folders_and_flags.sql` — project folders + colour flags
3. Auth → Providers → Email → turn **off** "Confirm email" for local testing.
4. `.env.local` with `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
5. `server.bat`, or `npm run dev -- --port 5174 --host`.

**Test account:** `admin` / `admin` maps to `admin@rmit-dispatch.local` and is
auto-provisioned on first sign-in. Behaves like any other account.

**Two-user testing:** open `localhost:5174` *and* `127.0.0.1:5174` — different
origins get separate sessions, so you can drive two users side by side.

## 3. Architecture map

```
src/
  types.ts              all domain types — start here
  grid/presets.ts       page sizes, square-cell grid maths
  lib/
    richtext.ts         structured rich-text model + range ops
    richdom.ts          model <-> contentEditable DOM bridge (shared)
    syncfields.ts       the sync engine (resolve, apply down, collect up)
    fieldtypes.ts       field-shape <-> target compatibility rules
    fieldtree.ts        folder tree derived from '/' paths
    doctree.ts          master -> adaptation lineage + connector geometry
    blocks.ts           block geometry, creation, rescaling
    imagecompress.ts    client-side WebP compression
    useSize.ts          ResizeObserver hook (ignores 0x0)
  editor/
    EditorProvider.tsx  reducer: pages, selection, undo/redo
    EditorCanvas.tsx    stage, zoom dock, format bar, context menu host
    PageSurface.tsx     fixed-aspect page, %-positioned blocks
    BlockFrame.tsx      one block + inline text editing + resize handles
    useDragResize.ts    pointer-capture move/resize, cell snapping
    useZoomPan.ts       zoom about cursor, pan (middle / space / wheel)
    useFieldOps.ts      ALL sync-field mutations funnel through here
    CanvasContextMenu.tsx
    workspaceContext.tsx  extracted to avoid a circular import
  store/                thin repository seam — UI never touches supabase-js
  pages/                Login, Projects, ProjectView, Workspace,
                        GlobalFields, Settings, SpaceSettings
```

**Rule:** the UI never imports `supabase` directly; everything goes through
`src/store/*`. Keep it that way.

## 4. Decisions that are load-bearing

### Editor
- **Local-authoritative reducer.** Every edit is a synchronous reducer action;
  persistence is a debounced draft save. Never put async in the interaction path.
- **Absolute-% positioning, not CSS grid.** Blocks are `left/top/width/height`
  percentages of the surface. CSS grid tracks caused implicit-track ballooning.
- **Zoom drives the rendered WIDTH, never a CSS transform.** Transforms clipped
  the top-left when magnified.
- **Gesture maths reads the LIVE surface rect** (`rect.width / cols`), which is
  why drag/resize is automatically zoom-correct.

### Grid
- **Cells are always square.** You choose columns; rows are *derived* from the
  page proportions (`deriveRows`), and `canvasAspect` comes from the cell
  lattice (`effectiveColumns / rows`) so cells are exactly 1:1.
- Consequence: the spine adds no width to a spread (it is a guide line only),
  otherwise spread cells could not be square.
- **Grids may only be refined, never coarsened**, per document. Coarsening
  throws away layout precision the blocks depend on. Refining rescales blocks.

### Properties live in a bar, not a panel
- **`editor/PropertiesBar.tsx`** is the single contextual bar above the canvas.
  It replaced both the old text format bar and the right-hand Properties tab,
  so the controls sit next to what they act on. The side panel is now Sync /
  Versions / Comments only (`InspectorTab` no longer has `'properties'`).
- What it shows: page summary with nothing selected · `N selected` with
  Front/Duplicate/Delete for a multi-selection · for one block, its kind, its
  sync state (make field / use existing / unlink / jump to Sync), the
  type-specific controls, then z-order, duplicate and delete.
- **Long-form editors live in popovers** anchored to a bar button — table
  cells, image upload/alt/caption, shape styling — so nothing was lost in the
  move but the bar stays one row. The sections themselves were moved intact
  into `components/editor/BlockProps.tsx` and are shared.
- While text is being edited on the canvas the bar follows the *edited* block,
  not the selection, so formatting never retargets mid-edit.
- **In view-only mode the bar is not rendered at all.** Nothing in it works
  without the lock, so hiding it beats dimming it: no dead controls to explain,
  no way to open the popovers, and the canvas gets the row back.

### Text formatting
- **Character-level, word-processor rules.** Marks apply to the selected
  characters; with no selection they apply to the whole block. `bold`,
  `italic`, `color` and `size` are all runs marks (`MarkPatch`).
- **Seven sizes, XXS…XXL** (`0.5 / 0.65 / 0.8 / 1 / 1.35 / 1.8 / 2.4` em).
  The stored keys deliberately do NOT match their labels — `sm`/`md`/`lg`
  predate the wider scale and show as S/M/L — because renaming them would have
  meant migrating every block and every run mark in every document for nothing.
  `SIZE_LABEL` does the translation; never hand-write a label from the key.
- **Per-run size is absolute, not relative.** A run marked L renders at
  `SIZE_EM[run] / SIZE_EM[block]` ems, so it looks the same whatever the
  block's own size is. `SIZE_EM` in `lib/textsize.ts` mirrors the
  `.block-content.size-*` CSS — keep the two in step.
- **Marks on a FieldSpan live on the span, not its children.** The children
  are rewritten from the field value on every sync, so a mark on them cannot
  survive; a mark on the span can. This is also what makes a field inserted
  mid-sentence inherit the surrounding style (`insertFieldAt` merges the marks
  at the insertion point, `wrapField` hoists the selection's shared marks).
  Consequence: selecting *part* of a synced span and formatting it styles the
  whole embed — the smallest unit that is durable.
- **The selection survives a formatting change.** Marking re-renders the
  editor's HTML, which drops the DOM selection — so every mark used to need
  the words re-selected. `restoreSelectionSoon` puts it back by *offset*
  (marking never changes the text), verifying and retrying for a few frames
  because the re-render happens in a React effect, not synchronously.
- **Formatting follows the live selection wherever it is.** `rangeFromSelection`
  is a pure function of the DOM selection plus a root, so the properties panel
  resolves its range against the on-canvas editor for the same block
  (`liveRangeFor`). Without that, panel buttons silently formatted the whole
  block while the user had text selected on the canvas.
- **Text blocks have no separate heading.** A heading is text the author made
  bigger or bolder. Legacy `heading` strings are folded into the body as a
  bold, one-step-larger first paragraph by `foldHeadings`, applied where drafts
  and version snapshots are read.
- **Overflow marker**: `.block-content` clips, so `scrollHeight > clientHeight`
  means the copy does not fit; a small red `+` sits in the frame's bottom-right,
  the way Illustrator marks an overflowing text frame.

### Sync fields
- Field values are **plain content** — `stripMarks` runs inside
  `store/fields.ts` on create and update, so no field can ever store
  bold/italic/colour. Styling belongs to the embedding block.
- Anchoring is **structural**: a `FieldSpan` node carries the `fieldId`. Never
  character offsets, so surrounding edits cannot break an embed.
- **Scope:** `local` (one project) or `global` (whole space). `space_id` is set
  on both, which is why RLS and the realtime filter need only that one column.
- **Folders** are a `/`-separated path string; the tree is *derived*
  (`fieldtree.ts`), so there is no second structure to keep in sync.
- **Shapes are never synced** — `blockTarget()` returns null for them and
  `cloneForAdaptation` skips their binding.
- Compatibility is one table in `fieldtypes.ts`:

  | shape | inline / cell | text block | table block | image block |
  |---|---|---|---|---|
  | value, text | yes | yes | no | no |
  | multi-paragraph | no | yes | no | no |
  | table | no | no | yes | no |
  | image | no | no | no | yes |
  | combination | no | no | no | no |

- Incompatible fields stay **visible but disabled with a reason** — hiding them
  made the rule feel like a bug.
- **A whole block can become a field with no text selection**: the block's own
  content is the value and the field takes the block's shape (text → text,
  table → table, image → image). Entry points: the sync panel's card for a
  single unbound block, and the canvas context menu. Both funnel through
  `createFieldFromBlock` in `useFieldOps`. Multi-selection is refused on
  purpose — one block at a time.
- The panel list shows **name, shape, usage count** and one overflow button;
  the value, usages and actions all live behind a click. Rows for the fields
  the selection touches (the caret's span, the selected block's binding, and
  anything embedded inside it) are **highlighted**, and a collapsed folder
  marks that something inside it is selected.
- Usage counts come from the **live pages** for the open document plus a fetch
  for the project's other documents — counting from the fetch alone went stale
  the moment anything was edited.

### Data tables
- The sync-field table is **one grid shared by the header and every row**
  (`subgrid`), which is what keeps nested folder rows aligned — verified by
  measuring identical cell x-positions on every row type.
- Tables get a `max-width` (~1320px, matching the lineage measure) rather than
  stretching to an ultra-wide window. Five short columns spread across 2000px
  opens a void between the value and the right-hand meta columns; `fr` tracks
  cannot be capped, so the container is what stops the growth.
- Column widths must fit their longest *label*, not just their values —
  `COMBINATION` overflowed a 64px Type column into the value cell.

### Lineage
- `documents.parent_id` points at whatever a doc derives from, so a chain works:
  master → adaptation → sub-adaptation, capped at `MAX_ADAPTATION_DEPTH = 2`.
- Deleting or detaching a parent **strips the children's bindings** so they keep
  plain copies rather than dangling references.

### Media
- Everything is compressed to **WebP** client-side (`imagecompress.ts`), five
  quality levels, default `medium-high`. A 2.2 MB PNG → ~65 kB.
- **Deletion is reference-checked** (`store/mediagc.ts`). Cloned and unlinked
  documents share storage paths, so a file is only removed once *nothing* in the
  project references it. Never delete a path just because one block lost it.

### Undo
- Cloud-persisted per (document, user) in `undo_entries`, one row per step.
- **Steps are coalesced.** Each action may carry a `coalesce` key; while the key
  is unchanged the edits fold into one step. Drags/resizes use a per-gesture key
  and dispatch `END_COALESCE` on pointerup; typing uses `text:<blockId>`.
  Without this a 14-cell drag produced 14 undo steps.

### Projects board
- Cards are one fixed shape: a **fixed 104px thumbnail frame** plus a body with
  a `min-height`, so every card in the grid is exactly the same size whatever
  the master's page aspect or how many pills it carries.
- **Folders** are the same derived-path trick as sync fields: a `/`-separated
  string on `projects.folder`, tree built at render time. Root projects render
  under an "Ungrouped" group.
- Drag-and-drop is plain HTML5 DnD; the drop target is the whole folder
  section, and the drop ring is an `inset` box-shadow so hovering never
  reflows the board.
- **Flags** are a fixed six-colour palette in `src/lib/flags.ts` (kept out of
  the page module: exporting non-components from a page file breaks React Fast
  Refresh). The colour paints a 3px strip on the card's top edge, a dot beside
  the title, and doubles as a filter chip row in the header.

### Settings
- Per account in `user_settings.settings` (jsonb), mirrored to localStorage so
  first paint never waits on the network.
- **Two copies: `saved` and `draft`.** The app runs on the draft, so appearance
  changes preview immediately, while Save/Discard still mean something. One-click
  controls that have no Save button of their own (the top-bar theme toggle) call
  `save({...})` with an override, which commits without going through the draft.
- **Interface scale scales the tokens**, not a CSS `zoom`: `--fs-*` and
  `--space-*` are `calc(Npx * var(--ui-scale))`, plus the shell's structural
  sizes. `zoom` would have put `getBoundingClientRect` (visual px) and
  `scrollLeft` (layout px) into different units and broken the editor's
  zoom-anchoring maths. A root `font-size` alone did nothing, because every
  token is an absolute px value.
- **Layout is desktop two-pane**: a section rail on the left, one pane at a
  time on the right. This is a desktop app — pages fill the window rather than
  sitting in a narrow phone-width column, and only genuine reading columns
  (the lineage tree) keep a `max-width`.
- Each group of rows is **one grid** (`name | explanation | control`) with the
  rows using `grid-template-columns: subgrid`, so every control shares one
  right edge no matter how long the labels are. Below 1180px it collapses to
  two columns with the explanation under the name.
- `src/components/Controls.tsx` holds the themed `Toggle` and `NumberField`.
  Native checkboxes and number spinners are drawn by the OS: wrong accent
  colour, tiny hit targets. Inline checkbox-with-label cases keep the native
  control but pick up `accent-color: var(--primary)` globally.
- Provider order in `main.tsx` matters: **Auth → Settings → Theme** (settings are
  per account; the theme is one of those settings).

## 5. Traps already hit (do not re-learn these)

1. **Portalled submenus.** Submenus must be portalled to `document.body` or the
   root panel's `overflow-y: auto` clips them (it showed a horizontal
   scrollbar instead). The outside-click handler must then test
   `closest('[data-ctx-portal]')`, not DOM containment.
2. **One submenu at a time.** The open submenu is a single piece of state on the
   parent `Panel`. When each row owned its own close timer, sweeping the pointer
   across rows left overlapping panels.
3. **Zoom anchoring: never run a synchronous alignment pass.** In the same
   commit the surface can still report its OLD width, giving a ~0 correction
   that looks converged — which then discards the anchor. Correct on
   `requestAnimationFrame`, and keep correcting for a few frames because a
   scrollbar appearing changes the stage's client size and hence the fitted
   width. Only anchor an axis that actually overflows; when the page fits there
   is no scroll freedom and re-centring is the correct result.
4. **StrictMode double-invokes effects** (run → cleanup → run). Anything
   consumed in an effect body (like the zoom anchor) must survive until it has
   actually been applied, and a follow-up rAF must not be cancelled by cleanup.
5. **Tree row alignment.** Indentation must live *inside the first cell*, never
   as padding on the row — padding shifts every column and breaks alignment of
   nested rows. The manager list uses one CSS grid (subgrid) shared by the
   header and all rows.
6. **RLS recursion.** Policies on `space_members` must go through
   `SECURITY DEFINER` helpers (`is_space_member`, `can_edit_space`).
7. **`useSize` must ignore 0×0** ResizeObserver deliveries or dependent layouts
   collapse.
8. **`preventDefault` must come before the `e.repeat` guard.** The space-hold
   pan mode bailed out on auto-repeat keydowns *before* cancelling them, so a
   HELD space scrolled the page even though the first press was swallowed.
9. **Submenus need hover *intent* before switching.** The pointer normally
   reaches a submenu by cutting diagonally across the rows *below* its own row.
   Opening the hovered row's submenu instantly therefore unmounts the panel the
   pointer is travelling to. The switch is delayed by `SWITCH_DELAY_MS` (220ms);
   because only one submenu is ever open, the delay cannot bring back the old
   overlapping-panels bug.
10. **PostgREST has its own missing-column error.** A write to a column the
   database does not have yet is rejected by PostgREST *before* Postgres sees
   it — code `PGRST204`, message "Could not find the 'x' column ... in the
   schema cache", not Postgres's `42703` / "does not exist". `isMissingColumn`
   matches both, otherwise a behind-the-app database fails silently.
11. **Testing with synthetic events lies.** React's `onMouseEnter` derives from
   `mouseover` with `relatedTarget`; synthetic dispatches do not reproduce
   enter/leave semantics. Use real pointer moves (`computer` hover/drag) for
   hover and drag behaviour. Also: reading the DOM in the *same* JS call that
   dispatched an event sees pre-render state — split into two calls.

## 6. Data model (Supabase)

`profiles, spaces, space_members, projects, documents, drafts, versions,
sync_fields, comments, user_settings, undo_entries` + the `media` storage bucket.

- `documents.lock_uid/lock_name/lock_at` are flat columns (not jsonb) so RLS can
  check lock ownership and stale-lock takeover (>2 min) server-side.
- `sync_fields`: `scope` + `folder` + `space_id`, with a check constraint tying
  `scope='global'` to `project_id is null`.
- Realtime: `drafts`, `sync_fields`, `comments`, `documents` are in the
  publication with `replica identity full`.

## 7. Verification habits that worked

- `npm run build` (tsc + vite) after every change — it is the fastest linter.
- Verify in the browser pane, and prefer **measuring** over eyeballing:
  compare computed geometry (`getBoundingClientRect`) across rows to prove
  alignment, or check `HTTP 200 → 400` on a storage URL to prove a file was
  really deleted.
- For realtime, drive two origins side by side.

## 8. Known gaps / next steps

- Pan is scroll-based, so a page smaller than the stage cannot be offset freely
  (it re-centres). A transform/offset model would allow free positioning at any
  zoom.
- Redo history is in-memory for the session; the *undo* history is what is
  cloud-persisted.
- `confirmDeletes`, `showGridLines` and `nudgeCells` settings are stored and
  surfaced but not yet consumed everywhere in the editor.
- Combination (`group`) fields are editable in isolation but deliberately not
  embeddable — the compatibility table refuses them everywhere.
