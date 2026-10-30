/**
 * Receiving-document list.
 *
 * Reads `GET /api/v1/receiving-documents` with the contract's `status` and
 * `search` filters plus `page`/`limit` pagination. Rows link to the detail
 * screen by document id. Status text is rendered verbatim from the API — the
 * frontend never derives or assigns document states.
 */
import { useCallback, useEffect, useState, type FormEvent, type JSX } from "react";

import { useAuth } from "../auth/AuthContext.js";
import { Banner, EmptyState, LoadingState, Pager, ScreenHeader } from "../components/ui.js";
import {
  isSessionExpired,
  listDocuments,
  userFacingMessage,
  type DocumentStatus,
  type PageMeta,
  type ReceivingDocumentSummary,
} from "../services/api.js";

const PAGE_LIMIT = 20;

const STATUS_FILTERS: ReadonlyArray<{ value: "" | DocumentStatus; label: string }> = [
  { value: "", label: "All statuses" },
  { value: "PENDING", label: "Pending" },
  { value: "PARTIALLY_RECEIVED", label: "Partially received" },
  { value: "COMPLETED", label: "Completed" },
];

export function DocumentsScreen({ onOpen }: { onOpen: (id: string) => void }): JSX.Element {
  const { token, signOut } = useAuth();
  const [documents, setDocuments] = useState<readonly ReceivingDocumentSummary[]>([]);
  const [meta, setMeta] = useState<PageMeta>({ page: 1, limit: PAGE_LIMIT, total: 0 });
  const [status, setStatus] = useState<"" | DocumentStatus>("");
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (page: number, statusFilter: "" | DocumentStatus, searchTerm: string): Promise<void> => {
      if (token === null) {
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const result = await listDocuments({
          token,
          page,
          limit: PAGE_LIMIT,
          status: statusFilter,
          search: searchTerm === "" ? undefined : searchTerm,
        });
        setDocuments(result.documents);
        setMeta(result.meta);
      } catch (loadError) {
        if (isSessionExpired(loadError)) {
          signOut("Your session expired. Please sign in again.");
          return;
        }
        setError(userFacingMessage(loadError));
      } finally {
        setLoading(false);
      }
    },
    [token, signOut],
  );

  useEffect(() => {
    void load(1, status, appliedSearch);
  }, [load, status, appliedSearch]);

  function handleSearch(event: FormEvent): void {
    event.preventDefault();
    setAppliedSearch(search.trim());
    // `meta.page` resets through the effect-driven load on `appliedSearch`.
  }

  function handleStatusChange(next: "" | DocumentStatus): void {
    setStatus(next);
  }

  return (
    <section aria-labelledby="documents-heading">
      <ScreenHeader
        title="Receiving documents"
        description="Track expected versus received quantities per document."
      />
      <div className="toolbar" role="search">
        <form
          className="toolbar__form"
          onSubmit={handleSearch}
          aria-label="Search receiving documents"
        >
          <label className="visually-hidden" htmlFor="documents-search">
            Search by document number
          </label>
          <input
            id="documents-search"
            type="search"
            placeholder="Search document number…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <button type="submit" className="button button--secondary" disabled={loading}>
            Search
          </button>
        </form>
        <label className="toolbar__select">
          <span className="visually-hidden">Filter by status</span>
          <select
            value={status}
            onChange={(event) => handleStatusChange(event.target.value as "" | DocumentStatus)}
            disabled={loading}
          >
            {STATUS_FILTERS.map((option) => (
              <option key={option.value || "all"} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error === null ? null : <Banner tone="error">{error}</Banner>}
      {loading ? (
        <LoadingState label="Loading receiving documents…" />
      ) : documents.length === 0 ? (
        <EmptyState>No receiving documents found.</EmptyState>
      ) : (
        <>
          <div className="table-wrap">
            <table className="table">
              <caption id="documents-heading" className="visually-hidden">
                Receiving documents
              </caption>
              <thead>
                <tr>
                  <th scope="col">Document</th>
                  <th scope="col">Status</th>
                  <th scope="col">Items</th>
                  <th scope="col">Received</th>
                  <th scope="col">Created</th>
                </tr>
              </thead>
              <tbody>
                {documents.map((document) => (
                  <tr key={document.id}>
                    <td>
                      <button
                        type="button"
                        className="link-button"
                        onClick={() => onOpen(document.id)}
                      >
                        {document.documentNumber}
                      </button>
                    </td>
                    <td>
                      <span className="pill" data-status={document.status}>
                        {document.status.replaceAll("_", " ")}
                      </span>
                    </td>
                    <td>{document.totalItems}</td>
                    <td>
                      {document.totalReceivedQuantity} / {document.totalExpectedQuantity}
                    </td>
                    <td>{new Date(document.createdAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager
            meta={meta}
            disabled={loading}
            onPage={(page) => void load(page, status, appliedSearch)}
          />
        </>
      )}
    </section>
  );
}
