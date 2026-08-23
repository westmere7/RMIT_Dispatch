import type { ProjectFlag } from '../types';

/* ============================================================
   Project flags.

   A fixed palette of colours and nothing more — no status
   meanings attached, so each team is free to decide what a
   colour means to them. Kept out of the page module so
   importing it elsewhere does not break React Fast Refresh.
   ============================================================ */

export const FLAGS: { flag: ProjectFlag; label: string; color: string }[] = [
  { flag: 'red', label: 'Red', color: 'var(--rmit-red)' },
  { flag: 'amber', label: 'Amber', color: '#d97706' },
  { flag: 'green', label: 'Green', color: '#15803d' },
  { flag: 'blue', label: 'Blue', color: '#2563eb' },
  { flag: 'purple', label: 'Purple', color: '#7c3aed' },
  { flag: 'grey', label: 'Grey', color: '#64748b' },
];

export function flagColor(flag: ProjectFlag | null | undefined): string | null {
  return FLAGS.find((f) => f.flag === flag)?.color ?? null;
}

export function flagLabel(flag: ProjectFlag | null | undefined): string | null {
  return FLAGS.find((f) => f.flag === flag)?.label ?? null;
}
