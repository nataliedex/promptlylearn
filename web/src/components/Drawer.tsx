import { useEffect, useRef } from "react";

interface DrawerProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  headerActions?: React.ReactNode;
  children: React.ReactNode;
  width?: string;
}

/**
 * Reusable right-side slide-over drawer component.
 * Supports keyboard navigation (ESC to close) and focus trapping.
 */
export default function Drawer({
  isOpen,
  onClose,
  title,
  headerActions,
  children,
  width = "480px",
}: DrawerProps) {
  const drawerRef = useRef<HTMLDivElement>(null);

  // Handle ESC key to close
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  // Focus the drawer when it opens
  useEffect(() => {
    if (isOpen && drawerRef.current) {
      drawerRef.current.focus();
    }
  }, [isOpen]);

  // Prevent body scroll when drawer is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: "rgba(45, 55, 72, 0.25)",
          zIndex: 1000,
          animation: "fadeIn 0.2s ease-out",
        }}
        onClick={onClose}
      />

      {/* Drawer Panel */}
      <div
        ref={drawerRef}
        tabIndex={-1}
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: width,
          maxWidth: "90vw",
          background: "#ffffff",
          boxShadow: "-8px 0 24px rgba(0, 0, 0, 0.08)",
          zIndex: 1001,
          display: "flex",
          flexDirection: "column",
          animation: "slideIn 0.25s ease-out",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Animation styles */}
        <style>
          {`
            @keyframes fadeIn {
              from { opacity: 0; }
              to { opacity: 1; }
            }
            @keyframes slideIn {
              from { transform: translateX(100%); }
              to { transform: translateX(0); }
            }
          `}
        </style>

        {/* Header */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "16px 24px",
            borderBottom: "1px solid #f1f5f9",
            background: "#fafafa",
          }}
        >
          <h2 style={{ margin: 0, fontSize: "1.125rem", fontWeight: 600, color: "#2d3748", letterSpacing: "-0.01em" }}>{title}</h2>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            {headerActions}
            <button
              onClick={onClose}
              aria-label="Close drawer"
              style={{
                background: "none",
                border: "none",
                fontSize: "1.25rem",
                color: "#94a3b8",
                cursor: "pointer",
                padding: "4px 8px",
                lineHeight: 1,
                borderRadius: "4px",
                transition: "color 0.15s, background 0.15s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = "#64748b";
                e.currentTarget.style.background = "#f1f5f9";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = "#94a3b8";
                e.currentTarget.style.background = "none";
              }}
            >
              ×
            </button>
          </div>
        </div>

        {/* Content */}
        <div
          style={{
            flex: 1,
            overflow: "auto",
            padding: "24px",
          }}
        >
          {children}
        </div>
      </div>
    </>
  );
}
