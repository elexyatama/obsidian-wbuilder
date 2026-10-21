import { drawSticker, type ResolvedSticker } from "./stickerPainter";

const TAU = Math.PI * 2;

/** Pin badge radius in CSS pixels for a zoom level (pixels per tile). */
export function pinRadius(scale: number): number {
	return Math.min(20, Math.max(7, scale * 0.6));
}

/** A round badge in the node type's color with the sticker on top. */
export function drawPin(
	ctx: CanvasRenderingContext2D,
	cx: number,
	cy: number,
	radius: number,
	color: string,
	sticker: ResolvedSticker,
): void {
	ctx.beginPath();
	ctx.arc(cx, cy, radius, 0, TAU);
	ctx.fillStyle = color;
	ctx.fill();
	ctx.lineWidth = 2;
	ctx.strokeStyle = "#ffffff";
	ctx.stroke();
	// below this size an emoji is an unreadable smudge, so show the plain colored dot
	if (radius >= 9) drawSticker(ctx, sticker, cx, cy, radius * 1.3);
}

/** A name under a pin, with a dark halo so it reads on any terrain. */
export function drawPinLabel(ctx: CanvasRenderingContext2D, text: string, cx: number, cy: number, radius: number): void {
	ctx.save();
	ctx.font = '600 12px "Inter", "Segoe UI", system-ui, sans-serif';
	ctx.textAlign = "center";
	ctx.textBaseline = "top";
	ctx.lineJoin = "round";
	ctx.lineWidth = 3.5;
	ctx.strokeStyle = "rgba(10, 14, 28, 0.85)";
	ctx.strokeText(text, cx, cy + radius + 3);
	ctx.fillStyle = "#ffffff";
	ctx.fillText(text, cx, cy + radius + 3);
	ctx.restore();
}
