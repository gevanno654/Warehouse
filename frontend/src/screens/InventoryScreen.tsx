/**
 * Current inventory listing.
 *
 * `GET /api/v1/inventory` reports persisted `availableQuantity` per product
 * with `search` and `page`/`limit` support. This is the stock balance — the
 * audit trail of how it got there lives on the transactions screen.
 */
import { useCallback, useEffect, useState, type FormEvent, type JSX } from "react";

import { useAuth } from "../auth/AuthContext.js";
import { Banner, EmptyState, LoadingState, Pager, ScreenHeader } from "../components/ui.js";
import {
  isSessionExpired,
  listInventory,
  userFacingMessage,
  type InventoryItem,
  type PageMeta,
} from "../services/api.js";

const PAGE_LIMIT = 20;

export function InventoryScreen(): JSX.Element {
  const { token, signOut } = useAuth();
  const [items, setItems] = useState<readonly InventoryItem[]>([]);
  const [meta, setMeta] = useState<PageMeta>({ page: 1, limit: PAGE_LIMIT, total: 0 });
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (page: number, searchTerm: string): Promise<void> => {
      if (token === null) {
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const result = await listInventory({
          token,
          page,
          limit: PAGE_LIMIT,
          search: searchTerm === "" ? undefined : searchTerm,
        });
        setItems(result.items);
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
  }

  return (
    <section aria-labelledby="inventory-heading">
      <ScreenHeader
        title="Inventory"
        description="Current available quantities. Receipts are the only stock movements."
      />
      <div className="toolbar" role="search">
        <form className="toolbar__form" onSubmit={handleSearch} aria-label="Search inventory">
          <label className="visually-hidden" htmlFor="inventory-search">
            Search by SKU or name
          </label>
          <input
            id="inventory-search"
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
        <LoadingState label="Loading inventory…" />
      ) : items.length === 0 ? (
        <EmptyState>No inventory rows found.</EmptyState>
      ) : (
        <>
          <div className="table-wrap">
            <table className="table">
              <caption id="inventory-heading" className="visually-hidden">
                Current inventory
              </caption>
              <thead>
                <tr>
                  <th scope="col">SKU</th>
                  <th scope="col">Name</th>
                  <th scope="col">Available</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.productId}>
                    <td>{item.sku}</td>
                    <td>{item.name}</td>
                    <td>{item.availableQuantity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager meta={meta} disabled={loading} onPage={(page) => void load(page, appliedSearch)} />
        </>
      )}
    </section>
  );
}
