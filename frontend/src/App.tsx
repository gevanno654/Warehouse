import type { JSX } from "react";

import { BackendStatusIndicator } from "./components/BackendStatusIndicator.js";
import { API_BASE_URL } from "./config.js";
import { useBackendStatus } from "./hooks/useBackendStatus.js";

export default function App(): JSX.Element {
  const backendStatus = useBackendStatus();

  return (
    <div className="app">
      <header className="app__header">
        <h1 className="app__title">Warehouse Receiving System</h1>
        <p className="app__subtitle">Receiving, inventory, and transaction tracking.</p>
      </header>

      <main className="app__main">
        <section className="card" aria-labelledby="foundation-heading">
          <h2 id="foundation-heading" className="card__title">
            Project foundation
          </h2>
          <p className="card__body">
            The application shell is running. Product, receiving, inventory, and
            authentication features are delivered in later phases.
          </p>

          <dl className="details">
            <div className="details__row">
              <dt>API base URL</dt>
              <dd>{API_BASE_URL}</dd>
            </div>
            <div className="details__row">
              <dt>API documentation</dt>
              <dd>
                <a href={`${API_BASE_URL}/docs`} target="_blank" rel="noreferrer">
                  Swagger UI
                </a>
              </dd>
            </div>
          </dl>
        </section>

        <BackendStatusIndicator result={backendStatus} />
      </main>
    </div>
  );
}
