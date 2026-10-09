import { track } from '../analytics';

export async function canvasToBlob(c: HTMLCanvasElement): Promise<Blob> {
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/png'));
}

export function download(blob: Blob, filename: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 2000);
  track('tombstone_download');
}

/** True when the Web Share API can share image files (mobile Safari/Chrome, some desktops). */
export function canShareFiles(): boolean {
  try {
    const f = new File([new Blob()], 't.png', { type: 'image/png' });
    return !!navigator.canShare && navigator.canShare({ files: [f] });
  } catch {
    return false;
  }
}

export async function shareTombstone(blob: Blob, text: string, url: string): Promise<boolean> {
  const file = new File([blob], 'gigantic-gourd-tombstone.png', { type: 'image/png' });
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Gigantic Gourd', text, url });
      track('share', { method: 'files' });
      return true;
    }
    if (navigator.share) {
      await navigator.share({ title: 'Gigantic Gourd', text, url });
      track('share', { method: 'text' });
      return true;
    }
  } catch {
    /* user cancelled or share failed; fall back to download */
  }
  return false;
}
