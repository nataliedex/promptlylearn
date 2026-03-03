/**
 * EducatorAppHeader - Global navigation header for all educator pages.
 *
 * Provides consistent navigation across the educator experience with three modes:
 * - "full": Complete navigation for dashboards and list pages
 * - "slim": Reduced navigation for detail/review pages
 * - "focus": Minimal header for creation/editing workflows
 *
 * Navigation is always available (except focus mode), making it easy to:
 * - Go Home
 * - Jump to My Classes
 * - Create a lesson
 * - Search
 */

import { useState, useRef, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";

export type HeaderMode = "full" | "slim" | "focus";

export interface BreadcrumbItem {
  label: string;
  to?: string;
  state?: Record<string, unknown>;
}

export interface EducatorAppHeaderProps {
  mode?: HeaderMode;

  // Teacher identity
  teacherName?: string;

  // Navigation callbacks
  onOpenProfile?: () => void;
  onOpenClasses?: () => void;
  onOpenCreateLesson?: () => void;

  // Breadcrumbs (for slim mode, or additional context in full mode)
  breadcrumbs?: BreadcrumbItem[];

  // Back navigation (for slim/focus modes)
  backLink?: string;
  backLabel?: string;

  // Page title (for focus mode or slim mode without breadcrumbs)
  title?: string;

  // Focus mode: primary actions (Save, Publish, etc.)
  primaryActions?: React.ReactNode;

  // Search
  searchSlot?: React.ReactNode; // Full mode: complete search with dropdown
  onSearch?: (query: string) => void; // Slim mode: simple search callback

  // Slim mode overrides - show these even in slim mode
  showCreateInSlim?: boolean;
  showProfileInSlim?: boolean;
}

// Shared button styles — light theme
const buttonBase: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "6px",
  padding: "6px 12px",
  border: "1px solid var(--border-subtle)",
  borderRadius: "6px",
  fontSize: "0.8rem",
  fontWeight: 500,
  cursor: "pointer",
  whiteSpace: "nowrap",
  transition: "all 0.15s ease",
  background: "transparent",
  color: "var(--text-secondary)",
};

function HeaderButton({
  onClick,
  children,
  variant = "default",
  style,
}: {
  onClick?: () => void;
  children: React.ReactNode;
  variant?: "default" | "primary" | "ghost";
  style?: React.CSSProperties;
}) {
  const variants = {
    default: {
      background: "transparent",
      borderColor: "var(--border-subtle)",
    },
    primary: {
      background: "var(--surface-accent)",
      borderColor: "var(--border-subtle)",
    },
    ghost: {
      background: "transparent",
      borderColor: "var(--border-subtle)",
    },
  };

  const v = variants[variant];

  return (
    <button
      onClick={onClick}
      style={{
        ...buttonBase,
        background: v.background,
        borderColor: v.borderColor,
        ...style,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "var(--surface-accent)";
        e.currentTarget.style.color = "var(--text-primary)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = v.background;
        e.currentTarget.style.color = "var(--text-secondary)";
      }}
    >
      {children}
    </button>
  );
}

function CompactSearch({ onSearch }: { onSearch?: (query: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (expanded && inputRef.current) {
      inputRef.current.focus();
    }
  }, [expanded]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        if (!query) setExpanded(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [query]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim() && onSearch) {
      onSearch(query.trim());
    }
  };

  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        style={{
          ...buttonBase,
          padding: "6px 8px",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "var(--surface-accent)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "transparent";
        }}
        title="Search"
      >
        <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <circle cx="11" cy="11" r="8" strokeWidth="2" />
          <path d="M21 21l-4.35-4.35" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
    );
  }

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <form onSubmit={handleSubmit}>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search..."
          style={{
            width: "160px",
            padding: "6px 10px 6px 28px",
            fontSize: "0.8rem",
            border: "1px solid var(--border-subtle)",
            borderRadius: "6px",
            background: "transparent",
            color: "var(--text-secondary)",
            outline: "none",
          }}
          onBlur={() => {
            if (!query) setExpanded(false);
          }}
        />
        <svg
          style={{
            position: "absolute",
            left: "8px",
            top: "50%",
            transform: "translateY(-50%)",
            width: "12px",
            height: "12px",
            color: "var(--text-secondary)",
            pointerEvents: "none",
          }}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <circle cx="11" cy="11" r="8" strokeWidth="2" />
          <path d="M21 21l-4.35-4.35" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </form>
    </div>
  );
}

function Breadcrumbs({ items, showHome = true }: { items: BreadcrumbItem[]; showHome?: boolean }) {
  const allCrumbs = showHome ? [{ label: "Home", to: "/educator" }, ...items] : items;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0",
        fontSize: "0.85rem",
        flexWrap: "wrap",
      }}
    >
      {allCrumbs.map((crumb, i) => {
        const isLast = i === allCrumbs.length - 1;

        return (
          <span key={i} style={{ display: "inline-flex", alignItems: "center" }}>
            {i > 0 && (
              <span
                style={{
                  margin: "0 8px",
                  color: "var(--text-muted)",
                  fontSize: "0.75rem",
                }}
              >
                /
              </span>
            )}
            {crumb.to && !isLast ? (
              <Link
                to={crumb.to}
                state={crumb.state}
                style={{
                  color: "var(--text-secondary)",
                  textDecoration: "none",
                  fontWeight: i === 0 ? 500 : 400,
                  padding: "2px 4px",
                  borderRadius: "4px",
                  transition: "all 0.15s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "var(--surface-accent)";
                  e.currentTarget.style.color = "var(--text-primary)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                  e.currentTarget.style.color = "var(--text-secondary)";
                }}
              >
                {crumb.label}
              </Link>
            ) : (
              <span
                style={{
                  color: "var(--text-primary)",
                  fontWeight: 500,
                  maxWidth: "280px",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {crumb.label}
              </span>
            )}
          </span>
        );
      })}
    </div>
  );
}

export default function EducatorAppHeader({
  mode = "full",
  teacherName,
  onOpenProfile,
  onOpenClasses,
  onOpenCreateLesson,
  breadcrumbs = [],
  backLink,
  backLabel = "Back",
  title,
  primaryActions,
  searchSlot,
  onSearch,
  showCreateInSlim = false,
  showProfileInSlim = false,
}: EducatorAppHeaderProps) {
  const navigate = useNavigate();

  // Header container styles — light, minimal
  const headerStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "16px",
    padding: "10px 0",
    marginBottom: "16px",
    background: "transparent",
    borderBottom: "1px solid var(--border-subtle)",
    minHeight: "48px",
  };

  // FOCUS MODE - Minimal header for editing
  if (mode === "focus") {
    return (
      <header style={headerStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          {backLink ? (
            <Link
              to={backLink}
              style={{
                color: "var(--text-muted)",
                textDecoration: "none",
                fontSize: "0.85rem",
                display: "flex",
                alignItems: "center",
                gap: "4px",
                padding: "4px 8px",
                borderRadius: "4px",
                transition: "all 0.15s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "var(--surface-accent)";
                e.currentTarget.style.color = "var(--text-primary)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
                e.currentTarget.style.color = "var(--text-muted)";
              }}
            >
              <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              {backLabel}
            </Link>
          ) : (
            <Link
              to="/educator"
              style={{
                color: "var(--text-muted)",
                textDecoration: "none",
                fontSize: "0.85rem",
              }}
            >
              Home
            </Link>
          )}
          {title && (
            <>
              <span style={{ color: "var(--text-muted)" }}>|</span>
              <span style={{ color: "var(--text-primary)", fontWeight: 500, fontSize: "0.9rem" }}>
                {title}
              </span>
            </>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          {primaryActions}
        </div>
      </header>
    );
  }

  // SLIM MODE - Reduced navigation for detail pages
  if (mode === "slim") {
    return (
      <header style={headerStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px", flex: 1, minWidth: 0 }}>
          {backLink && (
            <Link
              to={backLink}
              style={{
                color: "var(--text-muted)",
                textDecoration: "none",
                fontSize: "0.85rem",
                display: "flex",
                alignItems: "center",
                gap: "4px",
                padding: "4px 8px",
                borderRadius: "4px",
                transition: "all 0.15s",
                flexShrink: 0,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "var(--surface-accent)";
                e.currentTarget.style.color = "var(--text-primary)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
                e.currentTarget.style.color = "var(--text-muted)";
              }}
            >
              <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
          )}
          {breadcrumbs.length > 0 ? (
            <Breadcrumbs items={breadcrumbs} showHome={!backLink} />
          ) : title ? (
            <span style={{ color: "var(--text-primary)", fontWeight: 500, fontSize: "0.9rem" }}>
              {title}
            </span>
          ) : (
            <Link
              to="/educator"
              style={{
                color: "var(--text-primary)",
                textDecoration: "none",
                fontWeight: 500,
                fontSize: "0.9rem",
              }}
            >
              Home
            </Link>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
          {/* Primary actions - page-specific buttons */}
          {primaryActions}

          {/* My Classes - always visible in slim mode */}
          {onOpenClasses && (
            <HeaderButton onClick={onOpenClasses}>
              <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              </svg>
              <span style={{ display: "none" }}>Classes</span>
            </HeaderButton>
          )}

          {/* Create Lesson - optional in slim mode */}
          {showCreateInSlim && onOpenCreateLesson && (
            <HeaderButton onClick={onOpenCreateLesson}>
              <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            </HeaderButton>
          )}

          {/* Profile - optional in slim mode */}
          {showProfileInSlim && onOpenProfile && teacherName && (
            <HeaderButton onClick={onOpenProfile} variant="ghost">
              {teacherName}
            </HeaderButton>
          )}

          {/* Search - compact in slim mode */}
          {searchSlot || (onSearch && <CompactSearch onSearch={onSearch} />)}
        </div>
      </header>
    );
  }

  // FULL MODE - Complete navigation for dashboards
  return (
    <header style={headerStyle}>
      <div style={{ display: "flex", alignItems: "center", gap: "16px", flex: 1, minWidth: 0 }}>
        {/* Home link */}
        <Link
          to="/educator"
          style={{
            color: "var(--text-primary)",
            textDecoration: "none",
            fontWeight: 600,
            fontSize: "0.95rem",
            display: "flex",
            alignItems: "center",
            gap: "6px",
            padding: "4px 8px",
            borderRadius: "4px",
            transition: "all 0.15s",
            flexShrink: 0,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "var(--surface-accent)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
          }}
        >
          <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
          </svg>
          Teaching Hub
        </Link>

        {/* Optional breadcrumbs in full mode */}
        {breadcrumbs.length > 0 && (
          <>
            <span style={{ color: "var(--text-muted)" }}>/</span>
            <Breadcrumbs items={breadcrumbs} showHome={false} />
          </>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
        {/* Account / Profile */}
        {onOpenProfile && (
          <HeaderButton onClick={onOpenProfile} variant="ghost">
            <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
            {teacherName || "Profile"}
          </HeaderButton>
        )}

        {/* My Classes */}
        {onOpenClasses && (
          <HeaderButton onClick={onOpenClasses}>
            <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
            My Classes
          </HeaderButton>
        )}

        {/* Create Lesson */}
        {onOpenCreateLesson && (
          <HeaderButton onClick={onOpenCreateLesson} variant="primary">
            <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Create Lesson
          </HeaderButton>
        )}

        {/* Search */}
        {searchSlot}
      </div>
    </header>
  );
}
