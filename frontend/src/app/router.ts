/**
 * Hash routing for the application shell.
 *
 * Hash routes (`#/documents`, …) keep deep-linking and back-button behaviour
 * without any server rewrite rules — the static `web` container serves one
 * `index.html` and never sees the fragment. Screens below are the contract
 * surface only: documents, creation, products, inventory, transactions.
 */
import { useCallback, useEffect, useState } from "react";

export type Route =
  | { readonly name: "documents" }
  | { readonly name: "new-document" }
  | { readonly name: "document"; readonly id: string }
  | { readonly name: "products" }
  | { readonly name: "inventory" }
  | { readonly name: "transactions" }
  | { readonly name: "not-found" };

const DEFAULT_ROUTE: Route = { name: "documents" };

export function parseHash(hash: string): Route {
  const path = hash.startsWith("#") ? hash.slice(1) : hash;
  const [rawPath] = path.split("?");
  const segments = (rawPath ?? "").split("/").filter((segment) => segment !== "");

  if (segments.length === 0) {
    return DEFAULT_ROUTE;
  }

  const [first, second] = segments;
  if (first === "documents" && segments.length === 1) {
    return { name: "documents" };
  }
  if (first === "documents" && second === "new" && segments.length === 2) {
    return { name: "new-document" };
  }
  if (first === "documents" && typeof second === "string" && segments.length === 2) {
    return { name: "document", id: second };
  }
  if (first === "products" && segments.length === 1) {
    return { name: "products" };
  }
  if (first === "inventory" && segments.length === 1) {
    return { name: "inventory" };
  }
  if (first === "transactions" && segments.length === 1) {
    return { name: "transactions" };
  }
  return { name: "not-found" };
}

export function routeHref(route: Route): string {
  switch (route.name) {
    case "documents":
      return "#/documents";
    case "new-document":
      return "#/documents/new";
    case "document":
      return `#/documents/${route.id}`;
    case "products":
      return "#/products";
    case "inventory":
      return "#/inventory";
    case "transactions":
      return "#/transactions";
    case "not-found":
      return "#/documents";
  }
}

/** Tracks the current hash route; defaults to the document list. */
export function useRoute(): { route: Route; navigate: (route: Route) => void } {
  const [route, setRoute] = useState<Route>(() =>
    typeof window === "undefined" ? DEFAULT_ROUTE : parseHash(window.location.hash),
  );

  useEffect(() => {
    const onChange = (): void => setRoute(parseHash(window.location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  const navigate = useCallback((next: Route): void => {
    window.location.hash = routeHref(next).slice(1);
    setRoute(next);
  }, []);

  return { route, navigate };
}
