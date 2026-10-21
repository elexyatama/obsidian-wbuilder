export interface Vec2 {
	x: number;
	y: number;
}

/** Axis-aligned rectangle in world (tile) units. */
export interface Rect {
	x0: number;
	y0: number;
	x1: number;
	y1: number;
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/**
 * Pan/zoom transform between screen pixels (CSS px, origin top-left of the canvas)
 * and world units (1 unit = 1 tile, tile (x, y) covers [x, x+1) x [y, y+1)).
 * Pure math, no DOM, so it works the same in every host.
 */
export class Camera {
	/** World point shown at the center of the viewport. */
	cx = 0;
	cy = 0;
	/** Pixels per tile. */
	scale = 8;
	viewW = 0;
	viewH = 0;

	constructor(
		readonly minScale = 2,
		readonly maxScale = 96,
	) {}

	setViewport(w: number, h: number): void {
		this.viewW = w;
		this.viewH = h;
	}

	screenToWorld(sx: number, sy: number): Vec2 {
		return {
			x: this.cx + (sx - this.viewW / 2) / this.scale,
			y: this.cy + (sy - this.viewH / 2) / this.scale,
		};
	}

	worldToScreen(wx: number, wy: number): Vec2 {
		return {
			x: (wx - this.cx) * this.scale + this.viewW / 2,
			y: (wy - this.cy) * this.scale + this.viewH / 2,
		};
	}

	screenToTile(sx: number, sy: number): Vec2 {
		const w = this.screenToWorld(sx, sy);
		return { x: Math.floor(w.x), y: Math.floor(w.y) };
	}

	panByPixels(dx: number, dy: number): void {
		this.cx -= dx / this.scale;
		this.cy -= dy / this.scale;
	}

	/** Zoom by `factor`, keeping the world point under (sx, sy) fixed on screen. */
	zoomAt(sx: number, sy: number, factor: number): void {
		const before = this.screenToWorld(sx, sy);
		this.scale = clamp(this.scale * factor, this.minScale, this.maxScale);
		this.cx = before.x - (sx - this.viewW / 2) / this.scale;
		this.cy = before.y - (sy - this.viewH / 2) / this.scale;
	}

	/** Center on the middle of tile (tx, ty). */
	centerOn(tx: number, ty: number): void {
		this.cx = tx + 0.5;
		this.cy = ty + 0.5;
	}

	/** Keep the view center inside [0, maxX] x [0, maxY]. */
	clampCenter(maxX: number, maxY: number): void {
		this.cx = clamp(this.cx, 0, maxX);
		this.cy = clamp(this.cy, 0, maxY);
	}

	visibleRect(): Rect {
		const halfW = this.viewW / 2 / this.scale;
		const halfH = this.viewH / 2 / this.scale;
		return { x0: this.cx - halfW, y0: this.cy - halfH, x1: this.cx + halfW, y1: this.cy + halfH };
	}
}
