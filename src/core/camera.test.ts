import { describe, expect, it } from "vitest";
import { Camera } from "./camera";

function makeCamera() {
	const cam = new Camera();
	cam.setViewport(800, 600);
	cam.cx = 100;
	cam.cy = 50;
	cam.scale = 10;
	return cam;
}

describe("Camera", () => {
	it("round-trips screen and world coordinates", () => {
		const cam = makeCamera();
		const w = cam.screenToWorld(123, 456);
		const s = cam.worldToScreen(w.x, w.y);
		expect(s.x).toBeCloseTo(123);
		expect(s.y).toBeCloseTo(456);
	});

	it("maps the viewport center to the camera center", () => {
		const cam = makeCamera();
		expect(cam.screenToWorld(400, 300)).toEqual({ x: 100, y: 50 });
	});

	it("floors world coordinates to tiles, including negatives", () => {
		const cam = makeCamera();
		cam.cx = 0;
		cam.cy = 0;
		expect(cam.screenToTile(400 + 5, 300 + 5)).toEqual({ x: 0, y: 0 });
		expect(cam.screenToTile(400 - 1, 300 - 1)).toEqual({ x: -1, y: -1 });
	});

	it("pans by the dragged pixel distance", () => {
		const cam = makeCamera();
		cam.panByPixels(50, -20);
		expect(cam.cx).toBeCloseTo(95);
		expect(cam.cy).toBeCloseTo(52);
	});

	it("keeps the world point under the cursor fixed when zooming", () => {
		const cam = makeCamera();
		const before = cam.screenToWorld(200, 150);
		cam.zoomAt(200, 150, 2);
		const after = cam.screenToWorld(200, 150);
		expect(cam.scale).toBe(20);
		expect(after.x).toBeCloseTo(before.x);
		expect(after.y).toBeCloseTo(before.y);
	});

	it("clamps zoom to its limits", () => {
		const cam = makeCamera();
		cam.zoomAt(0, 0, 1000);
		expect(cam.scale).toBe(cam.maxScale);
		cam.zoomAt(0, 0, 1e-6);
		expect(cam.scale).toBe(cam.minScale);
	});

	it("centers on the middle of a tile", () => {
		const cam = makeCamera();
		cam.centerOn(12, 34);
		expect(cam.cx).toBe(12.5);
		expect(cam.cy).toBe(34.5);
	});

	it("reports the visible rectangle and clamps the center", () => {
		const cam = makeCamera();
		const r = cam.visibleRect();
		expect(r.x1 - r.x0).toBeCloseTo(80);
		expect(r.y1 - r.y0).toBeCloseTo(60);
		cam.cx = -50;
		cam.cy = 999;
		cam.clampCenter(256, 256);
		expect(cam.cx).toBe(0);
		expect(cam.cy).toBe(256);
	});
});
