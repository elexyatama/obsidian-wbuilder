import { defaultStickerFor, findSticker, looksLikeEmoji } from "../core/stickers";

export interface ResolvedSticker {
	/** Emoji to draw. */
	glyph?: string;
	/** Id of a hand-drawn sticker in VECTOR_STICKERS; takes priority over `glyph`. */
	vector?: string;
	/** A loaded image (custom stickers from the vault); takes priority over everything. */
	image?: HTMLImageElement | HTMLCanvasElement | ImageBitmap;
}

/** Decides what a node's sticker looks like. Hosts wrap this to add image stickers. */
export type StickerResolver = (node: { icon?: string; type: string }) => ResolvedSticker;

const TAU = Math.PI * 2;
const EMOJI_FONT = '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';

type VectorArt = (ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) => void;

/** Top-down art for stickers that have no good emoji. */
const VECTOR_STICKERS: Record<string, VectorArt> = {
	well(ctx, cx, cy, r) {
		ctx.save();
		ctx.lineWidth = Math.max(1, r * 0.14);
		ctx.strokeStyle = "#3f4249";
		ctx.fillStyle = "#a3a7ae";
		ctx.beginPath();
		ctx.arc(cx, cy, r * 0.92, 0, TAU);
		ctx.fill();
		ctx.stroke();
		ctx.fillStyle = "#2c6cb0";
		ctx.beginPath();
		ctx.arc(cx, cy, r * 0.55, 0, TAU);
		ctx.fill();
		ctx.stroke();
		ctx.fillStyle = "rgba(255, 255, 255, 0.55)";
		ctx.beginPath();
		ctx.arc(cx - r * 0.17, cy - r * 0.17, r * 0.16, 0, TAU);
		ctx.fill();
		ctx.restore();
	},
};

const stickerOf = (id: string, glyph: string): ResolvedSticker => (VECTOR_STICKERS[id] ? { vector: id, glyph } : { glyph });

/** Built-in stickers, raw emoji, and the node type's default, in that order. */
export function resolveBuiltin(icon: string | undefined, type: string): ResolvedSticker {
	const sticker = findSticker(icon);
	if (sticker) return stickerOf(sticker.id, sticker.glyph);
	if (icon && looksLikeEmoji(icon)) return { glyph: icon };
	const fallback = defaultStickerFor(type);
	return stickerOf(fallback.id, fallback.glyph);
}

export const builtinResolver: StickerResolver = (node) => resolveBuiltin(node.icon, node.type);

/** Draws a sticker centered on (cx, cy) inside a square of `size` pixels. */
export function drawSticker(ctx: CanvasRenderingContext2D, sticker: ResolvedSticker, cx: number, cy: number, size: number): void {
	if (sticker.image) {
		const img = sticker.image;
		const w = "naturalWidth" in img ? img.naturalWidth : img.width;
		const h = "naturalHeight" in img ? img.naturalHeight : img.height;
		if (w > 0 && h > 0) {
			const k = size / Math.max(w, h);
			ctx.drawImage(img, cx - (w * k) / 2, cy - (h * k) / 2, w * k, h * k);
			return;
		}
	}
	const art = sticker.vector ? VECTOR_STICKERS[sticker.vector] : undefined;
	if (art) {
		art(ctx, cx, cy, size / 2);
		return;
	}
	if (sticker.glyph) {
		ctx.save();
		ctx.font = `${Math.round(size * 0.82)}px ${EMOJI_FONT}`;
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		ctx.fillText(sticker.glyph, cx, cy + size * 0.06);
		ctx.restore();
	}
}
