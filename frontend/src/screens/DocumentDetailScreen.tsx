/**
 * Receiving-document detail with receipt submission.
 *
 * Shows the persisted items (expected / received / remaining) and posts
 * receipts to `POST .../items/{itemId}/receipts` with an `Idempotency-Key`.
 * Key discipline: minting happens once per receipt *attempt* (when the form
 * opens); submitting retries the same attempt with the same key, whether the
 * retry is a manual "try again" after a network failure or an automatic
 * re-send. Editing the quantity or switching items starts a new logical
 * operation with a fresh key. The receipt result view only appears after the
 * API confirms success — nothing here implies success beforehand.
 */
import { useCallback, useEffect, useState, type FormEvent, type JSX } from "react";

import { useAuth } from "../auth/AuthContext.js";
import {
  Banner,
  EmptyState,
  formatDateTime,
  LoadingState,
  ScreenHeader,
} from "../components/ui.js";
import {
  getDocument,
  isApiError,
  isSessionExpired,
  recordReceipt,
  userFacingMessage,
  type ReceiptResult,
  type ReceivingDocument,
  type ReceivingItem,
} from "../services/api.js";
import { newIdempotencyKey } from "../services/idempotency.js";

function ReceiptForm({
  token,
  documentId,
  item,
  signOut,
  onRecorded,
}: {
  token: string;
  documentId: string;
  item: ReceivingItem;
  signOut: (notice?: string) => void;
  onRecorded: (result: ReceiptResult) => void;
}): JSX.Element {
  const [quantity, setQuantity] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState<string>(() => newIdempotencyKey());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A new quantity, item, or document is a new logical operation: fresh key.
  function handleQuantityChange(next: string): void {
    if (next !== quantity) {
      setQuantity(next);
      setIdempotencyKey(newIdempotencyKey());
      setError(null);
    }
  }

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (submitting) {
      return;
    }

    const parsed = Number(quantity);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
      setError("Enter a positive whole quantity.");
      return;
    }

    setError(null);
    setSubmitting(true);
    try {
      // Same `idempotencyKey` for every submit of this attempt: a retry after
      // a dropped connection replays instead of double-applying.
      const result = await recordReceipt({
        token,
        documentId,
        itemId: item.id,
        quantity: parsed,
        idempotencyKey,
      });
      setQuantity("");
      setIdempotencyKey(newIdempotencyKey());
      onRecorded(result);
    } catch (submitError) {
      if (isSessionExpired(submitError)) {
        signOut("Your session expired. Please sign in again.");
        return;
      }
      // `409 IDEMPOTENCY_KEY_CONFLICT` here means this key was already used
      // for a different payload — start the next attempt with a fresh key so
      // the operator is not stuck retrying a poisoned one.
      if (isApiError(submitError) && submitError.code === "IDEMPOTENCY_KEY_CONFLICT") {
        setIdempotencyKey(newIdempotencyKey());
      }
      setError(userFacingMessage(submitError));
    } finally {
      setSubmitting(false);
    }
  }

  const fullyReceived = item.remainingQuantity <= 0;

  return (
    <form className="receipt-form" onSubmit={(event) => void handleSubmit(event)}>
      <div className="field field--inline">
        <label htmlFor={`receipt-${item.id}`}>Receive quantity</label>
        <input
          id={`receipt-${item.id}`}
          type="number"
          inputMode="numeric"
          min={1}
          step={1}
          required
          // No `max`: the backend owns the remaining-quantity rule and reports
          // the exact remainder in its `422` response; a native clamp would
          // hide that guidance behind a generic browser message.
          placeholder={`Up to ${item.remainingQuantity}`}
          value={quantity}
          disabled={submitting || fullyReceived}
          onChange={(event) => handleQuantityChange(event.target.value)}
        />
      </div>
      {error === null ? null : <Banner tone="error">{error}</Banner>}
      <button type="submit" className="button" disabled={submitting || fullyReceived}>
        {submitting ? "Recording…" : fullyReceived ? "Fully received" : "Record receipt"}
      </button>
    </form>
  );
}

export function DocumentDetailScreen({
  documentId,
  onBack,
}: {
  documentId: string;
  onBack: () => void;
}): JSX.Element {
  const { token, signOut } = useAuth();
  const [document, setDocument] = useState<ReceivingDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastReceipt, setLastReceipt] = useState<ReceiptResult | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    if (token === null) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setDocument(await getDocument(token, documentId));
    } catch (loadError) {
      if (isSessionExpired(loadError)) {
        signOut("Your session expired. Please sign in again.");
        return;
      }
      setError(userFacingMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, [token, documentId, signOut]);

  useEffect(() => {
    void load();
  }, [load]);

  function handleRecorded(result: ReceiptResult): void {
    // Refresh from the server so quantities and status reflect persisted rows,
    // not optimistic arithmetic. The result banner confirms the API's reply.
    setLastReceipt(result);
    setSuccess(
      `Recorded ${result.quantityReceivedNow} unit(s) for ${result.documentNumber}. ` +
        `Document is now ${result.documentStatus.replaceAll("_", " ")}.`,
    );
    void load();
  }

  return (
    <section aria-labelledby="document-detail-heading">
      <ScreenHeader
        title="Receiving document"
        actions={
          <button type="button" className="button button--secondary" onClick={onBack}>
            Back to list
          </button>
        }
      />
      {error === null ? null : <Banner tone="error">{error}</Banner>}
      {success === null ? null : <Banner tone="success">{success}</Banner>}
      {loading ? (
        <LoadingState label="Loading document…" />
      ) : document === null ? (
        <EmptyState>The document could not be loaded.</EmptyState>
      ) : (
        <>
          <div className="card" aria-label="Document summary">
            <h3 id="document-detail-heading" className="card__title">
              {document.documentNumber}
            </h3>
            <dl className="details">
              <div className="details__row">
                <dt>Status</dt>
                <dd>
                  <span className="pill" data-status={document.status}>
                    {document.status.replaceAll("_", " ")}
                  </span>
                </dd>
              </div>
              <div className="details__row">
                <dt>Created by</dt>
                <dd>
                  {document.createdBy.email} ({document.createdBy.role})
                </dd>
              </div>
              <div className="details__row">
                <dt>Created</dt>
                <dd>{formatDateTime(document.createdAt)}</dd>
              </div>
              <div className="details__row">
                <dt>Progress</dt>
                <dd>
                  {document.totalReceivedQuantity} / {document.totalExpectedQuantity} received
                  across {document.totalItems} item(s)
                </dd>
              </div>
            </dl>
          </div>

          {lastReceipt === null ? null : (
            <div className="card" aria-label="Last receipt result">
              <h3 className="card__title">Last receipt</h3>
              <dl className="details">
                <div className="details__row">
                  <dt>Received now</dt>
                  <dd>{lastReceipt.quantityReceivedNow}</dd>
                </div>
                <div className="details__row">
                  <dt>Cumulative</dt>
                  <dd>{lastReceipt.cumulativeReceivedQuantity}</dd>
                </div>
                <div className="details__row">
                  <dt>Remaining</dt>
                  <dd>{lastReceipt.remainingQuantity}</dd>
                </div>
                <div className="details__row">
                  <dt>Available stock</dt>
                  <dd>{lastReceipt.availableStock}</dd>
                </div>
              </dl>
            </div>
          )}

          <div className="table-wrap">
            <table className="table">
              <caption className="visually-hidden">Document items and receipt forms</caption>
              <thead>
                <tr>
                  <th scope="col">Product</th>
                  <th scope="col">Expected</th>
                  <th scope="col">Received</th>
                  <th scope="col">Remaining</th>
                  <th scope="col">Record receipt</th>
                </tr>
              </thead>
              <tbody>
                {document.items.map((item) => (
                  <tr key={item.id}>
                    <td>
                      {item.sku} — {item.productName}
                    </td>
                    <td>{item.expectedQuantity}</td>
                    <td>{item.receivedQuantity}</td>
                    <td>{item.remainingQuantity}</td>
                    <td>
                      {token === null ? null : (
                        <ReceiptForm
                          token={token}
                          documentId={document.id}
                          item={item}
                          signOut={signOut}
                          onRecorded={handleRecorded}
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
