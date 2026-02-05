/**
 * EducatorHeader - Consistent breadcrumb-based navigation for all educator pages.
 *
 * Replaces per-page "Back to X" buttons with structural breadcrumbs.
 * Provides persistent workflow entry points (Recommended Actions, To-Dos).
 *
 * Usage:
 *   <EducatorHeader
 *     breadcrumbs={[
 *       { label: "Mrs. Smith's Class", to: "/educator/class/class-1" },
 *       { label: "Division Basics" },   // current page — no `to`
 *     ]}
 *     actions={<button>Reassign</button>}
 *   />
 */

import { Link } from "react-router-dom";

export interface BreadcrumbItem {
  label: string;
  to?: string; // omit for the current (last) item
  state?: Record<string, unknown>; // optional router state to pass with navigation
}

interface EducatorHeaderProps {
  breadcrumbs?: BreadcrumbItem[];
  actions?: React.ReactNode;
  onOpenRecommendations?: () => void;
  onOpenTodos?: () => void;
}

export default function EducatorHeader({
  breadcrumbs = [],
  actions,
  onOpenRecommendations,
  onOpenTodos,
}: EducatorHeaderProps) {
  // "Home" is always the first crumb, linking to the educator dashboard
  const allCrumbs: BreadcrumbItem[] = [
    { label: "Home", to: "/educator" },
    ...breadcrumbs,
  ];

  return (
    <nav
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "12px",
        marginBottom: "16px",
        minHeight: "36px",
        flexWrap: "wrap",
      }}
    >
      {/* Left: Breadcrumb trail */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0",
          fontSize: "0.85rem",
          lineHeight: 1.4,
          flexWrap: "wrap",
          minWidth: 0,
          flex: 1,
        }}
      >
        {allCrumbs.map((crumb, i) => {
          const isLast = i === allCrumbs.length - 1;
          const isHome = i === 0;

          return (
            <span key={i} style={{ display: "inline-flex", alignItems: "center" }}>
              {/* Separator */}
              {i > 0 && (
                <span
                  style={{
                    margin: "0 8px",
                    color: "rgba(255,255,255,0.45)",
                    fontSize: "0.75rem",
                    userSelect: "none",
                  }}
                >
                  /
                </span>
              )}

              {/* Crumb */}
              {crumb.to ? (
                <Link
                  to={crumb.to}
                  state={crumb.state}
                  style={{
                    color: isLast ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.75)",
                    textDecoration: "none",
                    fontWeight: isLast || isHome ? 500 : 400,
                    borderRadius: "4px",
                    padding: "2px 6px",
                    margin: "-2px -6px",
                    transition: "background 0.15s, color 0.15s, text-decoration 0.15s",
                    overflow: isLast ? "hidden" : undefined,
                    textOverflow: isLast ? "ellipsis" : undefined,
                    whiteSpace: isLast ? "nowrap" : undefined,
                    maxWidth: isLast ? "300px" : undefined,
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = "rgba(255,255,255,0.95)";
                    e.currentTarget.style.background = "rgba(255,255,255,0.1)";
                    e.currentTarget.style.textDecoration = isLast ? "underline" : "none";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = isLast ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.75)";
                    e.currentTarget.style.background = "transparent";
                    e.currentTarget.style.textDecoration = "none";
                  }}
                >
                  {crumb.label}
                </Link>
              ) : (
                <span
                  style={{
                    color: "rgba(255,255,255,0.95)",
                    fontWeight: 500,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    maxWidth: isLast ? "300px" : undefined,
                  }}
                >
                  {crumb.label}
                </span>
              )}
            </span>
          );
        })}
      </div>

      {/* Right: Workflow links + page actions */}
      <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
        {/* Workflow links */}
        {onOpenRecommendations && (
          <button
            onClick={onOpenRecommendations}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "5px",
              padding: "5px 12px",
              background: "rgba(255,255,255,0.12)",
              color: "rgba(255,255,255,0.85)",
              border: "1px solid rgba(255,255,255,0.18)",
              borderRadius: "6px",
              fontSize: "0.78rem",
              fontWeight: 500,
              cursor: "pointer",
              whiteSpace: "nowrap",
              transition: "background 0.15s, color 0.15s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(255,255,255,0.2)";
              e.currentTarget.style.color = "white";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "rgba(255,255,255,0.12)";
              e.currentTarget.style.color = "rgba(255,255,255,0.85)";
            }}
          >
            Recommended Actions
          </button>
        )}
        {onOpenTodos && (
          <button
            onClick={onOpenTodos}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "5px",
              padding: "5px 12px",
              background: "rgba(255,255,255,0.12)",
              color: "rgba(255,255,255,0.85)",
              border: "1px solid rgba(255,255,255,0.18)",
              borderRadius: "6px",
              fontSize: "0.78rem",
              fontWeight: 500,
              cursor: "pointer",
              whiteSpace: "nowrap",
              transition: "background 0.15s, color 0.15s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(255,255,255,0.2)";
              e.currentTarget.style.color = "white";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "rgba(255,255,255,0.12)";
              e.currentTarget.style.color = "rgba(255,255,255,0.85)";
            }}
          >
            To-Dos
          </button>
        )}

        {/* Page-specific actions */}
        {actions}
      </div>
    </nav>
  );
}
