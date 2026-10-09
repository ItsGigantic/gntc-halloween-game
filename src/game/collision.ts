/** Uniform-grid spatial hash on the XZ plane for circle queries. */
export class SpatialHash<T extends { x: number; z: number }> {
  private cells = new Map<number, T[]>();
  constructor(private cellSize = 4) {}

  private key(cx: number, cz: number): number {
    return (cx + 32768) * 65536 + (cz + 32768);
  }
  private cell(v: number): number {
    return Math.floor(v / this.cellSize);
  }

  insert(item: T): void {
    const k = this.key(this.cell(item.x), this.cell(item.z));
    let arr = this.cells.get(k);
    if (!arr) this.cells.set(k, (arr = []));
    arr.push(item);
  }

  remove(item: T): void {
    const k = this.key(this.cell(item.x), this.cell(item.z));
    const arr = this.cells.get(k);
    if (!arr) return;
    const i = arr.indexOf(item);
    if (i >= 0) arr.splice(i, 1);
  }

  /** Call before changing an item's position. */
  move(item: T, nx: number, nz: number): void {
    const a = this.key(this.cell(item.x), this.cell(item.z));
    const b = this.key(this.cell(nx), this.cell(nz));
    if (a !== b) {
      this.remove(item);
      item.x = nx;
      item.z = nz;
      this.insert(item);
    } else {
      item.x = nx;
      item.z = nz;
    }
  }

  query(x: number, z: number, r: number, out: T[]): T[] {
    out.length = 0;
    const c0x = this.cell(x - r), c1x = this.cell(x + r);
    const c0z = this.cell(z - r), c1z = this.cell(z + r);
    for (let cx = c0x; cx <= c1x; cx++) {
      for (let cz = c0z; cz <= c1z; cz++) {
        const arr = this.cells.get(this.key(cx, cz));
        if (arr) for (const it of arr) out.push(it);
      }
    }
    return out;
  }

  clear(): void {
    this.cells.clear();
  }
}
