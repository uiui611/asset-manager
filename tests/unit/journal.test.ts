import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AssetService, storage } from "../../src/application/asset-service";
import { db } from "../../src/database/db";
import type { StoredFile } from "../../src/domain/models";

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
it("restarts only unfinished items and releases completed blobs", async () => {
  const service = new AssetService();
  const create = vi.spyOn(storage, "createFile").mockImplementation(async (input) => {
    if (input.metadata.assetId === "b") throw new Error("network");
    return {
      ...input.metadata,
      fileId: `d-${input.metadata.assetId}`,
      version: "1",
      modifiedTime: "now",
      size: 1,
      tagIds: [],
      description: "",
    } as StoredFile;
  });
  const items = ["a", "b"].map((id) => ({
    id,
    name: `${id}.png`,
    blob: new Blob(["x"]),
    metadata: { assetId: id },
  }));
  await expect(service.startOperation("upload", items)).rejects.toThrow("network");
  const journal = (await db.operationJournal.toArray())[0];
  expect(journal.completedItems).toEqual(["a"]);
  expect(journal.pendingItems).toEqual(["b"]);
  expect(journal.items[0].blob).toBeUndefined();
  create.mockImplementation(
    async (input) =>
      ({
        ...input.metadata,
        fileId: `d-${input.metadata.assetId}`,
        version: "1",
        modifiedTime: "now",
        size: 1,
        tagIds: [],
        description: "",
      }) as StoredFile,
  );
  await service.resume(journal.id);
  expect(create.mock.calls.map((c) => c[0].metadata.assetId)).toEqual(["a", "b", "b"]);
  expect((await db.operationJournal.get(journal.id))?.status).toBe("completed");
  expect(await db.assets.count()).toBe(2);
});
it("rejects total overflow before creating journal or making requests", async () => {
  const service = new AssetService();
  const create = vi.spyOn(storage, "createFile");
  await expect(
    service.startOperation("upload", [
      { id: "a", name: "a", blob: { size: 600000000 } as Blob },
      { id: "b", name: "b", blob: { size: 600000000 } as Blob },
    ]),
  ).rejects.toThrow("1 GB");
  expect(await db.operationJournal.count()).toBe(0);
  expect(create).not.toHaveBeenCalled();
});

it("retries deletion with journal version after metadata disappears from cache", async () => {
  const service = new AssetService();
  const remove = vi
    .spyOn(storage, "trashFile")
    .mockRejectedValueOnce(new Error("connection lost"))
    .mockResolvedValue(undefined);
  await expect(
    service.startOperation("bulk-trash", [
      {
        id: "retry-delete",
        name: "test.png",
        fileId: "retry-delete",
        metadata: { version: "2" },
      },
    ]),
  ).rejects.toThrow("connection lost");
  const journal = (await db.operationJournal.toArray())[0];
  await service.resume(journal.id);
  expect(remove.mock.calls).toEqual([
    ["retry-delete", "2"],
    ["retry-delete", "2"],
  ]);
  expect((await db.operationJournal.get(journal.id))?.status).toBe("completed");
});

it("limits saves to two workers, reports progress and drains in-flight work on cancel", async () => {
  const service = new AssetService();
  let active = 0,
    peak = 0;
  const release: (() => void)[] = [];
  const create = vi.spyOn(storage, "createFile").mockImplementation(async (input) => {
    active++;
    peak = Math.max(peak, active);
    await new Promise<void>((resolve) => release.push(resolve));
    active--;
    return {
      ...input.metadata,
      fileId: input.metadata.assetId,
      version: "1",
      modifiedTime: "now",
      size: 1,
      tagIds: [],
      description: "",
    } as StoredFile;
  });
  const work = service.startOperation(
    "tile-split",
    Array.from({ length: 7 }, (_, i) => ({
      id: String(i),
      name: `${i}.png`,
      blob: new Blob(["x"]),
      metadata: { assetId: String(i) },
    })),
  );
  await vi.waitFor(() => expect(release).toHaveLength(2));
  expect(service.transfers[0]).toMatchObject({ done: 0, total: 7 });
  service.cancel();
  for (const fn of release) fn();
  expect(await work).toBe(false);
  const journal = (await db.operationJournal.toArray())[0];
  expect(journal.completedItems).toHaveLength(2);
  expect(journal.pendingItems).toHaveLength(5);
  expect(peak).toBe(2);
  expect(create).toHaveBeenCalledTimes(2);
  expect(service.transfers).toEqual([]);
});
it("deletes up to four items concurrently and retains only failed or unscheduled items", async () => {
  const service = new AssetService();
  let active = 0,
    peak = 0;
  vi.spyOn(storage, "trashFile").mockImplementation(async (id) => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 20));
    active--;
    if (id === "0") throw new Error("offline");
  });
  await expect(
    service.startOperation(
      "bulk-trash",
      Array.from({ length: 8 }, (_, i) => ({
        id: String(i),
        fileId: String(i),
        name: String(i),
        metadata: { version: "1" },
      })),
    ),
  ).rejects.toThrow("offline");
  const journal = (await db.operationJournal.toArray())[0];
  expect(peak).toBe(4);
  expect(active).toBe(0);
  expect(journal.completedItems.sort()).toEqual(["1", "2", "3"]);
  expect(journal.pendingItems.sort()).toEqual(["0", "4", "5", "6", "7"]);
});
