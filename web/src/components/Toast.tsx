/**
 * Toast Notification System
 *
 * Replaces browser alerts with styled toast notifications.
 * Supports success, error, and info variants.
 * Auto-dismisses after a configurable duration.
 */

import { createContext, useContext, useState, useCallback, useRef, type ReactNode } from "react";

type ToastVariant = "success" | "error" | "info";

interface ToastAction {
  label: string;
  onClick: () => void;
}

interface Toast {
  id: string;
  message: string;
  variant: ToastVariant;
  action?: ToastAction;
}

interface ToastContextType {
  showToast: (message: string, variant?: ToastVariant, options?: { action?: ToastAction; duration?: number }) => void;
  showSuccess: (message: string, options?: { action?: ToastAction; duration?: number }) => void;
  showError: (message: string) => void;
}

const ToastContext = createContext<ToastContextType | null>(null);

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
}

interface ToastProviderProps {
  children: ReactNode;
}

export function ToastProvider({ children }: ToastProviderProps) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback((message: string, variant: ToastVariant = "info", options?: { action?: ToastAction; duration?: number }) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const toast: Toast = { id, message, variant, action: options?.action };

    // Clear previous dismiss timer and replace all existing toasts
    if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    setToasts([toast]);

    // Auto-dismiss (default 4s, configurable)
    dismissTimerRef.current = setTimeout(() => {
      removeToast(id);
    }, options?.duration ?? 4000);
  }, [removeToast]);

  const showSuccess = useCallback((message: string, options?: { action?: ToastAction; duration?: number }) => {
    showToast(message, "success", options);
  }, [showToast]);

  const showError = useCallback((message: string) => {
    showToast(message, "error");
  }, [showToast]);

  return (
    <ToastContext.Provider value={{ showToast, showSuccess, showError }}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={removeToast} />
    </ToastContext.Provider>
  );
}

// ============================================
// Toast Container (renders all active toasts)
// ============================================

interface ToastContainerProps {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}

function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
  if (toasts.length === 0) return null;

  return (
    <div
      style={{
        position: "fixed",
        bottom: "24px",
        right: "24px",
        zIndex: 9999,
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        maxWidth: "400px",
      }}
    >
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={() => onDismiss(toast.id)} />
      ))}
    </div>
  );
}

// ============================================
// Individual Toast Item
// ============================================

interface ToastItemProps {
  toast: Toast;
  onDismiss: () => void;
}

function ToastItem({ toast, onDismiss }: ToastItemProps) {
  // Softer, more muted color palette
  const config = {
    success: {
      bg: "#f0fdf4",
      border: "#4ade80",
      color: "#166534",
      icon: "",
    },
    error: {
      bg: "#fef2f2",
      border: "#f87171",
      color: "#991b1b",
      icon: "✕",
    },
    info: {
      bg: "#f8fafc",
      border: "#7c8fce",
      color: "#475569",
      icon: "i",
    },
  };

  const { bg, border, color, icon } = config[toast.variant];

  return (
    <div
      style={{
        background: bg,
        borderLeft: `3px solid ${border}`,
        borderRadius: "6px",
        padding: "12px 14px",
        boxShadow: "0 4px 16px rgba(0,0,0,0.08)",
        display: "flex",
        alignItems: "flex-start",
        gap: "10px",
        animation: "slideIn 0.25s ease-out",
      }}
    >
      <span
        style={{
          color: border,
          fontWeight: "600",
          fontSize: "0.8rem",
          lineHeight: 1,
          width: "16px",
          height: "16px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {icon}
      </span>
      <div style={{ flex: 1, display: "flex", alignItems: "center", gap: "10px" }}>
        <p
          style={{
            margin: 0,
            color: color,
            fontSize: "0.875rem",
            flex: 1,
            lineHeight: 1.5,
            fontWeight: "500",
          }}
        >
          {toast.message}
        </p>
        {toast.action && (
          <button
            onClick={() => {
              toast.action!.onClick();
              onDismiss();
            }}
            style={{
              background: "none",
              border: "none",
              color: border,
              cursor: "pointer",
              fontWeight: 600,
              fontSize: "0.85rem",
              textDecoration: "underline",
              padding: "2px 4px",
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
          >
            {toast.action.label}
          </button>
        )}
      </div>
      <button
        onClick={onDismiss}
        style={{
          background: "none",
          border: "none",
          color: "#94a3b8",
          cursor: "pointer",
          padding: "0",
          fontSize: "1rem",
          lineHeight: 1,
        }}
        aria-label="Dismiss"
      >
        ×
      </button>
      <style>
        {`
          @keyframes slideIn {
            from {
              opacity: 0;
              transform: translateX(100%);
            }
            to {
              opacity: 1;
              transform: translateX(0);
            }
          }
        `}
      </style>
    </div>
  );
}
