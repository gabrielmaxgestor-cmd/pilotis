import { useSyncExternalStore } from 'react';

const UPDATE_EVENT = 'pilotis-view-url';

function subscribe(listener: () => void) {
  window.addEventListener('popstate', listener);
  window.addEventListener(UPDATE_EVENT, listener);
  return () => {
    window.removeEventListener('popstate', listener);
    window.removeEventListener(UPDATE_EVENT, listener);
  };
}

export function useViewSearch() {
  const search = useSyncExternalStore(subscribe, () => window.location.search, () => '');
  return new URLSearchParams(search);
}

export function updateViewUrl(
  values: Record<string, string | undefined>,
  options: { path?: string; push?: boolean } = {},
) {
  const url = new URL(window.location.href);
  if (options.path) { url.pathname = options.path; url.hash = ''; }
  for (const [key, value] of Object.entries(values)) {
    if (value) url.searchParams.set(key, value);
    else url.searchParams.delete(key);
  }
  if (url.href === window.location.href) return;
  if (options.push) window.history.pushState(null, '', url);
  else window.history.replaceState(window.history.state, '', url);
  window.dispatchEvent(new Event(UPDATE_EVENT));
}

export function useViewParam(key: string, fallback = '') {
  const value = useViewSearch().get(key) ?? fallback;
  const set = (next: string) => updateViewUrl({ [key]: next || undefined });
  return [value, set] as const;
}

export function useViewTab(scope: string, tabs: readonly string[], fallback = tabs[0]) {
  const key = scope + '.aba';
  const value = useViewSearch().get(key);
  const tab = value && tabs.includes(value) ? value : tabs.includes(fallback) ? fallback : tabs[0];
  return [tab, (next: string) => updateViewUrl({ [key]: next, registro: undefined }, { push: true })] as const;
}
