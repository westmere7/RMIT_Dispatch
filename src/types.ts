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
}

export interface FieldSpan {
  fieldId: string;
  /** Per-embed sync direction; defaults to 'down' when omitted. */
  direction?: SyncDirection;
  /** Local mirror of the field value for rendering. */
  children: InlineNode[];
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

export type TextSize = 'sm' | 'md' | 'lg' | 'xl';
export type TextAlign = 'left' | 'center' | 'right';

interface BlockBase {
  id: string;
  pos: GridPos;
  binding?: BlockBinding;
}

export interface TextBlock extends BlockBase {
  type: 'text';
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

export type Block = TextBlock | TableBlock | ImageBlock;
export type BlockType = Block['type'];

export type PageKind = 'single' | 'spread';

export interface Page {
  id: string;
  index: number;
  kind: PageKind;
  blocks: Block[];
}

/* ---------- Projects / documents / versions ---------- */

export interface Project {
  id: string;
  spaceId: string;
  title: string;
  type: string;
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

export type FieldValue =
  | { kind: 'richtext'; rich: RichText }
  | { kind: 'scalar'; text: string };

export interface SyncField {
  id: string;
  projectId: string;
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
