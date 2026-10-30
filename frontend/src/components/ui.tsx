/**
 * Shared screen primitives: status banner, loading/error/empty states, pager,
 * and the per-screen card layout. Keeps the business screens visually
 * consistent without a UI library.
 */
import type { JSX, ReactNode } from "react";

import type { PageMeta } from "../services/api.js";

export type BannerTone = "error" | "success" | "info";

export function Banner({
  tone,
  children,
}: {
  tone: BannerTone;
  children: ReactNode;
}): JSX.Element {
  return (
    <p className={`banner banner--${tone}`} role={tone === "error" ? "alert" : "status"}>
      {children}
    </p>
  );
}

export function LoadingState({ label }: { label: string }): JSX.Element {
  return (
    <p className="state" role="status" aria-live="polite">
      {label}
    </p>
  );
}

export function EmptyState({ children }: { children: ReactNode }): JSX.Element {
  return <p className="state">{children}</p>;
}

export function ScreenHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}): JSX.Element {
  return (
    <div className="screen-head">
      <div>
        <h2 className="screen-title">{title}</h2>
        {description === undefined ? null : <p className="screen-sub">{description}</p>}
      </div>
      {actions === undefined ? null : <div className="screen-actions">{actions}</div>}
    </div>
  );
}

export function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

export function Pager({
  meta,
  onPage,
  disabled,
}: {
  meta: PageMeta;
  onPage: (page: number) => void;
  disabled?: boolean;
}): JSX.Element | null {
  const totalPages = Math.max(1, Math.ceil(meta.total / meta.limit));
  if (totalPages <= 1) {
    return null;
  }
  return (
    <nav className="pager" aria-label="Pagination">
      <button
        type="button"
        className="button button--secondary"
        disabled={disabled === true || meta.page <= 1}
        onClick={() => onPage(meta.page - 1)}
      >
        Previous
      </button>
      <span className="pager__info" aria-live="polite">
        Page {meta.page} of {totalPages} · {meta.total} total
      </span>
      <button
        type="button"
        className="button button--secondary"
        disabled={disabled === true || meta.page >= totalPages}
        onClick={() => onPage(meta.page + 1)}
      >
        Next
      </button>
    </nav>
  );
}
