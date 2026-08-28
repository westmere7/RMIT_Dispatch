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
    dispatch.ts         who a dispatch reaches, and whether it can land
    tables.ts           table geometry, the style cascade, merges
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
                        (store/dispatch.ts runs a dispatch: resolve, then write)
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
- **Everything on the page sizes in `em`, off the surface's font-size.**
  `PageSurface` sets `fontSize: widthPx / 46`, so one em tracks the rendered
  width and all content scales with zoom for free. An absolute `font-size`
  anywhere under it silently opts that content out — which is what pinned
  TABLE blocks at one size at every zoom level: `.block-content` set
  `var(--fs-sm)`, invisible for text because every `size-*` class overrides
  it, but a table container carries no size class. Cell padding is `em` for
  the same reason. Borders and shape strokes stay absolute on purpose (a
  hairline has to survive zooming out — see `non-scaling-stroke`).

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
- **Embeds are ATOMIC while editing.** In a text block every field span
  renders `contenteditable="false"`, so the caret goes *around* it: typing
  beside an embed can never leak into it and two neighbouring embeds cannot
  merge. Editing an embed's own text is a deliberate second step —
  double-click it (`useSpanEntry`), which makes that one span editable, rings
  it on the canvas and names it in the properties bar. Formatting needs none
  of this: marks apply to a whole embed while it is atomic.
  - `down` embeds refuse entry (their text mirrors the field); the tooltip
    says to edit the field instead.
  - **Escape is two-step**: it leaves the embed first, then the block. Both
    listeners capture on `window`, where `stopPropagation` cannot hold off a
    sibling, so the canvas handler checks for `.field-span.is-entered` in the
    DOM instead of relying on listener order.
  - Replacing an embed's *entire* text used to delete the embed: the browser
    drops the emptied wrapper. A `beforeinput` guard performs that edit on a
    text node we keep, so the field survives.
  - **Field edit mode ISOLATES the field.** While one is open, a `beforeinput`
    listener on the root (capturing) refuses any edit whose *target range*
    reaches outside that span. The block around it stays a live
    contentEditable on purpose — make the root `contenteditable=false` and a
    click on the text beside the field can no longer place a caret, so leaving
    takes two clicks — which is why the confinement is per edit rather than
    per element. Without it, Backspace at the embed's first character ate the
    word in front of it, Enter split the block from inside a field, and
    Ctrl+A + type replaced the lot. The span is looked up **per event**, never
    captured: the editor rewrites its own innerHTML when the body changes
    underneath, and a captured span would be detached, refusing everything.
- **Inserted fields are separated by a space** (`insertFieldAt`). Words must
  not run together, and because embeds are atomic there must be something
  either side of one for the caret to land on — back-to-back embeds, or one at
  the very end of a paragraph, are otherwise unreachable.
- **Caret anchors make every gap beside an embed reachable.** A space only
  helps where a field was *inserted*; a field that fills a whole line (or two
  fields side by side) still had no text node to stand in, and the browser
  will not put a caret against a `contenteditable="false"` element without
  one — so you could not type before or after it at all. `renderNodes` emits
  `<span data-anchor="1">` holding one zero-width space into exactly those
  gaps: before an embed that starts a paragraph or follows another embed,
  after one that ends a paragraph or precedes another.
  - **The anchor alone is not enough — the click has to be placed by hand.**
    An atomic embed is `contenteditable="false"` with `user-select: all`, so
    a click on it selects the whole embed instead of landing a caret, and a
    click in the blank space beside it gets snapped to the nearest VISIBLE
    position, straight past a zero-width anchor. `useSpanEntry`'s
    `onMouseDown` sets the selection itself (`caretBesideSpan`) for a click
    on an embed's outer edge, or in the margin at the start/end of a line;
    the middle of an embed still selects it, which is how one embed gets
    formatted. The anchor also carries `width: 1px` so its position is real
    layout rather than a point the browser may collapse away.
  - **The model never sees them.** `parseInline` strips `​` (but keeps
    anything typed *into* an anchor — that is real content), and every offset
    in `richdom.ts` goes through `modelLength` / `modelOffsetFor` /
    `domOffsetFor`, so a DOM offset and a model offset never drift apart.
    `selectRange` and `caretAtEndOf` skip zero-length nodes outright, or the
    caret would land in an anchor where Backspace deletes nothing.
- **Paste is always plain text** (`insertPlainText`, both editors). Copied
  content otherwise brings the source's fonts, weights and colours, which
  override the block's own styling and cannot be seen in the properties bar.
  Only `text/plain` is read, and it goes in through `execCommand('insertText')`
  so the caret, the replaced selection and native undo behave exactly as they
  do for typing. Inside an open field — and in a compact editor, e.g. a table
  cell — line breaks fold to spaces: a field value is one run of text.
- **A caret at an embed's edge counts as OUTSIDE it** (`findEnclosingSpan`).
  Reading a boundary caret as "inside" is what made an insert meant for *after*
  a field land *within* it, which then mirrored into that field's stored value —
  the mechanism behind fields whose values contained other fields' content.
  Nesting a field inside a field now requires stepping in first.
- **Selecting the block and selecting its text are the same intent.** With
  nothing selected the field actions fall back to the block's whole text
  (`wholeTextRange`), so "Make sync field" works from the canvas menu and the
  properties bar with only the block selected — it used to sit greyed out
  beside a block action that worked, which read as a bug. The fallback is
  deliberately limited to a SINGLE-paragraph body: an embed lives inside one
  paragraph, so a multi-paragraph block has no inline equivalent and the menu
  says so instead of going dead.
- **A whole block can become a field with no text selection**: the block's own
  content is the value and the field takes the block's shape (text → text,
  table → table, image → image). Entry points: the sync panel's card for a
  single unbound block, and the canvas context menu. Both funnel through
  `createFieldFromBlock` in `useFieldOps`. Multi-selection is refused on
  purpose — one block at a time.
- **Only `down` is read-only.** A binding's direction decides two different
  things and they are NOT the same test. *Does the field overwrite this
  content?* is `direction !== 'up'` (`applySyncDown`, `refreshNodes`). *May the
  user edit this content?* is `direction === 'down'` — `up` and `two-way` are
  authored here and pushed to the field by `collectUpstream`, which collects
  everything that is not `down`. Every body-edit gate goes through
  `isContentLocked` in `syncfields.ts` (canvas double-click and Enter, the
  context menu's field actions, the properties bar's formatting controls, the
  inspector's body and table-cell editors) because they had all copied the
  overwrite test instead: promoting a block to a field in a MASTER gives it
  `two-way`, which then made the block you had just promoted uneditable in the
  document that owns its wording. The inline-embed rule (`useSpanEntry` refuses
  entry to `down` spans only) was always the correct one.
- The panel list shows **name, shape, usage count** and one overflow button;
  the value, usages and actions all live behind a click. Rows for the fields
  the selection touches (the caret's span, the selected block's binding, and
  anything embedded inside it) are **highlighted**, and a collapsed folder
  marks that something inside it is selected.
- Usage counts come from the **live pages** for the open document plus a fetch
  for the project's other documents — counting from the fetch alone went stale
  the moment anything was edited.

### Dispatch
- **The app's namesake action, and the only way content moves down.** A
  dispatch resolves each chosen adaptation against the current field values
  and its parent's content (`applySyncDown`) and writes the result to that
  adaptation's draft; realtime carries it to anyone who has it open. It
  replaced *Finalize*, which only ever wrote a version and left propagation
  to happen lazily whenever someone next opened an adaptation.
- **Two shapes, one panel** (`components/DispatchPanel.tsx`):
  - *version* — from the editor. The version is being written here, so the
    panel names it: a fixed `vN` beside an optional extra name, with the
    result previewed as the adaptations will see it. Snapshots, applies
    pending upstream, releases the lock, then dispatches.
  - *propagate* — from the project's lineage view. Nothing is being written,
    so the version is **shown, not named** — the version the adaptations end
    up following, read from `currentVersionId`.
- **Targets are tree-ordered, parents before children** (`buildDispatchTargets`).
  A sub-adaptation follows its *parent*, not the master, so the parent has to
  be resolved first for a change to reach the bottom of a chain in one pass.
  The order is a correctness requirement, not presentation — `runDispatch`
  says so, and the reverse order is covered by the logic check.
- **A draft someone else holds the lock on cannot receive one.** The
  `drafts` UPDATE policy refuses it, and PostgREST reports that as ZERO ROWS
  rather than an error — so the write has to ask for the updated rows back
  (`saveDraftIfWritable`) or a dispatch would claim to have delivered content
  that never landed. The panel greys those rows out up front, using
  `lockBlocking`, whose staleness window mirrors `doc_lock_state` in
  `schema.sql`; if the two ever disagree the panel offers writes RLS refuses.
- **Field values are re-read from the database inside the run**, never taken
  from the caller's state: a dispatch follows an upstream push, and the
  adaptations must receive what was just written.
- **Two guards, deliberately different in kind.** *Nothing selected* blocks
  the propagate button (there is no action without a target); in the editor
  it does not, because finalising with nothing to send is a legitimate
  version-only step — the button relabels itself `Create vN only` instead of
  going dead. *Nothing synced* only warns: an adaptation carrying no inbound
  embed (`inboundSyncCount` — field embeds plus parent-block bindings, `up`
  ones excluded because they never receive) cannot change, and saying so
  beats reporting "0 changed" afterwards.

### Table blocks
- **A table is shape plus text, and nothing else.** What the author controls
  is how big the rows and columns are, which cells are merged, and what each
  cell holds. There is no table-styling panel: the look comes from the
  stylesheet, and formatting comes from the cell's own text, because cells are
  edited in place like any other copy.
- **A table syncs at THREE levels, and each is reachable from the thing it
  acts on:**
  1. **the whole table** — a table field on `block.binding`; the canvas menu's
     "Make this table a sync field", or the bar's block sync.
  2. **one whole cell** — a `cellBindings` entry. One cell only: a cell field
     owns one cell's content, so a multi-cell selection says so rather than
     silently binding the anchor. Offered in the canvas menu and the table bar.
  3. **the text or the picture inside a cell** — an inline embed from a
     selection, or a `cellImages` binding for the picture.
- **Everything sync lives in ONE section of the canvas menu**, under a single
  "Sync fields" heading (`CanvasContextMenu`). It used to be scattered — the
  embed's actions at the top, "make a field" in the middle, the block binding
  below Duplicate — where they read as unrelated commands that happen to share
  a word, and "what is synced here?" had no single place to look. The section
  is composed from five contributors: `spanItems` (the embed under the
  pointer), `selectionSyncItems`, `cellItems`, `blockSyncItems`,
  `pageSyncItems`.
  - **Text formatting is NOT a sync action** and lives in its own group
    (`selectionFormatItems`) — it only happens to need the same selection.
  - **`joinSections` owns every separator.** Each contributor returns bare
    items, so no group can emit a leading or doubled rule when the one before
    it is empty.
- **Where the levels meet, the narrower claim wins.** `applySyncDown` lays the
  table field's rows down first (step 1) and the cell bindings over them
  (step 3), so a cell binding beats the table field for its own cell and
  leaves the rest of the grid following the table. The menu is ordered the
  same way — embed, then selection, then cell, then block — so the narrowest
  thing under the pointer is the first thing offered.
- **The canvas menu acts on the CELL, not just the table.** `getBodyRich` /
  `setBody` resolve to the cell the author last clicked — or, when the menu was
  opened on an existing embed, to that embed's own cell — so "make a field from
  this selection" works inside a table. Without it the menu could only offer to
  sync the whole table. The selection itself comes through `liveRangeFor`,
  since a table has one editor per cell and the text block's ref cannot answer
  for it, and the fit check uses `tableCell`: a table field cannot live in one.
- **Cells host the SAME editor a text block uses** (`InlineTableEditor` renders
  `InlineTextEditor` per cell, `bare`). Field embeds, stepping into one,
  plain-text paste and the caret anchors all come along; nothing about tables
  needed its own text handling. Double-click opens a table exactly as it opens
  a text block — including one bound to a sync field, since making a block a
  field gives it a `two-way` binding, and only `down` is read-only. That check
  runs per cell as well as for the table.
- **Entering edit mode must not move anything.** The editor renders the same
  paragraphs into the same `<td>`, so `.cell-editor` and the editable body
  carry no margin, padding or min-height of their own — the focus ring is an
  inset outline for the same reason.
- **`rows` stays RECTANGULAR.** Merging is presentation: it hides cells, never
  removes them. Content and every sync binding keep their coordinates, a
  covered cell keeps its text (so unmerging restores the table exactly), and a
  table sync field's value stays a plain grid.
- **Sizing and merges live on the BLOCK, never in the field.** A table field
  carries `headerRow` + `rows`, so two documents can share the same content
  and lay it out differently — the same rule as `stripMarks` on text values.
  `applySyncDown` spreads the field's content over the block, so the layout
  survives a sync untouched.
- **Anything keyed by row/col is tolerated out of range, never trusted.** A
  bound table has its shape replaced wholesale, so a merge or a cell image can
  outlive the cell it described; `mergeAt` clamps spans and the render skips
  what no longer exists.
- **Insert/delete/move shift EVERY coordinate the block holds** — bindings,
  cell images, merges and the size arrays — through the same pair of helpers
  in `tables.ts`. Missing one silently moves a picture onto its neighbour.
- **Tracks are percentages of the table's own box, not lengths.** The canvas
  rescales with zoom, and a divider drag is then a pure exchange between two
  neighbours: the table never grows as a side effect and the columns the
  author already settled stay put.
- **Sizing is live on the block** (`editor/TableOverlay.tsx`): drag a divider
  to resize, double-click one to even them out. The layer is `pointer-events:
  none` except for the grips, so clicking a cell still selects it and dragging
  the block still moves the block. The gesture coalesces into one undo step.
  The table's box is MEASURED rather than derived — `.block-content` pads by a
  percentage of its WIDTH on all four sides, so its top edge cannot be
  computed from the frame's height.
- **Everything else is in the bar** (`TableBar`), because a control you cannot
  see is a control that does not exist: insert above/below/left/right, delete,
  merge/unmerge, the cell's picture, and the cell's field binding. All of it
  aims at the cell last clicked, which the canvas rings so the target is never
  in doubt (`activeCell` in the workspace context — the canvas selects it, the
  bar acts on it; shift extends the range that merging uses).
- **The text controls serve a cell too.** `TextControls` takes rich text and a
  setter rather than a text block, so selecting a table and clicking a cell
  reaches the same bold, colour, size, alignment and field controls as any
  other copy — word-level embeds inside a cell included, with the field target
  switched to `tableCell`. `activeEditorRoot` finds the editor the caret is
  actually in: a table has one per cell, and taking the first would aim every
  button at R1C1.
- **A cell's size and alignment go on the CELL, not on its runs**
  (`cellFormats`). A paragraph's line box is at least as tall as the
  paragraph's OWN font-size, so runs marked small inside a normal-size
  paragraph sit in a tall line and read as though the leading had been opened
  up — "the spacing gets bigger when the text gets smaller". A text block puts
  its size on the block for exactly the same reason.
  - **Selecting everything and picking a size means the container, not the
    runs.** Setting a size with nothing selected already did that; select-all
    then shrink did not, and that is the way anyone actually resizes a cell
    they just pasted into — so it reproduced the tall-line bug every time.
    `coversEverything` routes both to the same place.
- **The table is opaque.** The grid overlay is painted on the page underneath
  the blocks, so a see-through table shows graph paper behind its own content.
- **`table-layout: fixed`**, or the content of one cell can widen a column the
  author sized by hand — which would undo a divider drag as soon as someone
  typed.
- **Copy that outgrows its cell is CUT OFF.** `overflow` does nothing on a
  table cell, so the content sits in a `.cell-body` box that can clip. That box
  is present in BOTH modes, so opening the editor still moves nothing.
- **A cell's picture can follow an image field**, resolved in `applySyncDown`
  and pushed back by `collectUpstream` exactly as an image block's is —
  otherwise a logo swapped in the master reaches every adaptation except the
  ones inside tables. `storagePath` is optional for that reason: a `down`
  binding supplies it. Unlinking keeps the file as a plain copy, and deleting
  a bound picture must NOT delete the file, which belongs to the field.
- **The table's controls get their own bar row** under the text row. Crowded
  into one row they pushed the formatting buttons off the end.
- **A new table is built to order** (`NewTablePanel`): rows, columns and the
  header are chosen before the block exists. Reshaping afterwards means
  keeping merges, bindings and track sizes in step for edits the author only
  made because the starting size was wrong.
- **The header has to be tellable apart at a glance**, so it carries weight, a
  tint and a heavier rule under it — a tint alone reads as a highlight.
- **A picture in a cell is referenced from the table block**, not from an image
  block, so `pageMediaPaths` has to collect it explicitly or the media
  collector would delete a file the document is still showing.

### Where a field is used
- **The Sync fields table shows where a field IS embedded, not where it
  could be.** "Available in" said "all projects" on every global row, which
  is the same answer for most of the table and tells nobody anything; what an
  editor needs before renaming or deleting is the real list. The count opens
  the projects and documents that embed it.
- **Read from DRAFTS, not versions** (`fetchFieldUsage`): the draft is what a
  document currently shows, so a field pulled out this morning stops counting
  immediately.
- **Direct references only.** A field nested inside another field's VALUE is a
  usage of that field, not of every project the outer one reaches; following
  the chain would list projects the field's own name never appears in.
- **Loaded after the fields, never awaited with them** — it reads every draft
  in the space, and the table must not wait on it. The column shows `…` until
  it lands.
- **`collectUsages` is the single definition of "a usage"**, so it has to know
  every way a field can be referenced: inline spans, whole-block bindings,
  table cell bindings, and a table cell's bound PICTURE. A usage it cannot see
  is a field that looks safe to delete.

### Leaving with unsaved work
- **Two guards, because they cover different exits.** `beforeunload` in
  `EditorProvider` catches the tab closing or reloading — the unmount flush
  cannot help there, since the request dies with the page. It reads
  `dirtyRef`, not render state, because the browser only honours the handler's
  own synchronous answer.
- **In-app navigation is guarded by watching link clicks** (`Workspace`).
  React Router is mounted as a `BrowserRouter`, which has no blocker API, and
  the breadcrumbs and nav are how the workspace is actually left. Confirming
  saves first rather than discarding.
- **Pending UPSTREAM counts as unsaved even when the draft is clean.** `up`
  and `two-way` edits only reach their fields on Save, Stop editing or
  Dispatch, so walking away silently drops them — that is the case worth
  warning about, and the message names how many.

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
8. **A DOM caret container can be an ELEMENT, not a text node.** Between two
   atomic embeds there is no text node to sit in, so the selection lands on the
   paragraph with a *child index*. `offsetInPara` handles that; its old
   fallback ("treat as end of paragraph") silently inserted fields in the wrong
   place.
9. **`preventDefault` must come before the `e.repeat` guard.** The space-hold
   pan mode bailed out on auto-repeat keydowns *before* cancelling them, so a
   HELD space scrolled the page even though the first press was swallowed.
10. **Submenus need hover *intent* before switching.** The pointer normally
   reaches a submenu by cutting diagonally across the rows *below* its own row.
   Opening the hovered row's submenu instantly therefore unmounts the panel the
   pointer is travelling to. The switch is delayed by `SWITCH_DELAY_MS` (220ms);
   because only one submenu is ever open, the delay cannot bring back the old
   overlapping-panels bug.
11. **PostgREST has its own missing-column error.** A write to a column the
   database does not have yet is rejected by PostgREST *before* Postgres sees
   it — code `PGRST204`, message "Could not find the 'x' column ... in the
   schema cache", not Postgres's `42703` / "does not exist". `isMissingColumn`
   matches both, otherwise a behind-the-app database fails silently.
12. **Testing with synthetic events lies.** The browser harness also cannot
    perform native deletion: `Backspace` does nothing even in plain text, and a
    multi-character `type` uses a bulk insert that skips `beforeinput`. Verify
    deletion and input-guard behaviour with single keystrokes, and never report
    a bug from a key the harness cannot deliver. React's `onMouseEnter` derives from
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
