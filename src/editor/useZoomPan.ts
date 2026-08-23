import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';

/* ============================================================
   Zoom and pan for the editor stage.

   - The wheel zooms about the pointer, as does a trackpad pinch
     (which the browser reports as a ctrl+wheel event).
   - Shift+wheel keeps its usual meaning and scrolls sideways.
   - Middle-mouse drag, or space held with the left button, pans —
     both intercepted before blocks can see the pointer.
   - Zoom is applied through the rendered WIDTH, never a CSS
     transform, so the page never clips when magnified.
   ============================================================ */

export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 4;
const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.8, 1, 1.25, 1.5, 2, 3, 4];
/** Wheel delta → zoom factor. Trackpads emit many small deltas. */
const WHEEL_SENSITIVITY = 0.0022;

export interface ZoomPan {
  zoom: number;
  /** True while the pointer is panning, or space is held ready to. */
  panning: boolean;
  panReady: boolean;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
  /** Set zoom so the page fits the stage again. */
  fit: () => void;
  /** Attach to the stage: starts a pan for middle-click or space-drag. */
  onPointerDownCapture: (e: ReactPointerEvent) => void;
}

export function useZoomPan(
  stageRef: RefObject<HTMLElement>,
  surfaceRef: RefObject<HTMLElement>,
): ZoomPan {
  const [zoom, setZoom] = useState(1);
  const [panning, setPanning] = useState(false);
  const [panReady, setPanReady] = useState(false);

  /**
   * Fraction of the surface that must stay under a given client point
   * after the next zoom commit. Applied in a layout effect, once the new
   * width has been laid out.
   */
  const anchor = useRef<{ fx: number; fy: number; clientX: number; clientY: number } | null>(null);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  /** Zoom while keeping the point under the cursor fixed. */
  const zoomAt = useCallback(
    (next: number, clientX?: number, clientY?: number) => {
      const clamped = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next));
      if (Math.abs(clamped - zoomRef.current) < 0.0005) return;
      const surface = surfaceRef.current;
      if (surface && clientX !== undefined && clientY !== undefined) {
        const r = surface.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          anchor.current = {
            fx: (clientX - r.left) / r.width,
            fy: (clientY - r.top) / r.height,
            clientX,
            clientY,
          };
        }
      }
      setZoom(clamped);
    },
    [surfaceRef],
  );

  /**
   * Re-align the anchored point after the surface has been re-laid out.
   *
   * Two subtleties, both learned the hard way:
   *  - the new width is not always measurable in the same commit, so a
   *    purely synchronous pass can measure the OLD width and compute a
   *    zero correction (which looks exactly like the anchor drifting);
   *  - StrictMode runs layout effects twice (run → cleanup → run), so the
   *    anchor must survive until a pass actually converges, and the
   *    follow-up frame must not be cancelled by the cleanup.
   */
  useLayoutEffect(() => {
    if (!anchor.current) return;

    /** One correction pass; true once the anchor sits under the cursor. */
    const align = (): boolean => {
      const a = anchor.current;
      if (!a) return true;
      const stage = stageRef.current;
      const surface = surfaceRef.current;
      if (!stage || !surface) return true;
      const r = surface.getBoundingClientRect();
      if (r.width === 0) return false;

      // An axis can only be anchored while it actually overflows: with the
      // page centred inside the stage there is no scroll freedom, so
      // zooming out past the fit deliberately re-centres instead of
      // chasing a point it cannot hold.
      const canX = stage.scrollWidth - stage.clientWidth > 1;
      const canY = stage.scrollHeight - stage.clientHeight > 1;
      const dx = canX ? r.left + a.fx * r.width - a.clientX : 0;
      const dy = canY ? r.top + a.fy * r.height - a.clientY : 0;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return true;
      stage.scrollLeft += dx;
      stage.scrollTop += dy;
      return false;
    };

    // No synchronous pass: in the same commit the surface may still report
    // its OLD width, which yields a ~0 correction and would wrongly look
    // converged — discarding the anchor before it could ever be applied.
    // The first frame is the earliest point the new width is measurable.
    //
    // Zooming can also trigger a second relayout of its own (a scrollbar
    // appearing changes the stage's client size, which changes the fitted
    // width), so keep correcting for a few frames. A settled pass is a
    // no-op, so the extra frames cost nothing.
    let frames = 0;
    let raf = 0;
    const settle = () => {
      const done = align();
      frames += 1;
      if (!done && frames < 6) raf = requestAnimationFrame(settle);
      else anchor.current = null;
    };
    raf = requestAnimationFrame(settle);
    return () => cancelAnimationFrame(raf);
  }, [zoom, stageRef, surfaceRef]);

  /* ---------- Wheel: zooms about the pointer ---------- */
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (e: WheelEvent) => {
      // Shift+wheel keeps its usual meaning: scroll sideways.
      if (e.shiftKey) return;
      // Everything else zooms — a mouse wheel, and a trackpad pinch,
      // which the browser reports as a wheel event with ctrlKey set.
      e.preventDefault();
      // Pinch gestures arrive as many small deltas; damp them so a pinch
      // and a wheel notch feel comparable.
      const damp = e.ctrlKey ? 0.6 : 1;
      const factor = Math.exp(-e.deltaY * WHEEL_SENSITIVITY * damp);
      zoomAt(zoomRef.current * factor, e.clientX, e.clientY);
    };
    // Not passive: zooming has to cancel the browser's own page zoom.
    stage.addEventListener('wheel', onWheel, { passive: false });
    return () => stage.removeEventListener('wheel', onWheel);
  }, [stageRef, zoomAt]);

  /* ---------- Space held = pan mode ---------- */
  useEffect(() => {
    const isTyping = (el: EventTarget | null) =>
      el instanceof HTMLElement &&
      (el.tagName === 'INPUT' ||
        el.tagName === 'TEXTAREA' ||
        el.tagName === 'SELECT' ||
        el.isContentEditable);

    const onDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || isTyping(e.target)) return;
      // Stop the page scrolling while space is used as a modifier. This
      // must also cancel the auto-repeat events: bailing out on
      // `e.repeat` before preventDefault let a HELD space scroll the
      // page even though the first press was swallowed.
      e.preventDefault();
      if (e.repeat) return;
      setPanReady(true);
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      setPanReady(false);
    };
    // Releasing focus must not leave the stage stuck in pan mode.
    const onBlur = () => setPanReady(false);
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  /* ---------- Keyboard zoom shortcuts ---------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.key === '=' || e.key === '+') {
        e.preventDefault();
        zoomAt(nextStep(zoomRef.current, 1));
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        zoomAt(nextStep(zoomRef.current, -1));
      } else if (e.key === '0') {
        e.preventDefault();
        setZoom(1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [zoomAt]);

  /* ---------- Pointer panning ---------- */
  const panState = useRef<{ id: number; x: number; y: number } | null>(null);

  const onPointerDownCapture = useCallback(
    (e: ReactPointerEvent) => {
      const middle = e.button === 1;
      const spaceDrag = panReady && e.button === 0;
      if (!middle && !spaceDrag) return;
      const stage = stageRef.current;
      if (!stage) return;

      // Capture-phase: swallow the event so blocks never start a drag.
      e.preventDefault();
      e.stopPropagation();
      panState.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
      setPanning(true);

      const move = (ev: PointerEvent) => {
        const p = panState.current;
        if (!p || ev.pointerId !== p.id) return;
        stage.scrollLeft -= ev.clientX - p.x;
        stage.scrollTop -= ev.clientY - p.y;
        p.x = ev.clientX;
        p.y = ev.clientY;
      };
      const up = (ev: PointerEvent) => {
        if (panState.current && ev.pointerId !== panState.current.id) return;
        panState.current = null;
        setPanning(false);
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    },
    [panReady, stageRef],
  );

  // Middle-click otherwise triggers autoscroll on some platforms.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const block = (e: MouseEvent) => {
      if (e.button === 1) e.preventDefault();
    };
    stage.addEventListener('mousedown', block);
    return () => stage.removeEventListener('mousedown', block);
  }, [stageRef]);

  const fit = useCallback(() => setZoom(1), []);

  return {
    zoom,
    panning,
    panReady,
    zoomIn: () => zoomAt(nextStep(zoomRef.current, 1)),
    zoomOut: () => zoomAt(nextStep(zoomRef.current, -1)),
    resetZoom: () => setZoom(1),
    fit,
    onPointerDownCapture,
  };
}

/** Nearest preset step in the given direction. */
function nextStep(current: number, dir: 1 | -1): number {
  if (dir > 0) return ZOOM_STEPS.find((z) => z > current + 0.001) ?? ZOOM_MAX;
  const below = ZOOM_STEPS.filter((z) => z < current - 0.001);
  return below.length ? below[below.length - 1] : ZOOM_MIN;
}
