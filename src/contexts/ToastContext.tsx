import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

interface Toast {
  id: number;
  message: string;
  tone: 'info' | 'success' | 'error';
}

interface ToastShape {
  push: (message: string, tone?: Toast['tone']) => void;
}

const ToastContext = createContext<ToastShape | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);

  const push = useCallback((message: string, tone: Toast['tone'] = 'info') => {
    const id = ++idRef.current;
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);

  // Memoise the context value so consumers' useEffect deps stay stable.
  const value = useMemo<ToastShape>(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm"
        role="region"
        aria-live="polite"
        aria-label="Notifications"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={
              'card px-4 py-3 text-sm shadow-lg border-l-4 ' +
              (t.tone === 'success'
                ? 'border-l-(--color-success)'
                : t.tone === 'error'
                  ? 'border-l-(--color-danger)'
                  : 'border-l-(--color-accent)')
            }
            role="status"
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastShape {
  const c = useContext(ToastContext);
  if (!c) throw new Error('useToast outside provider');
  return c;
}
