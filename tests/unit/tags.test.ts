import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AssetService, storage } from "../../src/application/asset-service";
import type { StoredFile } from "../../src/domain/models";
import { AssetSearch } from "../../src/domain/search";

beforeEach(() => {
  vi.stubGlobal("navigator", { onLine: true });
  storage.connected = true;
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("reuses trimmed names and persists the server tag ID", async () => {
  const service = new AssetService();
  const tag = { tagId: "server-id", name: "森", color: "green" };
  const create = vi.spyOn(storage, "createTag").mockResolvedValue(tag);
  expect(await service.createTag("  森  ")).toEqual(tag);
  expect(service.tags).toEqual([tag]);
  expect(await service.createTag("森")).toEqual(tag);
  expect(create).toHaveBeenCalledTimes(1);
  expect(create.mock.calls[0][0]).toBe("森");
});
it("validates UTF-8 tag names before requesting creation", async () => {
  const service = new AssetService();
  const create = vi.spyOn(storage, "createTag");
  await expect(service.createTag("   ")).rejects.toThrow("タグ名を入力");
  await expect(service.createTag("森".repeat(34))).rejects.toThrow("100バイト");
  expect(create).not.toHaveBeenCalled();
});
it("searches user and default tag names while filtering by stable IDs", () => {
  const files = [
    {
      assetId: "a",
      name: "one.json",
      description: "",
      type: "json",
      tagIds: ["json", "custom-id"],
    },
    { assetId: "b", name: "two.json", description: "", type: "json", tagIds: ["json"] },
  ] as StoredFile[];
  const search = new AssetSearch(files, [
    { tagId: "json", name: "JSON", color: "green" },
    { tagId: "custom-id", name: "森の背景", color: "green" },
  ]);
  expect(search.find("森の背景").map((f) => f.assetId)).toEqual(["a"]);
  expect(search.find("JSON", "json", "custom-id").map((f) => f.assetId)).toEqual(["a"]);
  expect(search.find("", "", "custom-id").map((f) => f.assetId)).toEqual(["a"]);
});
