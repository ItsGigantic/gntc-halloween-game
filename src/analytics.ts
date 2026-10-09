/** Minimal analytics: pushes to dataLayer (GA4/GTM) and to a parent frame when embedded. */
export function track(event: string, params: Record<string, string | number | boolean> = {}): void {
  try {
    const w = window as unknown as { dataLayer?: unknown[] };
    (w.dataLayer ??= []).push({ event: `gourd_${event}`, ...params });
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: 'gigantic-gourd', event, params }, '*');
    }
  } catch {
    /* never let analytics break the game */
  }
}
