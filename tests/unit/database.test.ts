import { afterEach, expect, it, vi } from "vitest";
import { AssetService, storage } from "../../src/application/asset-service";
import { SyncService } from "../../src/application/sync";
import type { StoredFile } from "../../src/domain/models";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const file = (id: string) =>
  ({
    assetId: id,
    fileId: id,
    version: "1",
    name: id,
    type: "json",
    mimeType: "application/json",
    size: 1,
    modifiedTime: "",
    tagIds: [],
    description: "",
  }) as StoredFile;

it("reads all API pages into memory without accessing browser databases", async () => {
  vi.stubGlobal("indexedDB", {
    open: () => {
      throw new Error("IndexedDB must not be opened");
    },
  });
  const listManagedFiles = vi
    .fn()
    .mockResolvedValueOnce({ files: [file("a")], nextCursor: "cursor" })
    .mockResolvedValueOnce({ files: [file("b")] });
  const files = await new SyncService({ listManagedFiles }).sync();
  expect(files.map((entry) => entry.assetId)).toEqual(["a", "b"]);
  expect(listManagedFiles.mock.calls.map((call) => call[0])).toEqual([undefined, "cursor"]);
});

it("does not replace the existing list when a later page fails", async () => {
  vi.stubGlobal("navigator", { onLine: true });
  storage.connected = true;
  const service = new AssetService();
  service.files = [file("saved")];
  vi.spyOn(storage, "listManagedFiles")
    .mockResolvedValueOnce({ files: [file("partial")], nextCursor: "next" })
    .mockRejectedValueOnce(new Error("offline"));
  await service.sync();
  expect(service.files.map((entry) => entry.assetId)).toEqual(["saved"]);
  expect(service.error).toContain("offline");
});

it("does not replace files when loading tags fails", async () => {
  vi.stubGlobal("navigator", { onLine: true });
  storage.connected = true;
  const service = new AssetService();
  service.files = [file("saved")];
  vi.spyOn(storage, "listManagedFiles").mockResolvedValue({ files: [file("new")] });
  vi.spyOn(storage, "listTags").mockRejectedValue(new Error("tags failed"));
  await service.sync();
  expect(service.files.map((entry) => entry.assetId)).toEqual(["saved"]);
});

it("keeps writes that finish while a list refresh is in progress", async () => {
  vi.stubGlobal("navigator", { onLine: true });
  storage.connected = true;
  const service = new AssetService();
  let release!: (value: { files: StoredFile[] }) => void;
  vi.spyOn(storage, "listManagedFiles").mockImplementation(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  vi.spyOn(storage, "listTags").mockResolvedValue([]);
  const refreshing = service.sync();
  await service.putFile(file("saved-during-refresh"));
  release({ files: [] });
  await refreshing;
  expect(service.files.map((entry) => entry.assetId)).toEqual(["saved-during-refresh"]);
});

it("does not reopen old operation records when a new service starts", async () => {
  const open = vi.fn(() => {
    throw new Error("old journal");
  });
  vi.stubGlobal("indexedDB", { open });
  const service = new AssetService();
  await service.refresh();
  expect(service.operations).toEqual([]);
  expect(open).not.toHaveBeenCalled();
});
