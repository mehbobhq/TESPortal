/**
 * Generic URL & Query-Parameter Deep-Linking Helpers for TES Portal.
 * Manages query-parameter synchronization without mutating or clobbering unrelated parameters.
 */

/**
 * Reads a specific record identifier or filter parameter from the current URL search string.
 */
export function getQueryParam(paramName: string, searchString?: string): string | null {
  const search = searchString ?? (typeof window !== "undefined" ? window.location.search : "");
  const params = new URLSearchParams(search);
  return params.get(paramName);
}

/**
 * Creates an updated search string setting or replacing a specific parameter, preserving all other parameters.
 */
export function setQueryParam(
  paramName: string,
  paramValue: string | null | undefined,
  currentSearchString?: string
): string {
  const search = currentSearchString ?? (typeof window !== "undefined" ? window.location.search : "");
  const params = new URLSearchParams(search);

  if (paramValue === null || paramValue === undefined || paramValue === "") {
    params.delete(paramName);
  } else {
    params.set(paramName, paramValue);
  }

  const str = params.toString();
  return str ? `?${str}` : "";
}

/**
 * Batch updates multiple query parameters while strictly preserving unspecified parameters.
 */
export function updateQueryParams(
  updates: Record<string, string | null | undefined>,
  currentSearchString?: string
): string {
  const search = currentSearchString ?? (typeof window !== "undefined" ? window.location.search : "");
  const params = new URLSearchParams(search);

  for (const [key, value] of Object.entries(updates)) {
    if (value === null || value === undefined || value === "") {
      params.delete(key);
    } else {
      params.set(key, value);
    }
  }

  const str = params.toString();
  return str ? `?${str}` : "";
}

/**
 * Softly syncs the browser URL search query without triggering a full page reload or component destruction.
 */
export function pushHistoryQueryParams(
  updates: Record<string, string | null | undefined>
): void {
  if (typeof window === "undefined" || !window.history) return;

  const newSearch = updateQueryParams(updates, window.location.search);
  const newUrl = `${window.location.pathname}${newSearch}${window.location.hash}`;
  window.history.replaceState({ ...window.history.state }, "", newUrl);
}
