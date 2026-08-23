import type { Role } from '../types';

const LABEL: Record<Role, string> = {
  admin: 'Admin',
  editor: 'Editor',
  designer: 'Designer',
};

export function RoleBadge({ role }: { role: Role }) {
  const cls = role === 'admin' ? 'pill-primary' : role === 'editor' ? 'pill-accent' : '';
  return <span className={`pill ${cls}`}>{LABEL[role]}</span>;
}
