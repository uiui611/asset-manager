import { expect, it } from "vitest";
import { referenceIds } from "../../src/domain/metadata";
import type { MapProject } from "../../src/domain/models";
import { tileSheetLayout } from "../../src/domain/tile-sheet";
import { validateProject } from "../../src/schemas/projects";

it("combines equal-sized cells without scaling and rejects mismatched dimensions", () => {
  expect(tileSheetLayout(Array(3).fill({ width: 16, height: 24 }), 2)).toEqual({
    width: 32,
    height: 48,
    tileWidth: 16,
    tileHeight: 24,
    columns: 2,
  });
  expect(() =>
    tileSheetLayout(
      [
        { width: 16, height: 24 },
        { width: 24, height: 16 },
      ],
      2,
    ),
  ).toThrow("一致");
  expect(() => tileSheetLayout([{ width: 4096, height: 4096 }], 2)).toThrow(
    "4096",
  );
  expect(() => tileSheetLayout([{ width: 16, height: 16 }], 1.5)).toThrow(
    "整数",
  );
});
it("validates per-layer sheet references while allowing missing source assets", () => {
  const map: MapProject = {
    schemaVersion: 1,
    id: "m",
    name: "",
    width: 1,
    height: 1,
    tileWidth: 16,
    tileHeight: 16,
    tilesets: [],
    updatedAt: "now",
    layers: ["a", "b"].map((id) => ({
      id,
      name: id,
      visible: true,
      opacity: 1,
      locked: false,
      cells: [3],
      tileset: { assetId: id, tileWidth: 16, tileHeight: 16 },
    })),
  };
  expect(() => validateProject("map", map)).not.toThrow();
  expect(referenceIds(map)).toEqual(["a", "b"]);
  if (map.layers[0].tileset) map.layers[0].tileset.tileWidth = 0;
  expect(() => validateProject("map", map)).toThrow();
});
