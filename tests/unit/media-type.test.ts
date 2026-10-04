import { describe, expect, it } from "vitest";
import { hasSvgRoot, imageMime, rasterMime } from "../../src/domain/media-type";

describe("media format identification", () => {
  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  it("prioritizes PNG signature over embedded SVG metadata and incorrect MIME", async () => {
    const file = new Blob([png, '<svg xmlns="http://www.w3.org/2000/svg">'], {
      type: "image/svg+xml",
    });
    expect(await imageMime(file)).toBe("image/png");
  });
  it("identifies formats even when the browser supplies no MIME", async () => {
    expect(await imageMime(new Blob([png]))).toBe("image/png");
    expect(rasterMime(new Uint8Array([255, 216, 255, 224]))).toBe("image/jpeg");
  });
  it("accepts XML prologs and comments only before the SVG root", () => {
    expect(
      hasSvgRoot(
        '\ufeff <?xml version="1.0"?>\n<!-- note -->\n<svg xmlns="http://www.w3.org/2000/svg">',
      ),
    ).toBe(true);
    expect(hasSvgRoot("binary metadata <svg>")).toBe(false);
    expect(hasSvgRoot("<html><svg>")).toBe(false);
    expect(hasSvgRoot("<svgx>")).toBe(false);
  });
  it("recognizes an SVG with a raster extension or generic MIME for sanitization", async () => {
    expect(
      await imageMime(
        new Blob(['<svg xmlns="http://www.w3.org/2000/svg"></svg>'], {
          type: "image/png",
        }),
      ),
    ).toBe("image/svg+xml");
    expect(
      await imageMime(new Blob(["<html>no image</html>"])),
    ).toBeUndefined();
  });
});
