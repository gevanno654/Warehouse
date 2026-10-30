/**
 * Inventory transaction history.
 *
 * `GET /api/v1/inventory/transactions` returns the immutable `RECEIPT` audit
 * trail, newest first. Only the contract's filters are offered: `productId`
 * (resolved through the product search so the client sends a real UUID),
 * plus inclusive ISO 8601 `from`/`to` bounds entered as dates. Display fields
 * (`sku`, `quantityChange`, `documentNumber`, `performedBy`, `createdAt`)
 * come straight from the response — no invented totals or analytics.
 */
import { useCallback, useEffect, useState, type FormEvent, type JSX } from "react";

import { useAuth } from "../auth/AuthContext.js";
import { Banner, EmptyState, formatDateTime, LoadingState, Pager, ScreenHeader } from "../components/ui.js";
import {
  isSessionExpired,
  listProducts,
  listTransactions,
  userFacingMessage,
  type InventoryTransaction,
  type PageMeta,
} from "../services/api.js";

const PAGE_LIMIT = 20;

function toStartOfDayIso(date: string): string | undefined {
  if (date === "") {
    return undefined;
  }
  const parsed = new Date(`${date}T00:00:00.000`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function toEndOfDayIso(date: string): string | undefined {
  if (date === "") {
    return undefined;
  }
  const parsed = new Date(`${date}T23:59:59.999`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

export function TransactionsScreen(): JSX.Element {
  const { token, signOut } = useAuth();
  const [transactions, setTransactions] = useState<readonly InventoryTransaction[]>([]);
  const [meta, setMeta] = useState<PageMeta>({ page: 1, limit: PAGE_LIMIT, total: 0 });
  const [productSearch, setProductSearch] = useState("");
  const [appliedProductId, setAppliedProductId] = useState<string | undefined>(undefined);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [appliedRange, setAppliedRange] = useState<{ from?: string; to?: string }>({});
  const [productError, setProductError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (page: number, productId: string | undefined, range: { from?: string; to?: string }): Promise<void> => {
      if (token === null) {
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const result = await listTransactions({ token, page, limit: PAGE_LIMIT, ...range, productId });
        setTransactions(result.transactions);
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
    void load(1, appliedProductId, appliedRange);
  }, [load, appliedProductId, appliedRange]);

  async function handleProductFilter(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (token === null) {
      return;
    }
    const query = productSearch.trim();
    if (query === "") {
      setAppliedProductId(undefined);
      setProductError(null);
      return;
    }
    setProductError(null);
    try {
      const result = await listProducts({ token, search: query, limit: 5 });
      const match = result.products.find(
        (product) => product.sku.toUpperCase() === query.toUpperCase(),
      );
      if (match === undefined) {
        setProductError(
          result.products.length === 0
            ? "No product matches that SKU or name."
            : `No exact SKU match. ${result.products.length} similar product(s) found — refine to one exact SKU.`,
        );
        return;
      }
      setAppliedProductId(match.id);
    } catch (filterError) {
      if (isSessionExpired(filterError)) {
        signOut("Your session expired. Please sign in again.");
        return;
      }
      setProductError(userFacingMessage(filterError));
    }
  }

  function handleRangeFilter(event: FormEvent): void {
    event.preventDefault();
    const fromIso = toStartOfDayIso(from);
    const toIso = toEndOfDayIso(to);
    if ((from !== "" && fromIso === undefined) || (to !== "" && toIso === undefined)) {
      setError("Use valid calendar dates for the transaction filters.");
      return;
    }
    setError(null);
    setAppliedRange({ ...(fromIso === undefined ? {} : { from: fromIso }), ...(toIso === undefined ? {} : { to: toIso }) });
  }

  function clearFilters(): void {
    setProductSearch("");
    setAppliedProductId(undefined);
    setFrom("");
    setTo("");
    setAppliedRange({});
    setProductError(null);
  }

  return (
    <section aria-labelledby="transactions-heading">
      <ScreenHeader
        title="Transaction history"
        description="Every receipt, newest first. Filter by product or date."
      />
      <div className="filters">
        <form className="toolbar__form" onSubmit={(event) => void handleProductFilter(event)} aria-label="Filter by product">
          <label className="visually-hidden" htmlFor="transactions-product">
            Filter by exact product SKU
          </label>
          <input
            id="transactions-product"
            type="search"
            placeholder="Filter by exact SKU…"
            value={productSearch}
            onChange={(event) => setProductSearch(event.target.value)}
          />
          <button type="submit" className="button button--secondary" disabled={loading}>
            Apply product
          </button>
        </form>
        <form className="toolbar__form" onSubmit={handleRangeFilter} aria-label="Filter by date">
          <label htmlFor="transactions-from">From</label>
          <input
            id="transactions-from"
            type="date"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
          />
          <label htmlFor="transactions-to">To</label>
          <input
            id="transactions-to"
            type="date"
            value={to}
            onChange={(event) => setTo(event.target.value)}
          />
          <button type="submit" className="button button--secondary" disabled={loading}>
            Apply dates
          </button>
          <button
            type="button"
            className="button button--secondary"
            disabled={loading}
            onClick={clearFilters}
          >
            Clear
          </button>
        </form>
      </div>
      {productError === null ? null : <Banner tone="error">{productError}</Banner>}
      {error === null ? null : <Banner tone="error">{error}</Banner>}

      {loading ? (
        <LoadingState label="Loading transactions…" />
      ) : transactions.length === 0 ? (
        <EmptyState>No transactions found for these filters.</EmptyState>
      ) : (
        <>
          <div className="table-wrap">
            <table className="table">
              <caption id="transactions-heading" className="visually-hidden">
                Inventory transactions
              </caption>
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">SKU</th>
                  <th scope="col">Change</th>
                  <th scope="col">Document</th>
                  <th scope="col">Performed by</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((row) => (
                  <tr key={row.id}>
                    <td>{formatDateTime(row.createdAt)}</td>
                    <td>{row.sku}</td>
                    <td>+{row.quantityChange}</td>
                    <td>{row.documentNumber}</td>
                    <td>{row.performedBy}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager
            meta={meta}
            disabled={loading}
            onPage={(page) => void load(page, appliedProductId, appliedRange)}
          />
        </>
      )}
    </section>
  );
}
