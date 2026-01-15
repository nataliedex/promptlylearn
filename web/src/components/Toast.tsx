/**
 * Toast Notification System
 *
 * Replaces browser alerts with styled toast notifications.
 * Supports success, error, and info variants.
 * Auto-dismisses after a configurable duration.
 */

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

type ToastVariant = "success" | "error" | "info";

interface Toast {
  id: string;
  message: string;
  variant: ToastVariant;
}

interface ToastContextType {
  showToast: (message: string, variant?: ToastVariant) => void;
  showSuccess: (message: string) => void;
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

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback((message: string, variant: ToastVariant = "info") => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const toast: Toast = { id, message, variant };

    setToasts((prev) => [...prev, toast]);

    // Auto-dismiss after 4 seconds
    setTimeout(() => {
      removeToast(id);
    }, 4000);
  }, [removeToast]);

  const showSuccess = useCallback((message: string) => {
    showToast(message, "success");
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
  const config = {
    success: {
      bg: "#e8f5e9",
      border: "#4caf50",
      color: "#2e7d32",
      icon: "✓",
    },
    error: {
      bg: "#ffebee",
      border: "#f44336",
      color: "#c62828",
      icon: "✕",
    },
    info: {
      bg: "#e3f2fd",
      border: "#2196f3",
      color: "#1565c0",
      icon: "ℹ",
    },
  };

  const { bg, border, color, icon } = config[toast.variant];

  return (
    <div
      style={{
        background: bg,
        borderLeft: `4px solid ${border}`,
        borderRadius: "8px",
        padding: "12px 16px",
        boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
        display: "flex",
        alignItems: "flex-start",
        gap: "12px",
        animation: "slideIn 0.3s ease-out",
      }}
    >
      <span
        style={{
          color: border,
          fontWeight: "bold",
          fontSize: "1rem",
          lineHeight: 1,
        }}
      >
        {icon}
      </span>
      <p
        style={{
          margin: 0,
          color: color,
          fontSize: "0.9rem",
          flex: 1,
          lineHeight: 1.4,
        }}
      >
        {toast.message}
      </p>
      <button
        onClick={onDismiss}
        style={{
          background: "none",
          border: "none",
          color: "#999",
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
