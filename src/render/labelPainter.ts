import type { LabelSize, MapLabel } from "../core/mapFile";

/** Text height in tiles, so labels scale with the map like the terrain they name. */
const SIZE_IN_TILES: Record<LabelSize, number> = { s: 1.3, m: 2, l: 3.2, xl: 5 };

/** Below this many pixels a label is just a smudge, so it is not drawn (or clickable). */
export const MIN_LABEL_PX = 7;

export function labelFontPx(size: LabelSize, scale: number): number {
	return SIZE_IN_TILES[size] * scale;
}

function applyFont(ctx: CanvasRenderingContext2D, label: MapLabel, px: number): void {
	ctx.font = `${label.size === "s" ? 600 : 700} ${px}px "Inter", "Segoe UI", system-ui, sans-serif`;
	// big region names read better with the letters spread out
	if ("letterSpacing" in ctx) ctx.letterSpacing = label.size === "l" || label.size === "xl" ? `${(px * 0.1).toFixed(1)}px` : "0px";
}

/** Screen size of a label at a zoom level. */
export function measureLabel(ctx: CanvasRenderingContext2D, label: MapLabel, scale: number): { width: number; height: number } {
	const px = labelFontPx(label.size, scale);
	ctx.save();
	applyFont(ctx, label, px);
	const width = ctx.measureText(label.text || " ").width;
	ctx.restore();
	return { width, height: px };
}

/** Draws a label centered on (cx, cy), with a dark halo so it reads on any terrain. */
export function drawMapLabel(ctx: CanvasRenderingContext2D, label: MapLabel, cx: number, cy: number, scale: number): void {
	const px = labelFontPx(label.size, scale);
	if (px < MIN_LABEL_PX || !label.text) return;
	ctx.save();
	applyFont(ctx, label, px);
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.lineJoin = "round";
	ctx.lineWidth = Math.max(2, px * 0.18);
	ctx.strokeStyle = "rgba(8, 12, 26, 0.85)";
	ctx.strokeText(label.text, cx, cy);
	ctx.fillStyle = "#ffffff";
	ctx.fillText(label.text, cx, cy);
	ctx.restore();
}
