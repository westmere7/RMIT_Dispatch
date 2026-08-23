import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from 'react';

/* ============================================================
   In-app confirm / prompt / alert. Replaces the native dialogs:
   window.confirm/prompt are blocking, unstyled, and unavailable
   in embedded browser contexts (prompt throws, confirm silently
   returns false — which would make destructive actions no-op).
   ============================================================ */

type Kind = 'confirm' | 'prompt' | 'alert';

interface Request {
  kind: Kind;
  title: string;
  message?: string;
  defaultValue?: string;
  confirmLabel?: string;
  danger?: boolean;
}

interface DialogApi {
  confirm: (title: string, opts?: { message?: string; confirmLabel?: string; danger?: boolean }) => Promise<boolean>;
  prompt: (title: string, opts?: { message?: string; defaultValue?: string; confirmLabel?: string }) => Promise<string | null>;
  alert: (title: string, opts?: { message?: string }) => Promise<void>;
}

const Ctx = createContext<DialogApi>({
  confirm: async () => false,
  prompt: async () => null,
  alert: async () => {},
});

export function useDialog() {
  return useContext(Ctx);
}

export function DialogProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<Request | null>(null);
  const [value, setValue] = useState('');
  const resolver = useRef<((v: unknown) => void) | null>(null);

  const open = useCallback((req: Request): Promise<unknown> => {
    setRequest(req);
    setValue(req.defaultValue ?? '');
    return new Promise((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const close = useCallback((result: unknown) => {
    setRequest(null);
    const resolve = resolver.current;
    resolver.current = null;
    resolve?.(result);
  }, []);

  const api: DialogApi = {
    confirm: useCallback(
      (title, opts) => open({ kind: 'confirm', title, ...opts }) as Promise<boolean>,
      [open],
    ),
    prompt: useCallback(
      (title, opts) => open({ kind: 'prompt', title, ...opts }) as Promise<string | null>,
      [open],
    ),
    alert: useCallback(
      async (title, opts) => {
        await open({ kind: 'alert', title, ...opts });
      },
      [open],
    ),
  };

  const cancelResult = request?.kind === 'prompt' ? null : false;

  return (
    <Ctx.Provider value={api}>
      {children}
      {request && (
        <div
          className="overlay"
          onMouseDown={(e) => e.target === e.currentTarget && close(cancelResult)}
        >
          <form
            className="modal"
            style={{ maxWidth: 420, display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}
            onSubmit={(e) => {
              e.preventDefault();
              close(request.kind === 'prompt' ? value : true);
            }}
          >
            <h2>{request.title}</h2>
            {request.message && (
              <p className="muted text-sm" style={{ whiteSpace: 'pre-wrap' }}>
                {request.message}
              </p>
            )}
            {request.kind === 'prompt' && (
              <input
                className="input"
                autoFocus
                value={value}
                onChange={(e) => setValue(e.target.value)}
                aria-label={request.title}
              />
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              {request.kind !== 'alert' && (
                <button type="button" className="btn" onClick={() => close(cancelResult)}>
                  Cancel
                </button>
              )}
              <button
                type="submit"
                className={`btn ${request.danger ? 'btn-danger' : 'btn-primary'}`}
                autoFocus={request.kind !== 'prompt'}
              >
                {request.confirmLabel ?? (request.kind === 'alert' ? 'OK' : 'Confirm')}
              </button>
            </div>
          </form>
        </div>
      )}
    </Ctx.Provider>
  );
}
