/**
 * Header - Unified header component with explicit modes.
 *
 * Each page explicitly declares its header mode. The header never disappears,
 * only its contents and layout change based on the mode.
 *
 * Modes:
 * - dashboard: Full header for educator/student hubs. Status pills, search, all actions.
 * - context: Reduced header for detail pages. Breadcrumbs, minimal actions.
 * - focus: Minimal header for creation/editing. Back + title only.
 * - session: Locked header for student lesson flow. Progress indicator, no distractions.
 * - completion: Subdued header for post-submission. Minimal, transition-focused.
 */

import { Link } from "react-router-dom";

export type HeaderMode = "dashboard" | "context" | "focus" | "session" | "completion";

export interface BreadcrumbItem {
  label: string;
  to?: string;
  state?: Record<string, unknown>;
}

export interface StatusPill {
  label: string;
  count?: number;
  onClick: () => void;
  variant?: "default" | "warning" | "success" | "info";
}

export interface HeaderProps {
  // Required: explicit mode declaration
  mode: HeaderMode;

  // Identity
  userType?: "educator" | "student";
  userName?: string;

  // Navigation
  homeLink?: string;
  breadcrumbs?: BreadcrumbItem[];
  backLink?: string;
  backLabel?: string;

  // Content
  title?: string;
  subtitle?: string;

  // Session mode: progress indicator
  progress?: {
    current: number;
    total: number;
  };

  // Dashboard mode: status pills
  statusPills?: StatusPill[];

  // Dashboard/Context mode: search
  searchSlot?: React.ReactNode;
  searchScope?: string; // e.g., "Search this class"

  // Actions
  primaryActions?: React.ReactNode;
  secondaryActions?: React.ReactNode;

  // Dashboard mode: persistent actions
  onOpenProfile?: () => void;
  onOpenClasses?: () => void;
  onOpenCreateLesson?: () => void;

  // Dashboard mode: workflow entry points
  onOpenRecommendations?: () => void;
  onOpenTodos?: () => void;
}

// Shared button styles — light theme
const buttonBase: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "5px",
  padding: "5px 12px",
  border: "1px solid var(--border-subtle)",
  borderRadius: "6px",
  fontSize: "0.78rem",
  fontWeight: 500,
  cursor: "pointer",
  whiteSpace: "nowrap",
  transition: "background 0.15s, color 0.15s",
};

const workflowButtonStyle: React.CSSProperties = {
  ...buttonBase,
  background: "var(--surface-accent)",
  color: "var(--text-secondary)",
};

const headerButtonStyle: React.CSSProperties = {
  ...buttonBase,
  background: "transparent",
  color: "var(--text-secondary)",
};

function HeaderButton({
  onClick,
  children,
  variant = "header",
}: {
  onClick: () => void;
  children: React.ReactNode;
  variant?: "workflow" | "header";
}) {
  const style = variant === "workflow" ? workflowButtonStyle : headerButtonStyle;

  return (
    <button
      onClick={onClick}
      style={style}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "var(--surface-accent)";
        e.currentTarget.style.color = "var(--text-primary)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = variant === "workflow" ? "var(--surface-accent)" : "transparent";
        e.currentTarget.style.color = "var(--text-secondary)";
      }}
    >
      {children}
    </button>
  );
}

function Breadcrumbs({ items, homeLink }: { items: BreadcrumbItem[]; homeLink: string }) {
  const allCrumbs: BreadcrumbItem[] = [{ label: "Home", to: homeLink }, ...items];

  return (
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
            {i > 0 && (
              <span
                style={{
                  margin: "0 8px",
                  color: "var(--text-muted)",
                  fontSize: "0.75rem",
                  userSelect: "none",
                }}
              >
                /
              </span>
            )}
            {crumb.to ? (
              <Link
                to={crumb.to}
                state={crumb.state}
                style={{
                  color: isLast ? "var(--text-primary)" : "var(--text-secondary)",
                  textDecoration: "none",
                  fontWeight: isLast || isHome ? 500 : 400,
                  borderRadius: "4px",
                  padding: "2px 6px",
                  margin: "-2px -6px",
                  transition: "background 0.15s, color 0.15s",
                  overflow: isLast ? "hidden" : undefined,
                  textOverflow: isLast ? "ellipsis" : undefined,
                  whiteSpace: isLast ? "nowrap" : undefined,
                  maxWidth: isLast ? "300px" : undefined,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = "var(--text-primary)";
                  e.currentTarget.style.background = "var(--surface-accent)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = isLast ? "var(--text-primary)" : "var(--text-secondary)";
                  e.currentTarget.style.background = "transparent";
                }}
              >
                {crumb.label}
              </Link>
            ) : (
              <span
                style={{
                  color: "var(--text-primary)",
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
  );
}

function StatusPillButton({ pill }: { pill: StatusPill }) {
  const variantColors: Record<string, { bg: string; text: string; border: string }> = {
    default: { bg: "var(--surface-accent)", text: "var(--text-secondary)", border: "var(--border-subtle)" },
    warning: { bg: "var(--status-warning-bg)", text: "var(--status-warning-text)", border: "rgba(245,158,11,0.3)" },
    success: { bg: "var(--status-success-bg)", text: "var(--status-success-text)", border: "rgba(16,185,129,0.3)" },
    info: { bg: "var(--status-info-bg)", text: "var(--status-info-text)", border: "rgba(59,130,246,0.3)" },
  };

  const colors = variantColors[pill.variant || "default"];

  return (
    <button
      onClick={pill.onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
        padding: "4px 10px",
        background: colors.bg,
        color: colors.text,
        border: `1px solid ${colors.border}`,
        borderRadius: "16px",
        fontSize: "0.75rem",
        fontWeight: 500,
        cursor: "pointer",
        whiteSpace: "nowrap",
        transition: "background 0.15s, transform 0.1s",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = "scale(1.02)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "scale(1)";
      }}
    >
      {pill.label}
      {pill.count !== undefined && pill.count > 0 && (
        <span
          style={{
            background: colors.text,
            color: "white",
            borderRadius: "10px",
            padding: "0 6px",
            fontSize: "0.7rem",
            fontWeight: 600,
            minWidth: "18px",
            textAlign: "center",
          }}
        >
          {pill.count}
        </span>
      )}
    </button>
  );
}

function ProgressIndicator({ current, total }: { current: number; total: number }) {
  const percentage = total > 0 ? (current / total) * 100 : 0;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
      <span style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>
        {current} of {total}
      </span>
      <div
        style={{
          width: "80px",
          height: "4px",
          background: "var(--border-subtle)",
          borderRadius: "2px",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${percentage}%`,
            height: "100%",
            background: "var(--accent-primary)",
            borderRadius: "2px",
            transition: "width 0.3s ease",
          }}
        />
      </div>
    </div>
  );
}

export default function Header(props: HeaderProps) {
  const {
    mode,
    userType = "educator",
    userName,
    homeLink = userType === "educator" ? "/educator" : "/",
    breadcrumbs = [],
    backLink,
    backLabel = "Back",
    title,
    subtitle,
    progress,
    statusPills = [],
    searchSlot,
    primaryActions,
    secondaryActions,
    onOpenProfile,
    onOpenClasses,
    onOpenCreateLesson,
    onOpenRecommendations,
    onOpenTodos,
  } = props;

  // Mode-specific configuration
  const config = {
    dashboard: {
      height: "auto",
      showStatusPills: true,
      showSearch: true,
      showWorkflowButtons: true,
      showHeaderActions: true,
      showBreadcrumbs: true,
      visualEmphasis: "high",
    },
    context: {
      height: "auto",
      showStatusPills: false,
      showSearch: true,
      showWorkflowButtons: false,
      showHeaderActions: true,
      showBreadcrumbs: true,
      visualEmphasis: "medium",
    },
    focus: {
      height: "auto",
      showStatusPills: false,
      showSearch: false,
      showWorkflowButtons: false,
      showHeaderActions: false,
      showBreadcrumbs: false,
      visualEmphasis: "low",
    },
    session: {
      height: "auto",
      showStatusPills: false,
      showSearch: false,
      showWorkflowButtons: false,
      showHeaderActions: false,
      showBreadcrumbs: false,
      visualEmphasis: "minimal",
    },
    completion: {
      height: "auto",
      showStatusPills: false,
      showSearch: false,
      showWorkflowButtons: false,
      showHeaderActions: false,
      showBreadcrumbs: false,
      visualEmphasis: "subdued",
    },
  }[mode];

  // Header container styles — light, minimal
  const containerStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "12px",
    marginBottom: mode === "session" || mode === "completion" ? "8px" : "16px",
    minHeight: mode === "focus" || mode === "session" || mode === "completion" ? "32px" : "36px",
    flexWrap: "wrap",
    opacity: mode === "completion" ? 0.8 : 1,
    background: "transparent",
    padding: "10px 0",
    borderBottom: "1px solid var(--border-subtle)",
  };

  // Render based on mode
  if (mode === "session") {
    // Session mode: minimal, locked header for student lesson flow
    return (
      <nav style={containerStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px", flex: 1 }}>
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
              }}
            >
              ← {backLabel}
            </Link>
          )}
          {title && (
            <span
              style={{
                color: "var(--text-primary)",
                fontWeight: 500,
                fontSize: "0.9rem",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                maxWidth: "300px",
              }}
            >
              {title}
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          {primaryActions}
          {progress && <ProgressIndicator current={progress.current} total={progress.total} />}
        </div>
      </nav>
    );
  }

  if (mode === "completion") {
    // Completion mode: subdued, transition-focused
    return (
      <nav style={containerStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          {title && (
            <span
              style={{
                color: "var(--text-secondary)",
                fontWeight: 500,
                fontSize: "0.9rem",
              }}
            >
              {title}
            </span>
          )}
        </div>
        {backLink && (
          <Link
            to={backLink}
            style={{
              color: "var(--text-muted)",
              textDecoration: "none",
              fontSize: "0.8rem",
            }}
          >
            {backLabel}
          </Link>
        )}
      </nav>
    );
  }

  if (mode === "focus") {
    // Focus mode: minimal header for creation/editing
    return (
      <nav style={containerStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px", flex: 1 }}>
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
              }}
            >
              ← {backLabel}
            </Link>
          ) : (
            <Link
              to={homeLink}
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
              <span style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>/</span>
              <span
                style={{
                  color: "var(--text-primary)",
                  fontWeight: 500,
                  fontSize: "0.9rem",
                }}
              >
                {title}
              </span>
            </>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          {primaryActions}
          {userName && onOpenProfile && (
            <HeaderButton onClick={onOpenProfile} variant="header">
              {userName}
            </HeaderButton>
          )}
        </div>
      </nav>
    );
  }

  // Dashboard and Context modes share similar structure
  return (
    <nav style={containerStyle}>
      {/* Left: Breadcrumbs or title */}
      {config.showBreadcrumbs ? (
        <Breadcrumbs items={breadcrumbs} homeLink={homeLink} />
      ) : (
        <div style={{ flex: 1 }}>
          {title && (
            <span style={{ color: "var(--text-primary)", fontWeight: 500, fontSize: "1rem" }}>
              {title}
            </span>
          )}
        </div>
      )}

      {/* Right: Actions area */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          flexShrink: 0,
          flexWrap: "wrap",
          justifyContent: "flex-end",
        }}
      >
        {/* Status pills (dashboard mode only) */}
        {config.showStatusPills && statusPills.length > 0 && (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              {statusPills.map((pill, i) => (
                <StatusPillButton key={i} pill={pill} />
              ))}
            </div>
            <div
              style={{
                width: "1px",
                height: "20px",
                background: "var(--border-subtle)",
                marginLeft: "4px",
                marginRight: "4px",
              }}
            />
          </>
        )}

        {/* Workflow buttons (dashboard mode) */}
        {config.showWorkflowButtons && (
          <>
            {onOpenRecommendations && (
              <HeaderButton onClick={onOpenRecommendations} variant="workflow">
                Recommended Actions
              </HeaderButton>
            )}
            {onOpenTodos && (
              <HeaderButton onClick={onOpenTodos} variant="workflow">
                To-Dos
              </HeaderButton>
            )}
          </>
        )}

        {/* Secondary actions (page-specific) */}
        {secondaryActions}

        {/* Primary actions (page-specific) */}
        {primaryActions}

        {/* Header actions separator */}
        {config.showHeaderActions && (onOpenProfile || onOpenClasses || onOpenCreateLesson) && (
          <div
            style={{
              width: "1px",
              height: "20px",
              background: "var(--border-subtle)",
              marginLeft: "4px",
              marginRight: "4px",
            }}
          />
        )}

        {/* Header actions (dashboard/context modes) */}
        {config.showHeaderActions && (
          <>
            {onOpenProfile && (
              <HeaderButton onClick={onOpenProfile} variant="header">
                {userName || "Profile"}
              </HeaderButton>
            )}
            {onOpenClasses && (
              <HeaderButton onClick={onOpenClasses} variant="header">
                My Classes
              </HeaderButton>
            )}
            {onOpenCreateLesson && (
              <HeaderButton onClick={onOpenCreateLesson} variant="header">
                + Create Lesson
              </HeaderButton>
            )}
          </>
        )}

        {/* Search (dashboard/context modes) */}
        {config.showSearch && searchSlot}
      </div>
    </nav>
  );
}

// Re-export types for convenience
export type { BreadcrumbItem as HeaderBreadcrumbItem };
