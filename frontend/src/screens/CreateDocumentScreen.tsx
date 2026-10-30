/**
 * Receiving-document creation.
 *
 * One or more items (`productId` + positive-integer `expectedQuantity`).
 * Products are resolved through the existing `GET /api/v1/products` search so
 * the client never invents identifiers: the operator picks a searched product,
 * the form stores its id. The backend generates the document number and
 * validates quantities, duplicates, and unknown products — server rejections
 * (`400 INVALID_QUANTITY`, `404`, `409 DUPLICATE_DOCUMENT_ITEM`) render as
 * form errors. Success navigates to the new document's detail screen.
 */
import { useCallback, useEffect, useRef, useState, type FormEvent, type JSX } from "react";

import { useAuth } from "../auth/AuthContext.js";
import { Banner, LoadingState, ScreenHeader } from "../components/ui.js";
import {
  createDocument,
  isApiError,
  isSessionExpired,
  listProducts,
  userFacingMessage,
  type Product,
} from "../services/api.js";

interface DraftItem {
  readonly key: string;
  productId: string;
  sku: string;
  expectedQuantity: string;
}

interface SearchState {
  readonly query: string;
  readonly results: readonly Product[];
  readonly searching: boolean;
}

function newDraftItem(): DraftItem {
  // `crypto.randomUUID()` here is a local list key only, not an idempotency key.
  const key =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `row-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  return { key, productId: "", sku: "", expectedQuantity: "" };
}

export function CreateDocumentScreen({ onCreated }: { onCreated: (id: string) => void }): JSX.Element {
  const { token, signOut, user } = useAuth();
  const [items, setItems] = useState<readonly DraftItem[]>(() => [newDraftItem()]);
  const [search, setSearch] = useState<SearchState>({ query: "", results: [], searching: false });
  const [activeRow, setActiveRow] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const searchTimer = useRef<number | undefined>(undefined);

  const runSearch = useCallback(
    async (query: string): Promise<void> => {
      if (token === null || query.trim() === "") {
        setSearch((current) => ({ ...current, results: [], searching: false }));
        return;
      }
      setSearch((current) => ({ ...current, searching: true }));
      try {
        const result = await listProducts({ token, search: query.trim(), limit: 8 });
        setSearch((current) => ({ ...current, results: result.products, searching: false }));
      } catch (searchError) {
        if (isSessionExpired(searchError)) {
          signOut("Your session expired. Please sign in again.");
          return;
        }
        setSearch((current) => ({ ...current, results: [], searching: false }));
      }
    },
    [token, signOut],
  );

  useEffect(() => {
    window.clearTimeout(searchTimer.current);
    const query = search.query;
    if (query.trim() === "") {
      setSearch((current) => ({ ...current, results: [], searching: false }));
      return undefined;
    }
    searchTimer.current = window.setTimeout(() => {
      void runSearch(query);
    }, 250);
    return () => window.clearTimeout(searchTimer.current);
  }, [search.query, runSearch]);

  function updateItem(key: string, patch: Partial<DraftItem>): void {
    setItems((current) => current.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  }

  function pickProduct(rowKey: string, product: Product): void {
    updateItem(rowKey, { productId: product.id, sku: product.sku });
    setActiveRow(null);
    setSearch({ query: "", results: [], searching: false });
  }

  function addRow(): void {
    setItems((current) => [...current, newDraftItem()]);
  }

  function removeRow(key: string): void {
    setItems((current) => (current.length <= 1 ? current : current.filter((item) => item.key !== key)));
  }

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (submitting || token === null) {
      return;
    }

    const parsed = items.map((item) => ({
      productId: item.productId,
      expectedQuantity: Number(item.expectedQuantity),
    }));

    const invalid = parsed.some(
      (item) =>
        item.productId === "" ||
        !Number.isSafeInteger(item.expectedQuantity) ||
        item.expectedQuantity <= 0,
    );
    if (invalid || parsed.length === 0) {
      setError("Choose a product and a positive whole quantity for every row.");
      return;
    }

    const productIds = parsed.map((item) => item.productId);
    if (new Set(productIds).size !== productIds.length) {
      // Client-side mirror of the backend's `409 DUPLICATE_DOCUMENT_ITEM`;
      // the server remains authoritative.
      setError("A product may appear only once per document. Remove the duplicate row.");
      return;
    }

    setError(null);
    setSubmitting(true);
    try {
      const document = await createDocument(
        token,
        parsed.map((item) => ({
          productId: item.productId,
          expectedQuantity: Number(item.expectedQuantity),
        })),
      );
      onCreated(document.id);
    } catch (submitError) {
      if (isSessionExpired(submitError)) {
        signOut("Your session expired. Please sign in again.");
        return;
      }
      setError(userFacingMessage(submitError));
      if (isApiError(submitError) && submitError.status === 403) {
        // Operators cannot be surprised here: only supervisors see the link,
        // but the message must still explain the server's refusal.
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section aria-labelledby="create-document-heading">
      <ScreenHeader
        title="New receiving document"
        description={`Signed in as ${user?.email ?? "unknown"} (${user?.role ?? "unknown"}). The document number is generated by the backend.`}
      />
      {error === null ? null : <Banner tone="error">{error}</Banner>}
      <form onSubmit={(event) => void handleSubmit(event)}>
        <div className="rows">
          {items.map((item, index) => (
            <fieldset key={item.key} className="card row-card">
              <legend className="card__title">Item {index + 1}</legend>
              <div className="field">
                <label htmlFor={`product-${item.key}`}>Product</label>
                <input
                  id={`product-${item.key}`}
                  type="search"
                  autoComplete="off"
                  placeholder="Type a SKU or name…"
                  value={activeRow === item.key ? search.query : item.sku}
                  disabled={submitting}
                  onChange={(event) => {
                    setActiveRow(item.key);
                    setSearch((current) => ({ ...current, query: event.target.value }));
                  }}
                  onFocus={() => {
                    setActiveRow(item.key);
                    setSearch((current) => ({ ...current, query: item.sku }));
                  }}
                  aria-describedby={`product-help-${item.key}`}
                />
                <p id={`product-help-${item.key}`} className="help">
                  Search, then pick a product. SKUs are stored upper-cased by the backend.
                </p>
                {activeRow === item.key && search.query.trim() !== "" ? (
                  <ul className="suggestions" role="listbox" aria-label="Matching products">
                    {search.searching ? (
                      <li className="suggestions__item" aria-disabled="true">
                        <LoadingState label="Searching products…" />
                      </li>
                    ) : search.results.length === 0 ? (
                      <li className="suggestions__item" aria-disabled="true">
                        No products match.
                      </li>
                    ) : (
                      search.results.map((product) => (
                        <li key={product.id} role="option" aria-selected="false">
                          <button
                            type="button"
                            className="link-button"
                            onClick={() => pickProduct(item.key, product)}
                          >
                            {product.sku} — {product.name} (stock {product.availableQuantity})
                          </button>
                        </li>
                      ))
                    )}
                  </ul>
                ) : null}
              </div>
              <div className="field">
                <label htmlFor={`quantity-${item.key}`}>Expected quantity</label>
                <input
                  id={`quantity-${item.key}`}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  step={1}
                  required
                  value={item.expectedQuantity}
                  disabled={submitting}
                  onChange={(event) =>
                    updateItem(item.key, { expectedQuantity: event.target.value })
                  }
                />
              </div>
              <button
                type="button"
                className="button button--secondary"
                disabled={submitting || items.length <= 1}
                onClick={() => removeRow(item.key)}
              >
                Remove item
              </button>
            </fieldset>
          ))}
        </div>
        <div className="form-actions">
          <button
            type="button"
            className="button button--secondary"
            disabled={submitting}
            onClick={addRow}
          >
            Add item
          </button>
          <button type="submit" className="button" disabled={submitting}>
            {submitting ? "Creating…" : "Create document"}
          </button>
        </div>
      </form>
    </section>
  );
}
