/**
 * Product management.
 *
 * `GET /api/v1/products` lists products with their persisted stock for both
 * roles, with the contract's `search` filter plus `page`/`limit` pagination.
 * `POST /api/v1/products` creates a product and is supervisor-only: the form
 * renders for supervisors alone, and the backend's `403` is the real control.
 * The form validates locally first (required fields, the contract's 100/255
 * length caps) and surfaces server rejections (`400 VALIDATION_ERROR`,
 * `409 DUPLICATE_SKU`) verbatim through `userFacingMessage`. A successful
 * create refreshes the list, so the new product is immediately available on
 * the New document screen, which searches the same endpoint.
 */
import { useCallback, useEffect, useState, type FormEvent, type JSX } from "react";

import { useAuth } from "../auth/AuthContext.js";
import { Banner, EmptyState, formatDateTime, LoadingState, Pager, ScreenHeader } from "../components/ui.js";
import {
  createProduct,
  isApiError,
  isSessionExpired,
  listProducts,
  userFacingMessage,
  type PageMeta,
  type Product,
} from "../services/api.js";

const PAGE_LIMIT = 20;

// Contract caps from `docs/openapi.yaml`: sku 1–100, name 1–255.
const MAX_SKU_LENGTH = 100;
const MAX_NAME_LENGTH = 255;

export function ProductsScreen(): JSX.Element {
  const { token, user, signOut } = useAuth();
  const [products, setProducts] = useState<readonly Product[]>([]);
  const [meta, setMeta] = useState<PageMeta>({ page: 1, limit: PAGE_LIMIT, total: 0 });
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [sku, setSku] = useState("");
  const [name, setName] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [formNotice, setFormNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const isSupervisor = user?.role === "SUPERVISOR";

  const load = useCallback(
    async (page: number, searchTerm: string): Promise<void> => {
      if (token === null) {
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const result = await listProducts({
          token,
          page,
          limit: PAGE_LIMIT,
          search: searchTerm === "" ? undefined : searchTerm,
        });
        setProducts(result.products);
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
    void load(1, appliedSearch);
  }, [load, appliedSearch]);

  function handleSearch(event: FormEvent): void {
    event.preventDefault();
    setAppliedSearch(search.trim());
    // `meta.page` resets through the effect-driven load on `appliedSearch`.
  }

  async function handleCreate(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (submitting || token === null) {
      return;
    }

    const trimmedSku = sku.trim();
    const trimmedName = name.trim();
    if (trimmedSku === "" || trimmedName === "") {
      setFormNotice(null);
      setFormError("SKU and product name are required.");
      return;
    }
    if (trimmedSku.length > MAX_SKU_LENGTH) {
      setFormNotice(null);
      setFormError(`SKU must be at most ${MAX_SKU_LENGTH} characters.`);
      return;
    }
    if (trimmedName.length > MAX_NAME_LENGTH) {
      setFormNotice(null);
      setFormError(`Product name must be at most ${MAX_NAME_LENGTH} characters.`);
      return;
    }

    setFormError(null);
    setFormNotice(null);
    setSubmitting(true);
    try {
      const created = await createProduct(token, { sku: trimmedSku, name: trimmedName });
      setSku("");
      setName("");
      setFormNotice(`Created ${created.sku} — ${created.name}.`);
      // Reload from page 1 so the new product shows immediately; the search
      // box state stays untouched.
      await load(1, appliedSearch);
    } catch (createError) {
      if (isSessionExpired(createError)) {
        signOut("Your session expired. Please sign in again.");
        return;
      }
      if (isApiError(createError) && createError.status === 403) {
        // Operators never see this form, but a hand-crafted request or a
        // demoted session still gets the server's message, not a guess.
      }
      setFormError(userFacingMessage(createError));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section aria-labelledby="products-heading">
      <ScreenHeader
        title="Products"
        description="Registered products with current stock. New products are available on the New document screen immediately."
      />

      {isSupervisor ? (
        <form className="card" onSubmit={(event) => void handleCreate(event)} aria-label="Add a product">
          <h3 className="card__title">Add product</h3>
          {formError === null ? null : <Banner tone="error">{formError}</Banner>}
          {formNotice === null ? null : <Banner tone="success">{formNotice}</Banner>}
          <div className="field">
            <label htmlFor="product-sku">SKU</label>
            <input
              id="product-sku"
              type="text"
              autoComplete="off"
              placeholder="e.g. DEMO-WIDGET-1"
              maxLength={MAX_SKU_LENGTH}
              required
              value={sku}
              onChange={(event) => setSku(event.target.value)}
              disabled={submitting}
            />
            <p className="help">
              Required, up to {MAX_SKU_LENGTH} characters. Stored upper-cased by the backend.
            </p>
          </div>
          <div className="field">
            <label htmlFor="product-name">Product name</label>
            <input
              id="product-name"
              type="text"
              autoComplete="off"
              placeholder="e.g. Demo Widget 1"
              maxLength={MAX_NAME_LENGTH}
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={submitting}
            />
            <p className="help">Required, up to {MAX_NAME_LENGTH} characters.</p>
          </div>
          <div className="form-actions">
            <button type="submit" className="button" disabled={submitting}>
              {submitting ? "Adding…" : "Add product"}
            </button>
          </div>
        </form>
      ) : null}

      <div className="toolbar" role="search">
        <form className="toolbar__form" onSubmit={handleSearch} aria-label="Search products">
          <label className="visually-hidden" htmlFor="products-search">
            Search by SKU or name
          </label>
          <input
            id="products-search"
            type="search"
            placeholder="Search SKU or name…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <button type="submit" className="button button--secondary" disabled={loading}>
            Search
          </button>
        </form>
      </div>

      {error === null ? null : <Banner tone="error">{error}</Banner>}
      {loading ? (
        <LoadingState label="Loading products…" />
      ) : products.length === 0 ? (
        <EmptyState>
          {appliedSearch === ""
            ? "No products registered yet. Supervisors can add the first one above."
            : "No products match this search."}
        </EmptyState>
      ) : (
        <>
          <div className="table-wrap">
            <table className="table">
              <caption id="products-heading" className="visually-hidden">
                Products
              </caption>
              <thead>
                <tr>
                  <th scope="col">SKU</th>
                  <th scope="col">Name</th>
                  <th scope="col">Available</th>
                  <th scope="col">Updated</th>
                </tr>
              </thead>
              <tbody>
                {products.map((product) => (
                  <tr key={product.id}>
                    <td>{product.sku}</td>
                    <td>{product.name}</td>
                    <td>{product.availableQuantity}</td>
                    <td>{formatDateTime(product.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager
            meta={meta}
            disabled={loading}
            onPage={(page) => void load(page, appliedSearch)}
          />
        </>
      )}
    </section>
  );
}
