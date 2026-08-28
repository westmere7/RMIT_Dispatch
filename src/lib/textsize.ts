import type { TextSize } from '../types';

/* ============================================================
   The one text-size scale. These factors mirror
   `.block-content.size-*` in canvas.css — keep them in step.
   ============================================================ */

export const TEXT_SIZES: TextSize[] = ['xxs', 'xs', 'sm', 'md', 'lg', 'xl', 'xxl'];

/**
 * What the user sees. The keys are the stored values and deliberately do
 * NOT match their labels: `sm`/`md`/`lg` predate the wider scale, and
 * renaming them would have meant migrating every block and every run
 * mark in every document for no gain.
 */
export const SIZE_LABEL: Record<TextSize, string> = {
  xxs: 'XXS',
  xs: 'XS',
  sm: 'S',
  md: 'M',
  lg: 'L',
  xl: 'XL',
  xxl: 'XXL',
};

export const SIZE_EM: Record<TextSize, number> = {
  // 50% smaller scale across the range for fine-tuned layout control
  xxs: 0.25,
  xs: 0.325,
  sm: 0.4,
  md: 0.5,
  lg: 0.675,
  xl: 0.9,
  xxl: 1.2,
};

/**
 * CSS font-size for a run inside a block whose own size is `base`.
 * Divided by the base so a run marked LG looks the same whatever the
 * block's size is — the container already applies `base` in ems.
 */
export function runFontSize(run: TextSize | undefined, base: TextSize = 'md'): string | undefined {
  if (!run) return undefined;
  return `${(SIZE_EM[run] / SIZE_EM[base]).toFixed(4)}em`;
}
