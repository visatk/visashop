import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

interface Toast { id: number; message: string; tone: 'info' | 'success' | 'error' }

interface ToastShape {
  push: (message: string, tone?: Toast['tone']) => void;
}
const ToastContext = createContext<ToastShape | null>(null);

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((message: string, tone: Toast['tone'] = 'info') => {
    const id = nextId++;
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);
  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
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
