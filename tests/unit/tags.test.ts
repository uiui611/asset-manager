import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AssetService, storage } from "../../src/application/asset-service";
import { db } from "../../src/database/db";
import type { StoredFile } from "../../src/domain/models";
import { AssetSearch } from "../../src/domain/search";

beforeEach(async () => {
  await db.open();
  vi.stubGlobal("navigator", { onLine: true });
  storage.connected = true;
});
afterEach(async () => {
  await db.delete();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("reuses trimmed names and persists the server tag ID", async () => {
  const service = new AssetService();
  const tag = { tagId: "server-id", name: "森", color: "green" };
  const create = vi.spyOn(storage, "createTag").mockResolvedValue(tag);
  expect(await service.createTag("  森  ")).toEqual(tag);
  expect(await db.tags.get("server-id")).toEqual(tag);
  expect(await service.createTag("森")).toEqual(tag);
  expect(create).toHaveBeenCalledExactlyOnceWith("森");
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
