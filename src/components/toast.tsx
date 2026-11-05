"use client";

import { CheckCircle2, AlertTriangle, X } from "lucide-react";
import { createContext, useCallback, useContext, useState } from "react";

type Tone = "success" | "error";
interface Toast {
  id: number;
  tone: Tone;
  message: string;
}

const ToastContext = createContext<{ toast: (message: string, tone?: Tone) => void }>({ toast: () => {} });

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const toast = useCallback(
    (message: string, tone: Tone = "success") => {
      const id = Date.now() + Math.random();
      setToasts((t) => [...t.slice(-3), { id, tone, message }]);
      setTimeout(() => dismiss(id), 4000);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4 sm:items-end" aria-live="polite" role="status">
        {toasts.map((t) => (
          <div key={t.id} className="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-lg border border-border bg-surface p-3 text-sm shadow-lg">
            {t.tone === "success" ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden /> : <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />}
            <p className="flex-1">{t.message}</p>
            <button onClick={() => dismiss(t.id)} className="text-muted hover:text-text" aria-label="Dismiss notification">
              <X className="size-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
