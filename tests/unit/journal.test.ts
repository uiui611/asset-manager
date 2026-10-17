import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AssetService, storage } from "../../src/application/asset-service";
import * as media from "../../src/application/media";
import type { OperationItem, StoredFile } from "../../src/domain/models";
import { ApiError, HttpAssetStorage } from "../../src/storage/http-asset-storage";

const stored = (id: string, version = "1", metadata: Partial<StoredFile> = {}) =>
  ({
    assetId: id,
    fileId: id,
    name: id,
    version,
    modifiedTime: "",
    size: 1,
    type: "image",
    mimeType: "image/png",
    sha256: "hash",
    tagIds: [],
    description: "",
    ...metadata,
  }) as StoredFile;
const upload = (id: string): OperationItem => ({
  id,
  name: id,
  blob: new Blob(["x"]),
  metadata: { assetId: id, name: id, sha256: "hash" },
});
beforeEach(() => {
  vi.stubGlobal("navigator", { onLine: true });
  storage.cancelWrites();
  storage.connected = true;
});
afterEach(() => {
  storage.cancelWrites();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("identifies an invalid input file and does not send any files", async () => {
  const service = new AssetService();
  const create = vi.spyOn(storage, "createFile");
  await service.enqueueImport([
    new File(["invalid JSON"], "broken.json", { type: "application/json" }),
  ]);
  expect(service.error).toContain("broken.json:");
  expect(service.uploads).toBe(0);
  expect(service.operations).toEqual([]);
  expect(create).not.toHaveBeenCalled();
});

it("requires an explicit retry and reuses IDs, payloads, and only unfinished items", async () => {
  const service = new AssetService();
  const create = vi.spyOn(storage, "createFile").mockImplementation(async (input) => {
    if (input.metadata.assetId === "b") throw new ApiError("busy", 429);
    return stored(input.metadata.assetId);
  });
  await expect(service.startOperation("upload", [upload("a"), upload("b")])).rejects.toThrow(
    "busy",
  );
  const operation = service.operations[0];
  expect(operation.completedItems).toEqual(["a"]);
  expect(operation.pendingItems).toEqual(["b"]);
  expect(operation.items[0].blob).toBeUndefined();
  expect(create).toHaveBeenCalledTimes(2);
  create.mockImplementation(async (input) => stored(input.metadata.assetId));
  expect(await service.retryOperation(operation.id)).toBe(true);
  expect(create.mock.calls.map((call) => call[0].metadata.assetId)).toEqual(["a", "b", "b"]);
  expect(create.mock.calls[1][0].content).toBe(create.mock.calls[2][0].content);
  expect(operation.status).toBe("completed");
  expect(service.files).toHaveLength(2);
});

it("associates a compound editor operation before notifications or requests begin", async () => {
  const service = new AssetService();
  let associated: string | undefined;
  service.addEventListener("change", () => {
    if (service.operations.length) expect(associated).toBe(service.operations[0].id);
  });
  vi.spyOn(storage, "createFile").mockImplementation(async () => {
    expect(associated).toBe(service.operations[0].id);
    return stored("a");
  });
  await service.startOperation("upload", [upload("a")], [], (operation) => {
    associated = operation.id;
  });
  expect(service.operations[0].status).toBe("completed");
});

it("does not resend an unknown outcome until the user checks the result", async () => {
  const service = new AssetService();
  const create = vi.spyOn(storage, "createFile").mockRejectedValue(new Error("connection lost"));
  const get = vi.spyOn(storage, "getMetadata").mockRejectedValue(new ApiError("missing", 404));
  await expect(service.startOperation("upload", [upload("a")])).rejects.toThrow();
  const operation = service.operations[0];
  expect(operation.status).toBe("unknown");
  expect(operation.canRetry).toBe(false);
  expect(get).not.toHaveBeenCalled();
  await expect(service.retryOperation(operation.id)).rejects.toThrow("先に");
  expect(create).toHaveBeenCalledTimes(1);
  await service.checkOperation(operation.id);
  expect(operation.status).toBe("failed");
  expect(operation.canRetry).toBe(true);
  expect(create).toHaveBeenCalledTimes(1);
  create.mockResolvedValue(stored("a"));
  await service.retryOperation(operation.id);
  expect(create.mock.calls.map((call) => call[0].metadata.assetId)).toEqual(["a", "a"]);
});

it("marks an exact saved result complete using GET only", async () => {
  const service = new AssetService();
  const create = vi.spyOn(storage, "createFile").mockRejectedValue(new Error("response lost"));
  vi.spyOn(storage, "getMetadata").mockResolvedValue(stored("a"));
  await expect(service.startOperation("upload", [upload("a")])).rejects.toThrow();
  await service.checkOperation(service.operations[0].id);
  expect(service.operations[0].status).toBe("completed");
  expect(create).toHaveBeenCalledTimes(1);
  expect(service.files[0].assetId).toBe("a");
});

it("checks normalized API metadata including automatic type tags", async () => {
  const service = new AssetService();
  const create = vi.spyOn(storage, "createFile").mockRejectedValue(new Error("response lost"));
  vi.spyOn(storage, "getMetadata").mockResolvedValue(
    stored("a", "1", {
      name: "a.png",
      type: "image",
      mimeType: "image/png",
      tagIds: ["image", "custom"],
      description: "note",
    }),
  );
  const item = upload("a");
  item.name = " a.png ";
  item.metadata = {
    ...item.metadata,
    type: "image",
    mimeType: "image/svg+xml",
    tagIds: ["custom", "custom", "audio"],
    description: "note",
  };
  await expect(service.startOperation("upload", [item])).rejects.toThrow();
  await service.checkOperation(service.operations[0].id);
  expect(service.operations[0].status).toBe("completed");
  expect(create).toHaveBeenCalledTimes(1);
});

it("does not accept a saved upload with different user tags", async () => {
  const service = new AssetService();
  vi.spyOn(storage, "createFile").mockRejectedValue(new Error("response lost"));
  vi.spyOn(storage, "getMetadata").mockResolvedValue(
    stored("a", "1", { tagIds: ["image", "other"] }),
  );
  const item = upload("a");
  item.metadata = { ...item.metadata, tagIds: ["custom"] };
  await expect(service.startOperation("upload", [item])).rejects.toThrow();
  await service.checkOperation(service.operations[0].id);
  expect(service.operations[0].status).toBe("failed");
  expect(service.operations[0].canRetry).toBe(false);
});

it("distinguishes an unchanged version from a changed or missing result", async () => {
  const service = new AssetService();
  vi.spyOn(storage, "updateContent").mockRejectedValue(new Error("response lost"));
  const get = vi.spyOn(storage, "getMetadata");
  const unchanged = { ...upload("unchanged"), expectedVersion: "2" };
  const changed = { ...upload("changed"), expectedVersion: "2" };
  const missing = { ...upload("missing"), expectedVersion: "2" };
  for (const item of [unchanged, changed, missing])
    await expect(service.startOperation("content-update", [item])).rejects.toThrow();
  get
    .mockResolvedValueOnce(stored("unchanged", "2", { sha256: "old-content" }))
    .mockResolvedValueOnce(stored("changed", "3", { sha256: "other-content" }))
    .mockRejectedValueOnce(new ApiError("missing", 404));
  for (const operation of service.operations) await service.checkOperation(operation.id);
  expect(service.operations.map((operation) => operation.items[0].resultCheck)).toEqual([
    "not-saved",
    "mismatch",
    "mismatch",
  ]);
  expect(service.operations.map((operation) => operation.canRetry)).toEqual([true, false, false]);
});

it("clears a prior not-saved check before another send can become unknown", async () => {
  const service = new AssetService();
  vi.spyOn(storage, "updateContent").mockRejectedValue(new Error("response lost"));
  const get = vi
    .spyOn(storage, "getMetadata")
    .mockResolvedValue(stored("a", "2", { sha256: "old-content" }));
  await expect(
    service.startOperation("content-update", [{ ...upload("a"), expectedVersion: "2" }]),
  ).rejects.toThrow();
  const operation = service.operations[0];
  await service.checkOperation(operation.id);
  expect(operation.items[0].resultCheck).toBe("not-saved");
  await expect(service.retryOperation(operation.id)).rejects.toThrow();
  expect(operation.status).toBe("unknown");
  expect(operation.items[0].resultCheck).toBeUndefined();
  get.mockResolvedValue(stored("a", "3"));
  await service.checkOperation(operation.id);
  expect(operation.status).toBe("completed");
  expect(operation.items[0].resultCheck).toBeUndefined();
});

it("ignores a result check discarded while its local hash is being calculated", async () => {
  const service = new AssetService();
  vi.spyOn(storage, "createFile").mockRejectedValue(new Error("response lost"));
  vi.spyOn(storage, "getMetadata").mockResolvedValue(stored("a"));
  let release!: (hash: string) => void;
  vi.spyOn(media, "hashBlob").mockImplementation(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const item = upload("a");
  item.metadata = { assetId: "a", name: "a" };
  await expect(service.startOperation("upload", [item])).rejects.toThrow();
  const checking = service.checkOperation(service.operations[0].id);
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  service.discardUnfinished();
  release("hash");
  await checking;
  expect(service.files).toEqual([]);
  expect(service.operations[0].status).toBe("cancelled");
});

it("captures the original expected version and metadata for manual retries", async () => {
  const service = new AssetService();
  service.files = [stored("a", "2")];
  const update = vi
    .spyOn(storage, "updateMetadata")
    .mockRejectedValueOnce(new ApiError("busy", 429))
    .mockResolvedValue(stored("a", "3"));
  const tagIds = ["original"];
  await expect(
    service.startOperation("bulk-tag", [{ id: "a", name: "a", fileId: "a", metadata: { tagIds } }]),
  ).rejects.toThrow();
  tagIds.push("later-edit");
  await service.putFile(stored("a", "99"));
  await service.retryOperation(service.operations[0].id);
  expect(update.mock.calls.map((call) => call[2])).toEqual(["2", "2"]);
  expect(update.mock.calls[1][1].tagIds).toEqual(["original"]);
});

it("rejects size overflow before creating an operation or making requests", async () => {
  const service = new AssetService();
  const create = vi.spyOn(storage, "createFile");
  await expect(
    service.startOperation("upload", [
      { id: "a", name: "a", blob: { size: 600000000 } as Blob },
      { id: "b", name: "b", blob: { size: 600000000 } as Blob },
    ]),
  ).rejects.toThrow("1 GB");
  expect(service.operations).toEqual([]);
  expect(create).not.toHaveBeenCalled();
});

it("drains two in-flight saves on in-page cancel without sending the rest", async () => {
  const service = new AssetService();
  const release: (() => void)[] = [];
  const create = vi.spyOn(storage, "createFile").mockImplementation(async (input) => {
    await new Promise<void>((resolve) => release.push(resolve));
    return stored(input.metadata.assetId);
  });
  const work = service.startOperation(
    "tile-split",
    Array.from({ length: 7 }, (_, index) => upload(String(index))),
  );
  await vi.waitFor(() => expect(release).toHaveLength(2));
  service.cancel();
  for (const finish of release) finish();
  expect(await work).toBe(false);
  expect(create).toHaveBeenCalledTimes(2);
  expect(service.operations[0].completedItems).toHaveLength(2);
  expect(service.operations[0].pendingItems).toHaveLength(5);
  expect(service.transfers).toEqual([]);
});

it("discards pending work and ignores late responses after leaving", async () => {
  const service = new AssetService();
  const release: (() => void)[] = [];
  const create = vi.spyOn(storage, "createFile").mockImplementation(async (input) => {
    await new Promise<void>((resolve) => release.push(resolve));
    return stored(input.metadata.assetId);
  });
  const work = service.startOperation(
    "upload",
    Array.from({ length: 5 }, (_, index) => upload(String(index))),
  );
  await vi.waitFor(() => expect(release).toHaveLength(2));
  const token = service.cancellationToken;
  service.discardUnfinished();
  expect(service.cancellationToken).toBeGreaterThan(token);
  expect(create.mock.calls.every((call) => call[1]?.aborted)).toBe(true);
  for (const finish of release) finish();
  expect(await work).toBe(false);
  expect(create).toHaveBeenCalledTimes(2);
  expect(service.files).toEqual([]);
  expect(service.hasUnfinishedOperations).toBe(false);
  expect(service.operations[0].items.every((item) => !item.blob)).toBe(true);
});

it("does not start requests waiting for a limiter slot after discard", async () => {
  const service = new AssetService();
  const release: (() => void)[] = [];
  const create = vi.spyOn(storage, "createFile").mockImplementation(async (input) => {
    await new Promise<void>((resolve) => release.push(resolve));
    return stored(input.metadata.assetId);
  });
  const first = service.startOperation("upload", [upload("a"), upload("b")]);
  await vi.waitFor(() => expect(release).toHaveLength(2));
  const waiting = service.startOperation("upload", [upload("c")]);
  service.discardUnfinished();
  for (const finish of release) finish();
  await Promise.all([first, waiting]);
  expect(create).toHaveBeenCalledTimes(2);
});

it("blocks retries for validation and version conflicts", async () => {
  const service = new AssetService();
  const create = vi.spyOn(storage, "createFile").mockRejectedValue(new ApiError("conflict", 409));
  await expect(service.startOperation("upload", [upload("a")])).rejects.toThrow("conflict");
  expect(service.operations[0].canRetry).toBe(false);
  expect(await service.retryOperation(service.operations[0].id)).toBe(false);
  expect(create).toHaveBeenCalledTimes(1);
});

it("blocks a new save that would bypass an unknown or failed operation", async () => {
  const service = new AssetService();
  const create = vi.spyOn(storage, "createFile").mockRejectedValue(new Error("response lost"));
  vi.spyOn(storage, "getMetadata").mockRejectedValue(new ApiError("missing", 404));
  await expect(service.startOperation("upload", [upload("a")])).rejects.toThrow();
  await expect(service.startOperation("upload", [upload("a")])).rejects.toThrow("未完了の操作");
  expect(create).toHaveBeenCalledTimes(1);
  await service.checkOperation(service.operations[0].id);
  expect(service.operations[0].status).toBe("failed");
  await expect(service.startOperation("upload", [upload("a")])).rejects.toThrow("未完了の操作");
  expect(service.operations).toHaveLength(1);
  service.discardOperation(service.operations[0].id);
  create.mockResolvedValue(stored("a"));
  expect(await service.startOperation("upload", [upload("a")])).toBe(true);
  expect(create).toHaveBeenCalledTimes(2);
});

it("allows saving a target again after its previous operation completed", async () => {
  const service = new AssetService();
  const create = vi.spyOn(storage, "createFile").mockResolvedValue(stored("a"));
  expect(await service.startOperation("upload", [upload("a")])).toBe(true);
  expect(await service.startOperation("upload", [upload("a")])).toBe(true);
  expect(create).toHaveBeenCalledTimes(2);
});

it("does not block already completed targets in a partially failed batch", async () => {
  const service = new AssetService();
  const create = vi.spyOn(storage, "createFile").mockImplementation(async (input) => {
    if (input.metadata.assetId === "b") throw new ApiError("invalid", 400);
    return stored(input.metadata.assetId);
  });
  await expect(service.startOperation("upload", [upload("a"), upload("b")])).rejects.toThrow();
  expect(await service.startOperation("upload", [upload("a")])).toBe(true);
  await expect(service.startOperation("upload", [upload("b")])).rejects.toThrow("未完了の操作");
  expect(create).toHaveBeenCalledTimes(3);
});

it("does not infer physical deletion from metadata 404 and retries DELETE explicitly", async () => {
  const service = new AssetService();
  const remove = vi
    .spyOn(storage, "trashFile")
    .mockRejectedValueOnce(new ApiError("object cleanup failed", 500))
    .mockResolvedValue(undefined);
  vi.spyOn(storage, "getMetadata").mockRejectedValue(new ApiError("missing", 404));
  await expect(
    service.startOperation("bulk-trash", [{ id: "a", name: "a", expectedVersion: "2" }]),
  ).rejects.toThrow();
  const operation = service.operations[0];
  await service.checkOperation(operation.id);
  expect(operation.status).toBe("failed");
  expect(operation.canRetry).toBe(true);
  expect(remove).toHaveBeenCalledTimes(1);
  await service.retryOperation(operation.id);
  expect(operation.status).toBe("completed");
  expect(remove.mock.calls.map((call) => call[1])).toEqual(["2", "2"]);
});

it("stops the remaining items after a failure and never schedules a timer retry", async () => {
  const service = new AssetService();
  const create = vi.spyOn(storage, "createFile").mockRejectedValue(new ApiError("busy", 429));
  await expect(
    service.startOperation(
      "upload",
      Array.from({ length: 8 }, (_, index) => upload(String(index))),
    ),
  ).rejects.toThrow();
  expect(create).toHaveBeenCalledTimes(2);
  expect(service.operations[0].pendingItems).toHaveLength(8);
  expect(service.operations[0].items.filter((item) => item.status === "pending")).toHaveLength(6);
});

it("clears upload counters after an in-page cancellation", async () => {
  const service = new AssetService();
  vi.spyOn(media, "hashBlob").mockResolvedValue("hash");
  const release: (() => void)[] = [];
  vi.spyOn(storage, "createFile").mockImplementation(async (input) => {
    await new Promise<void>((resolve) => release.push(resolve));
    return stored(input.metadata.assetId);
  });
  const work = service.enqueueImport([new File(["{}"], "a.json"), new File(["{}"], "b.json")]);
  await vi.waitFor(() => expect(release).toHaveLength(2));
  service.cancel();
  for (const finish of release) finish();
  await work;
  expect(service.uploads).toBe(0);
});

it("releases the busy guard after an in-page cancellation", async () => {
  const service = new AssetService();
  let release!: () => void;
  vi.spyOn(storage, "createFile").mockImplementation(async () => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return stored("a");
  });
  const work = service.run(() => service.startOperation("upload", [upload("a")]));
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  service.cancel();
  release();
  await work;
  expect(service.busy).toBe(false);
  expect(service.operations[0].status).toBe("completed");
});

it("does not start a project save after its hash preparation was discarded", async () => {
  const service = new AssetService();
  let release!: (hash: string) => void;
  vi.spyOn(media, "hashBlob").mockImplementation(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const create = vi.spyOn(storage, "createFile");
  const project = {
    schemaVersion: 1 as const,
    id: "sound",
    name: "sound",
    format: "multitrack" as const,
    tracks: [
      {
        id: "track",
        name: "",
        parameters: { oldParams: true, wave_type: 0 },
        gain: 1,
        offset: 0,
        muted: false,
      },
    ],
    updatedAt: "",
  };
  const work = service.saveProject("sound", project);
  service.discardUnfinished();
  release("hash");
  expect(await work).toBeUndefined();
  expect(create).not.toHaveBeenCalled();
  expect(service.operations).toEqual([]);
});

it("does not PUT after an update preflight GET is aborted", async () => {
  const client = new HttpAssetStorage();
  let release!: (response: Response) => void;
  const fetch = vi.fn(
    () =>
      new Promise<Response>((resolve) => {
        release = resolve;
      }),
  );
  vi.stubGlobal("fetch", fetch);
  const work = client.updateContent("a", new Blob(["x"]), "1");
  client.cancelWrites();
  release(
    new Response(JSON.stringify(stored("a")), { headers: { "Content-Type": "application/json" } }),
  );
  await expect(work).rejects.toThrow();
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("skips preflight GET with a complete metadata snapshot and preserves If-Match", async () => {
  const client = new HttpAssetStorage();
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(stored("a", "3"))));
  vi.stubGlobal("fetch", fetch);
  await client.updateContent("a", new Blob(["x"]), "2", stored("a", "2"));
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0][1]).toMatchObject({ method: "PUT", headers: { "If-Match": "2" } });
});
