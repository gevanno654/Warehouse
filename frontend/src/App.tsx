/**
 * Application shell.
 *
 * Authenticated users get the nav plus the hash-routed business screens;
 * everyone else gets the login form. Authorisation stays on the backend — a
 * supervisor-only links (document and product creation) are hidden for
 * operators as a courtesy, but the API's `403` is the real control and the
 * creation screens render their refusal messages if they ever arrive.
 */
import type { JSX } from "react";

import { routeHref, useRoute } from "./app/router.js";
import { AuthProvider, useAuth } from "./auth/AuthContext.js";
import { BackendStatusIndicator } from "./components/BackendStatusIndicator.js";
import { API_BASE_URL } from "./config.js";
import { useBackendStatus } from "./hooks/useBackendStatus.js";
import { CreateDocumentScreen } from "./screens/CreateDocumentScreen.js";
import { DocumentDetailScreen } from "./screens/DocumentDetailScreen.js";
import { DocumentsScreen } from "./screens/DocumentsScreen.js";
import { InventoryScreen } from "./screens/InventoryScreen.js";
import { LoginScreen } from "./screens/LoginScreen.js";
import { ProductsScreen } from "./screens/ProductsScreen.js";
import { TransactionsScreen } from "./screens/TransactionsScreen.js";

function Shell(): JSX.Element {
  const { user, ready, signOut, notice, dismissNotice } = useAuth();
  const backendStatus = useBackendStatus();
  const { route, navigate } = useRoute();

  if (!ready) {
    return (
      <div className="app">
        <header className="app__header">
          <h1 className="app__title">Warehouse Receiving System</h1>
        </header>
        <main className="app__main">
          <p className="state" role="status" aria-live="polite">
            Restoring your session…
          </p>
        </main>
      </div>
    );
  }

  if (user === null) {
    return (
      <div className="app">
        <header className="app__header">
          <h1 className="app__title">Warehouse Receiving System</h1>
          <p className="app__subtitle">Receiving, inventory, and transaction tracking.</p>
        </header>
        <main className="app__main">
          <LoginScreen />
          <BackendStatusIndicator result={backendStatus} />
        </main>
      </div>
    );
  }

  const isSupervisor = user.role === "SUPERVISOR";

  return (
    <div className="app">
      <header className="app__header app__header--nav">
        <div>
          <h1 className="app__title">Warehouse Receiving System</h1>
          <p className="app__subtitle">
            {user.email} · {user.role}
          </p>
        </div>
        <button
          type="button"
          className="button button--secondary"
          onClick={() => {
            dismissNotice();
            signOut();
            navigate({ name: "documents" });
          }}
        >
          Sign out
        </button>
      </header>

      {notice === null ? null : (
        <p className="banner banner--info" role="status">
          {notice}{" "}
          <button type="button" className="link-button" onClick={dismissNotice}>
            Dismiss
          </button>
        </p>
      )}

      <nav className="nav" aria-label="Primary">
        <a href={routeHref({ name: "documents" })} aria-current={route.name === "documents" ? "page" : undefined}>
          Documents
        </a>
        {isSupervisor ? (
          <a
            href={routeHref({ name: "new-document" })}
            aria-current={route.name === "new-document" ? "page" : undefined}
          >
            New document
          </a>
        ) : null}
        <a href={routeHref({ name: "products" })} aria-current={route.name === "products" ? "page" : undefined}>
          Products
        </a>
        <a href={routeHref({ name: "inventory" })} aria-current={route.name === "inventory" ? "page" : undefined}>
          Inventory
        </a>
        <a
          href={routeHref({ name: "transactions" })}
          aria-current={route.name === "transactions" ? "page" : undefined}
        >
          Transactions
        </a>
        <a href={`${API_BASE_URL}/docs`} target="_blank" rel="noreferrer" className="nav__external">
          API docs
        </a>
      </nav>

      <main className="app__main">
        {route.name === "documents" ? (
          <DocumentsScreen onOpen={(id) => navigate({ name: "document", id })} />
        ) : null}
        {route.name === "new-document" ? (
          <CreateDocumentScreen onCreated={(id) => navigate({ name: "document", id })} />
        ) : null}
        {route.name === "document" ? (
          <DocumentDetailScreen
            documentId={route.id}
            onBack={() => navigate({ name: "documents" })}
          />
        ) : null}
        {route.name === "products" ? <ProductsScreen /> : null}
        {route.name === "inventory" ? <InventoryScreen /> : null}
        {route.name === "transactions" ? <TransactionsScreen /> : null}
        {route.name === "not-found" ? (
          <section className="card" aria-labelledby="not-found-heading">
            <h2 id="not-found-heading" className="card__title">
              Page not found
            </h2>
            <p className="card__body">
              That view does not exist.{" "}
              <a href={routeHref({ name: "documents" })}>Back to receiving documents</a>.
            </p>
          </section>
        ) : null}
        <BackendStatusIndicator result={backendStatus} />
      </main>
    </div>
  );
}

export default function App(): JSX.Element {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  );
}
