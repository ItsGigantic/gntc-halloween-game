/** Minimal analytics: pushes to dataLayer (GA4/GTM) and to a parent frame when embedded. */
export function track(event: string, params: Record<string, string | number | boolean> = {}): void {
  try {
    const w = window as unknown as { dataLayer?: unknown[] };
    const name = `gourd_${event}`;
    (w.dataLayer ??= []).push({ event: name, ...params });
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: 'gigantic-gourd', event: name, params }, '*');
    }
  } catch {
    /* never let analytics break the game */
  }
}
