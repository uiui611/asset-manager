import { describe, expect, it } from "vitest";
import { tileRects } from "../../src/canvas/images";
import { encodeProperties, validateWriteSize } from "../../src/domain/metadata";
import type { MapProject, StoredFile } from "../../src/domain/models";
import { AssetSearch } from "../../src/domain/search";
import { validateProject } from "../../src/schemas/projects";

describe("asset metadata", () => {
  it("limits write size", () => {
    expect(() => validateWriteSize([1_000_000_001])).toThrow();
    expect(() => validateWriteSize([1_000_000_000])).not.toThrow();
  });
  it("allows long tags without Drive byte limits", () => {
    expect(() => encodeProperties({ tagIds: ["長いタグ".repeat(20)] })).not.toThrow();
    expect(() => encodeProperties({ tagIds: Array(51).fill("x") })).toThrow();
  });
});
describe("map schema and tile geometry", () => {
  const map: MapProject = {
    schemaVersion: 1,
    id: "map",
    name: "Map",
    width: 2,
    height: 2,
    tileWidth: 32,
    tileHeight: 32,
    tilesets: [{ assetId: "a" }],
    layers: [
      {
        id: "l",
        name: "Layer",
        visible: true,
        locked: false,
        opacity: 1,
        cells: [0, -1, -1, 0],
      },
    ],
    updatedAt: "2026-09-21",
  };
  it("validates cell counts and reference bounds", () => {
    expect(() => validateProject("map", map)).not.toThrow();
    expect(() =>
      validateProject("map", {
        ...map,
        layers: [{ ...map.layers[0], cells: [0, 1, -1, 0] }],
      }),
    ).toThrow("参照");
    expect(() =>
      validateProject("map", {
        ...map,
        layers: [{ ...map.layers[0], cells: [0] }],
      }),
    ).toThrow("セル");
  });
  it("rejects negative scale and malformed JSON", () => {
    expect(() =>
      validateProject("character", {
        schemaVersion: 1,
        id: "c",
        name: "c",
        updatedAt: "now",
        canvas: { width: 32, height: 32 },
        layers: [
          {
            id: "l",
            assetId: "a",
            x: 0,
            y: 0,
            scaleX: -1,
            scaleY: 1,
            rotation: 0,
            opacity: 1,
            visible: true,
            zIndex: 0,
          },
        ],
      }),
    ).toThrow();
    expect(() => validateProject("sound", {})).toThrow();
  });
  it("respects separate margins and spacing", () => {
    const options = {
      width: 16,
      height: 16,
      top: 2,
      right: 2,
      bottom: 2,
      left: 2,
      spacing: 1,
      skipEmpty: false,
      prefix: "tile",
    };
    expect(tileRects(37, 37, options)).toEqual([
      { x: 2, y: 2 },
      { x: 19, y: 2 },
      { x: 2, y: 19 },
      { x: 19, y: 19 },
    ]);
    expect(() => tileRects(37, 37, { ...options, width: 0 })).toThrow();
  });
});
it("searches 10,000 records with 20-tag intersections", () => {
  const files = Array.from(
    { length: 10000 },
    (_, i) =>
      ({
        assetId: `a${i}`,
        name: `素材 ${i}`,
        description: "森林 タイル",
        type: i % 2 ? "audio" : "image",
        fileId: `a${i}`,
        version: "1",
        mimeType: "image/png",
        size: 1,
        modifiedTime: "now",
        tagIds: Array.from({ length: 20 }, (_, j) => `t${j}`),
      }) as StoredFile,
  );
  const index = new AssetSearch(files);
  const start = performance.now();
  expect(index.find("", "image", "t15")).toHaveLength(5000);
  expect(index.find("素材 9876", "image", "t15")[0].assetId).toBe("a9876");
  expect(performance.now() - start).toBeLessThan(1000);
});
