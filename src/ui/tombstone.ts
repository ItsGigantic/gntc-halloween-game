import type { RunStats } from '../game/game';
import type { CardRender } from './cardScene';

export interface TombstoneOpts {
  name: string;
  stats: RunStats;
  card: CardRender;
  isBest: boolean;
  url: string;
  logo: HTMLImageElement | null;
}

const W = 1080;
const H = 1350;
const SANS = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const ORANGE = '#ff7602';

/**
 * Share card, 1080x1350. The rendered tombstone is the whole card: every number is carved
 * into it. Only a small header and the URL sit outside the 3D render.
 */
export async function renderTombstone(o: TombstoneOpts): Promise<HTMLCanvasElement> {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  ctx.textBaseline = 'middle';
  ctx.drawImage(o.card.image, 0, 0, W, H);

  // Soft bands top and bottom so the header and URL always read.
  const top = ctx.createLinearGradient(0, 0, 0, 150);
  top.addColorStop(0, 'rgba(0,0,21,0.85)');
  top.addColorStop(1, 'rgba(0,0,21,0)');
  ctx.fillStyle = top;
  ctx.fillRect(0, 0, W, 150);
  const bot = ctx.createLinearGradient(0, H - 190, 0, H);
  bot.addColorStop(0, 'rgba(0,0,21,0)');
  bot.addColorStop(1, 'rgba(0,0,21,0.92)');
  ctx.fillStyle = bot;
  ctx.fillRect(0, H - 190, W, 190);

  // Header: logo + title, left.
  const margin = 56;
  const hy = 68;
  if (o.logo) {
    const lh = 56;
    const lw = lh * (o.logo.naturalWidth / Math.max(1, o.logo.naturalHeight));
    ctx.drawImage(o.logo, margin, hy - lh / 2, lw, lh);
    ctx.textAlign = 'left';
    ctx.font = `600 28px ${SANS}`;
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fillText('Gigantic Gourd', margin + lw + 14, hy);
  }

  // Footer: the call to action.
  const fy = H - 64;
  const label = o.url.replace(/^https?:\/\//, '').replace(/^www\./, '');
  ctx.textAlign = 'center';
  ctx.font = `600 30px ${SANS}`;
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.fillText('Beat this score at', W / 2, fy - 38);
  ctx.font = `700 34px ${SANS}`;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(label, W / 2, fy + 4);
  const uw = ctx.measureText(label).width;
  ctx.fillStyle = ORANGE;
  ctx.beginPath();
  ctx.arc(W / 2 + uw / 2 + 16, fy + 12, 6, 0, Math.PI * 2);
  ctx.fill();
  return c;
}
