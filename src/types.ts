/* ============================================================
   RMIT Dispatch — shared domain types
   ============================================================ */

export type Role = 'admin' | 'editor' | 'designer';

export interface AppUser {
  uid: string;
  email: string;
  displayName: string;
}

export interface Space {
  id: string;
  name: string;
  createdBy: string;
  createdAt: string;
}

export interface SpaceMember {
  spaceId: string;
  userId: string;
  role: Role;
  email: string;
  displayName: string;
}

/* ---------- Grid & pages ---------- */

export type PageSize = 'A4' | 'A5' | 'Letter' | 'Social-Square' | 'Social-Story';
export type Orientation = 'portrait' | 'landscape';

export interface GridConfig {
  pageSize: PageSize;
  orientation: Orientation;
  columns: number;
  rows: number;
  marginMm: number;
  gutterMm: number;
  spineMm: number;
}

/** Integer position in grid cells. */
export interface GridPos {
  col: number;
  row: number;
  w: number;
  h: number;
}

/* ---------- Rich text ----------
   A minimal structured model: RichText = paragraphs, paragraph =
   inline nodes. Sync fields anchor to FieldSpan nodes structurally —
   never to character offsets. */

export interface TextNode {
  text: string;
  bold?: boolean;
  italic?: boolean;
  color?: string;
  /** Per-run size. Absent means the block's own size. */
  size?: TextSize;
}

export interface FieldSpan {
  fieldId: string;
  /** Per-embed sync direction; defaults to 'down' when omitted. */
  direction?: SyncDirection;
  /** Local mirror of the field value for rendering. */
  children: InlineNode[];
  /* Character formatting for the whole embed. It lives on the span, not
     on the children, because the children are rewritten from the field
     value on every sync — a mark on them would not survive. This is also
     what lets a field inserted mid-sentence inherit the surrounding
     style. */
  bold?: boolean;
  italic?: boolean;
  color?: string;
  /** Per-embed size, like a text run's. */
  size?: TextSize;
}

export type InlineNode = TextNode | FieldSpan;
export type Paragraph = InlineNode[];
export type RichText = Paragraph[];

export function isFieldSpan(n: InlineNode): n is FieldSpan {
  return (n as FieldSpan).fieldId !== undefined;
}

/* ---------- Blocks ---------- */

export type SyncDirection = 'down' | 'up' | 'two-way';

/** Whole-block binding to a sync field / master source block. */
export interface BlockBinding {
  fieldId?: string;
  sourceBlockId: string;
  direction: SyncDirection;
}

/**
 * Seven steps, shown as XXS…XXL. The stored keys keep their original
 * spellings (`sm`/`md`/`lg` label as S/M/L) so documents written before
 * the scale grew still render at the same size — see lib/textsize.ts.
 */
export type TextSize = 'xxs' | 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'xxl';
export type TextAlign = 'left' | 'center' | 'right';

interface BlockBase {
  id: string;
  pos: GridPos;
  binding?: BlockBinding;
}

export interface TextBlock extends BlockBase {
  type: 'text';
  /** @deprecated Legacy separate heading. Folded into `body` on read
   *  (see foldHeadings) and never written again — authors mark a heading
   *  with formatting instead. */
  heading?: string;
  body: RichText;
  size?: TextSize;
  align?: TextAlign;
  bold?: boolean;
  color?: string;
}

/** Per-cell binding inside a table. */
export interface CellBinding {
  row: number;
  col: number;
  fieldId: string;
  direction: SyncDirection;
}

export interface TableBlock extends BlockBase {
  type: 'table';
  headerRow: boolean;
  rows: RichText[][];
  cellBindings?: CellBinding[];
}

export interface ImageBlock extends BlockBase {
  type: 'image';
  storagePath?: string;
  fit?: 'cover' | 'contain';
  alt?: string;
  caption?: string;
}

export type ShapeKind = 'rect' | 'rounded' | 'circle' | 'triangle' | 'line' | 'arrow';

/**
 * Decoration only. Shapes carry no content, so they are never synced —
 * nothing about them belongs to a sync field.
 */
export interface ShapeBlock extends BlockBase {
  type: 'shape';
  shape: ShapeKind;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  /** 0–100, applied to the whole shape. */
  opacity?: number;
}

export type Block = TextBlock | TableBlock | ImageBlock | ShapeBlock;
export type BlockType = Block['type'];

export type PageKind = 'single' | 'spread';

export interface Page {
  id: string;
  index: number;
  kind: PageKind;
  blocks: Block[];
}

/* ---------- Projects / documents / versions ---------- */

/** Colour flags for at-a-glance status on the projects board. */
export type ProjectFlag = 'red' | 'amber' | 'green' | 'blue' | 'purple' | 'grey';

export interface Project {
  id: string;
  spaceId: string;
  title: string;
  type: string;
  /** '/'-separated organisation path; '' is the root. */
  folder: string;
  flag: ProjectFlag | null;
  createdBy: string;
  createdAt: string;
}

export type DocumentKind = 'master' | 'adaptation';
export type DocumentStatus = 'draft' | 'final';

export interface DocLock {
  uid: string;
  displayName: string;
  at: string;
}

export interface DispatchDocument {
  id: string;
  projectId: string;
  kind: DocumentKind;
  parentId?: string | null;
  title: string;
  grid: GridConfig;
  status: DocumentStatus;
  currentVersionId?: string | null;
  versionCount: number;
  lock: DocLock | null;
}

export interface Draft {
  documentId: string;
  pages: Page[];
  updatedAt: string;
  updatedBy: string;
}

export interface Version {
  id: string;
  documentId: string;
  number: number;
  label?: string | null;
  createdBy: string;
  createdByName?: string;
  createdAt: string;
  snapshot: { pages: Page[] };
}

/* ---------- Sync fields ---------- */

/** What a field holds. Chosen when the field is created. */
export type FieldKind = 'scalar' | 'richtext' | 'table' | 'image' | 'group';

export interface ImagePayload {
  storagePath?: string;
  alt?: string;
  caption?: string;
  fit?: 'cover' | 'contain';
  /** Recorded at upload time so the UI can report what was saved. */
  width?: number;
  height?: number;
  bytes?: number;
}

/** One member of a combination field, in display order. */
export type FieldPart =
  | { id: string; kind: 'text'; rich: RichText }
  | { id: string; kind: 'table'; headerRow: boolean; rows: RichText[][] }
  | ({ id: string; kind: 'image' } & ImagePayload);

export type FieldValue =
  /** A word, number or short phrase — no formatting, no line breaks. */
  | { kind: 'scalar'; text: string }
  /** Flowing copy: one or more paragraphs. */
  | { kind: 'richtext'; rich: RichText }
  /** A whole table owned by the field: header flag plus every cell. */
  | { kind: 'table'; headerRow: boolean; rows: RichText[][] }
  /** A single image in the media bucket. */
  | ({ kind: 'image' } & ImagePayload)
  /** A combination: an ordered mix of text, tables and images. */
  | { kind: 'group'; parts: FieldPart[] };

/** Where a field lives: one project, or every project in the space. */
export type FieldScope = 'local' | 'global';

export interface SyncField {
  id: string;
  /** Null for global fields. */
  projectId: string | null;
  spaceId: string;
  scope: FieldScope;
  /** '/'-separated organisation path; '' means the root. */
  folder: string;
  name: string;
  value: FieldValue;
  updatedAt: string;
  updatedBy: string;
}

/* ---------- Comments ---------- */

export interface DocComment {
  id: string;
  documentId: string;
  blockId?: string | null;
  body: string;
  authorId: string;
  authorName: string;
  resolved: boolean;
  createdAt: string;
}
