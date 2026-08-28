import type { SVGProps } from 'react';

/* Inline SVG icon set (Lucide-derived path data, ISC license).
   All icons: 24×24 viewBox, stroke = currentColor. */

type P = SVGProps<SVGSVGElement> & { size?: number };

function I({ size = 18, children, ...rest }: P) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const IconGrid = (p: P) => (
  <I {...p}>
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
    <rect x="14" y="14" width="7" height="7" rx="1" />
  </I>
);
export const IconUsers = (p: P) => (
  <I {...p}>
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </I>
);
/** Proper gear, not a sunburst. */
export const IconSettings = (p: P) => (
  <I {...p}>
    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
    <circle cx="12" cy="12" r="3" />
  </I>
);
export const IconSun = (p: P) => (
  <I {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </I>
);
export const IconMoon = (p: P) => (
  <I {...p}>
    <path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z" />
  </I>
);
export const IconBell = (p: P) => (
  <I {...p}>
    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
    <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
  </I>
);
export const IconSearch = (p: P) => (
  <I {...p}>
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.3-4.3" />
  </I>
);
export const IconPlus = (p: P) => (
  <I {...p}>
    <path d="M5 12h14M12 5v14" />
  </I>
);
/* Overflow menu: filled dots read better than 2px-stroked rings at 12px. */
export const IconMore = (p: P) => (
  <I {...p} strokeWidth={0}>
    <circle cx="5" cy="12" r="2" fill="currentColor" />
    <circle cx="12" cy="12" r="2" fill="currentColor" />
    <circle cx="19" cy="12" r="2" fill="currentColor" />
  </I>
);
export const IconMinus = (p: P) => (
  <I {...p}>
    <path d="M5 12h14" />
  </I>
);
export const IconChevronDown = (p: P) => (
  <I {...p}>
    <path d="m6 9 6 6 6-6" />
  </I>
);
export const IconChevronLeft = (p: P) => (
  <I {...p}>
    <path d="m15 18-6-6 6-6" />
  </I>
);
export const IconChevronRight = (p: P) => (
  <I {...p}>
    <path d="m9 18 6-6-6-6" />
  </I>
);
export const IconLock = (p: P) => (
  <I {...p}>
    <rect x="3" y="11" width="18" height="11" rx="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </I>
);
export const IconUnlock = (p: P) => (
  <I {...p}>
    <rect x="3" y="11" width="18" height="11" rx="2" />
    <path d="M7 11V7a5 5 0 0 1 9.9-1" />
  </I>
);
export const IconX = (p: P) => (
  <I {...p}>
    <path d="M18 6 6 18M6 6l12 12" />
  </I>
);
export const IconTrash = (p: P) => (
  <I {...p}>
    <path d="M3 6h18" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </I>
);
export const IconCopy = (p: P) => (
  <I {...p}>
    <rect x="9" y="9" width="13" height="13" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </I>
);
export const IconLayers = (p: P) => (
  <I {...p}>
    <path d="m12 2 8.5 4.7a1 1 0 0 1 0 1.7L12 13 3.5 8.4a1 1 0 0 1 0-1.7L12 2z" />
    <path d="m3 12 9 5 9-5" />
    <path d="m3 17 9 5 9-5" />
  </I>
);
export const IconImage = (p: P) => (
  <I {...p}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <circle cx="9" cy="9" r="2" />
    <path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21" />
  </I>
);
export const IconType = (p: P) => (
  <I {...p}>
    <path d="M4 7V4h16v3" />
    <path d="M9 20h6" />
    <path d="M12 4v16" />
  </I>
);
export const IconTable = (p: P) => (
  <I {...p}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M3 9h18M3 15h18M12 3v18" />
  </I>
);
export const IconLink = (p: P) => (
  <I {...p}>
    <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
    <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
  </I>
);
export const IconUnlink = (p: P) => (
  <I {...p}>
    <path d="M15 7h2a5 5 0 0 1 0 10h-2m-6 0H7A5 5 0 0 1 7 7h2" />
    <path d="m2 2 20 20" />
  </I>
);
export const IconMessage = (p: P) => (
  <I {...p}>
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </I>
);
export const IconHistory = (p: P) => (
  <I {...p}>
    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
    <path d="M3 3v5h5" />
    <path d="M12 7v5l4 2" />
  </I>
);
export const IconArrowDown = (p: P) => (
  <I {...p}>
    <path d="M12 5v14m7-7-7 7-7-7" />
  </I>
);
export const IconArrowUp = (p: P) => (
  <I {...p}>
    <path d="M12 19V5m-7 7 7-7 7 7" />
  </I>
);
export const IconArrowUpDown = (p: P) => (
  <I {...p}>
    <path d="m21 16-4 4-4-4" />
    <path d="M17 20V4" />
    <path d="m3 8 4-4 4 4" />
    <path d="M7 4v16" />
  </I>
);
/* The app's namesake action: send this document's content onward. */
export const IconDispatch = (p: P) => (
  <I {...p}>
    <path d="M22 2 11 13" />
    <path d="M22 2 15 22 11 13 2 9z" />
  </I>
);
export const IconCheck = (p: P) => (
  <I {...p}>
    <path d="M20 6 9 17l-5-5" />
  </I>
);
export const IconPencil = (p: P) => (
  <I {...p}>
    <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    <path d="m15 5 4 4" />
  </I>
);
export const IconLogout = (p: P) => (
  <I {...p}>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <path d="m16 17 5-5-5-5" />
    <path d="M21 12H9" />
  </I>
);
export const IconZoomIn = (p: P) => (
  <I {...p}>
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.3-4.3M11 8v6M8 11h6" />
  </I>
);
export const IconZoomOut = (p: P) => (
  <I {...p}>
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.3-4.3M8 11h6" />
  </I>
);
export const IconBold = (p: P) => (
  <I {...p}>
    <path d="M6 4h8a4 4 0 0 1 0 8H6zm0 8h9a4 4 0 0 1 0 8H6z" />
  </I>
);
export const IconItalic = (p: P) => (
  <I {...p}>
    <path d="M19 4h-9m4 16H5M15 4 9 20" />
  </I>
);
export const IconAlignLeft = (p: P) => (
  <I {...p}>
    <path d="M21 6H3m12 6H3m18 6H3" />
  </I>
);
export const IconAlignCenter = (p: P) => (
  <I {...p}>
    <path d="M21 6H3m14 6H7m12 6H5" />
  </I>
);
export const IconAlignRight = (p: P) => (
  <I {...p}>
    <path d="M21 6H3m18 6H9m12 6H3" />
  </I>
);
export const IconFile = (p: P) => (
  <I {...p}>
    <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
    <path d="M14 2v6h6" />
  </I>
);
export const IconEye = (p: P) => (
  <I {...p}>
    <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
    <circle cx="12" cy="12" r="3" />
  </I>
);
export const IconBringFront = (p: P) => (
  <I {...p}>
    <rect x="8" y="8" width="12" height="12" rx="2" />
    <path d="M4 16V6a2 2 0 0 1 2-2h10" />
  </I>
);
export const IconSendBack = (p: P) => (
  <I {...p}>
    <rect x="4" y="4" width="12" height="12" rx="2" />
    <path d="M20 8v10a2 2 0 0 1-2 2H8" />
  </I>
);
export const IconUndo = (p: P) => (
  <I {...p}>
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h10.5A5.5 5.5 0 0 1 20 14.5 5.5 5.5 0 0 1 14.5 20H11" />
  </I>
);
export const IconRedo = (p: P) => (
  <I {...p}>
    <path d="m15 14 5-5-5-5" />
    <path d="M20 9H9.5A5.5 5.5 0 0 0 4 14.5 5.5 5.5 0 0 0 9.5 20H13" />
  </I>
);
export const IconFit = (p: P) => (
  <I {...p}>
    <path d="M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3" />
  </I>
);
export const IconHand = (p: P) => (
  <I {...p}>
    <path d="M18 11V6a2 2 0 0 0-4 0v5M14 10V4a2 2 0 0 0-4 0v7M10 10.5V6a2 2 0 0 0-4 0v8" />
    <path d="M6 14a8 8 0 0 0 8 8h1a7 7 0 0 0 7-7v-4a2 2 0 0 0-4 0" />
  </I>
);
export const IconSliders = (p: P) => (
  <I {...p}>
    <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3" />
    <path d="M1 14h6M9 8h6M17 16h6" />
  </I>
);
export const IconShapes = (p: P) => (
  <I {...p}>
    <rect x="3" y="12" width="9" height="9" rx="1" />
    <circle cx="16" cy="7.5" r="4.5" />
  </I>
);
export const IconCircle = (p: P) => (
  <I {...p}>
    <circle cx="12" cy="12" r="9" />
  </I>
);
export const IconSquare = (p: P) => (
  <I {...p}>
    <rect x="4" y="4" width="16" height="16" rx="1.5" />
  </I>
);
export const IconLine = (p: P) => (
  <I {...p}>
    <path d="M4 20 20 4" />
  </I>
);
export const IconArrowRight = (p: P) => (
  <I {...p}>
    <path d="M4 12h15m0 0-6-6m6 6-6 6" />
  </I>
);
export const IconTriangle = (p: P) => (
  <I {...p}>
    <path d="M12 3l9 17H3z" />
  </I>
);
export const IconDot = (p: P) => (
  <I {...p}>
    <circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" />
  </I>
);
export const IconFileText = (p: P) => (
  <I {...p}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="16" y1="13" x2="8" y2="13" />
    <line x1="16" y1="17" x2="8" y2="17" />
    <polyline points="10 9 9 9 8 9" />
  </I>
);
export const IconInfo = (p: P) => (
  <I {...p}>
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="16" x2="12" y2="12" />
    <line x1="12" y1="8" x2="12.01" y2="8" />
  </I>
);
export const IconSinglePage = (p: P) => (
  <I {...p}>
    <rect x="5" y="3" width="14" height="18" rx="2" />
  </I>
);
export const IconSpread = (p: P) => (
  <I {...p}>
    <rect x="2" y="4" width="9.5" height="16" rx="1.5" />
    <rect x="12.5" y="4" width="9.5" height="16" rx="1.5" />
  </I>
);
export const IconShare = (p: P) => (
  <I {...p}>
    <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
    <polyline points="16 6 12 2 8 6" />
    <line x1="12" y1="2" x2="12" y2="15" />
  </I>
);
export const IconExternalLink = (p: P) => (
  <I {...p}>
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    <polyline points="15 3 21 3 21 9" />
    <line x1="10" y1="14" x2="21" y2="3" />
  </I>
);
export const IconClock = (p: P) => (
  <I {...p}>
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </I>
);
export const IconGlobe = (p: P) => (
  <I {...p}>
    <circle cx="12" cy="12" r="10" />
    <line x1="2" y1="12" x2="22" y2="12" />
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
  </I>
);
export const IconAlertTriangle = (p: P) => (
  <I {...p}>
    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </I>
);
export const IconUpload = (p: P) => (
  <I {...p}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="17 8 12 3 7 8" />
    <line x1="12" y1="3" x2="12" y2="15" />
  </I>
);
export const IconLoader = (p: P) => (
  <I {...p} style={{ animation: 'spin 0.8s linear infinite', ...p.style }}>
    <line x1="12" y1="2" x2="12" y2="6" />
    <line x1="12" y1="18" x2="12" y2="22" />
    <line x1="4.93" y1="4.93" x2="7.76" y2="7.76" />
    <line x1="16.24" y1="16.24" x2="19.07" y2="19.07" />
    <line x1="2" y1="12" x2="6" y2="12" />
    <line x1="18" y1="12" x2="22" y2="12" />
    <line x1="4.93" y1="19.07" x2="7.76" y2="16.24" />
    <line x1="16.24" y1="7.76" x2="19.07" y2="4.93" />
  </I>
);
