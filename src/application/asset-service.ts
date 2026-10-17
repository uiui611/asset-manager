import { sanitizeSvg, thumbnail } from "../canvas/images";
import { editorKind } from "../domain/library";
import { imageMime } from "../domain/media-type";
import { referenceIds, validateMetadata, validateWriteSize } from "../domain/metadata";
import {
  type Kind,
  now,
  type Operation,
  type OperationItem,
  type Project,
  type StoredFile,
  type Tag,
  uid,
} from "../domain/models";
import { automaticTagIds, tagName } from "../domain/tags";
import { validateProject } from "../schemas/projects";
import { ApiError, HttpAssetStorage } from "../storage/http-asset-storage";
import { Limiter } from "./limiter";
import { hashBlob, jsonBlob, validateImport } from "./media";
import { SyncService } from "./sync";

export const storage = new HttpAssetStorage();
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
const unfinished = (operation: Operation) => !["completed", "cancelled"].includes(operation.status);
export class AssetService extends EventTarget {
  busy = false;
  uploads = 0;
  uploadTotal = 0;
  transfers: { id: string; label: string; done: number; total: number }[] = [];
  operations: Operation[] = [];
  status = "";
  error = "";
  files: StoredFile[] = [];
  tags: Tag[] = [];
  private cancellation = 0;
  private departureGeneration = 0;
  private revision = 0;
  private listGeneration = 0;
  private runGeneration = 0;
  private writes = new Limiter(2);
  private deletes = new Limiter(4);
  private running = new Map<string, Promise<boolean>>();
  private controllers = new Map<string, AbortController>();
  private thumbnailQueue = new Limiter(4);
  private thumbnails = new Map<string, Blob>();
  private thumbnailRequests = new Map<string, Promise<Blob | undefined>>();
  private thumbnailFailures = new Set<string>();
  private thumbnailBytes = 0;
  get hasUnfinishedOperations() {
    return this.busy || this.uploads > 0 || this.operations.some(unfinished);
  }
  get cancellationToken() {
    return this.cancellation;
  }
  changed() {
    this.dispatchEvent(new Event("change"));
  }
  async init() {
    this.changed();
    if (import.meta.env.MODE !== "e2e") await this.connect();
  }
  async refresh() {
    this.changed();
  }
  async whenIdle() {
    if (!this.busy) return;
    await new Promise<void>((resolve) => {
      const check = () => {
        if (!this.busy) {
          this.removeEventListener("change", check);
          resolve();
        }
      };
      this.addEventListener("change", check);
      check();
    });
  }
  async run<T>(action: () => Promise<T>): Promise<T | undefined> {
    if (this.busy) return;
    const token = this.cancellation;
    const run = ++this.runGeneration;
    this.busy = true;
    this.error = "";
    this.changed();
    try {
      const result = await action();
      return token === this.cancellation ? result : undefined;
    } catch (error) {
      if (token === this.cancellation) this.error = message(error);
      return undefined;
    } finally {
      if (run === this.runGeneration) {
        this.busy = false;
        this.status = "";
        this.changed();
      }
    }
  }
  progress(text: string) {
    this.status = text;
    this.changed();
  }
  requireConnected() {
    if (!storage.connected) throw new Error("ストレージに接続してから保存してください。");
    if (!navigator.onLine) throw new Error("オフラインです。接続後に再試行してください。");
  }
  async connect() {
    await this.run(async () => {
      const token = this.cancellation;
      const signal = storage.writeSignal;
      await storage.authenticate(signal);
      if (token === this.cancellation) await this.syncInternal();
    });
  }
  async sync() {
    await this.run(() => this.syncInternal());
  }
  private async syncInternal() {
    this.requireConnected();
    const generation = ++this.listGeneration;
    const revision = this.revision;
    const token = this.cancellation;
    const signal = storage.writeSignal;
    const files = await new SyncService(storage).sync((text) => this.progress(text), signal);
    const tags = await storage.listTags(signal);
    signal.throwIfAborted();
    if (
      generation !== this.listGeneration ||
      revision !== this.revision ||
      token !== this.cancellation
    )
      return;
    this.files = files;
    this.tags = tags;
    this.thumbnailFailures.clear();
    const versions = new Set(files.map((file) => `${file.assetId}:${file.version}`));
    for (const [key, blob] of this.thumbnails)
      if (!versions.has(key)) {
        this.thumbnailBytes -= blob.size;
        this.thumbnails.delete(key);
      }
    this.changed();
  }
  async putFile(file: StoredFile) {
    this.revision++;
    this.files = [...this.files.filter((old) => old.assetId !== file.assetId), file];
    this.changed();
  }
  async createTag(name: string) {
    this.requireConnected();
    const normalized = tagName(name);
    const existing = this.tags.find((tag) => tag.name === normalized);
    if (existing) return existing;
    const token = this.cancellation;
    const tag = await storage.createTag(normalized, storage.writeSignal);
    if (token !== this.cancellation) throw new DOMException("操作を取り消しました。", "AbortError");
    this.revision++;
    this.tags = [...this.tags.filter((old) => old.tagId !== tag.tagId), tag];
    this.changed();
    return tag;
  }
  async enqueueImport(files: File[]) {
    const token = this.cancellation;
    const departure = this.departureGeneration;
    try {
      validateWriteSize(files.map((file) => file.size));
      this.uploadTotal = files.length;
      this.uploads += files.length;
      this.changed();
      const prepared = await this.prepareImport(files);
      if (token !== this.cancellation) return;
      await this.startOperation("upload", prepared.items);
    } catch (error) {
      if (token === this.cancellation) this.error = message(error);
    } finally {
      if (departure === this.departureGeneration) {
        this.uploads = Math.max(0, this.uploads - files.length);
        this.changed();
      }
    }
  }
  async prepareImport(files: File[]) {
    this.requireConnected();
    const token = this.cancellation;
    validateWriteSize(files.map((file) => file.size));
    const items: OperationItem[] = [];
    for (const file of files) {
      if (token !== this.cancellation)
        throw new DOMException("操作を取り消しました。", "AbortError");
      this.progress(`${file.name} を確認中`);
      const fileError = (error: unknown): never => {
        throw new Error(`${file.name}: ${message(error)}`);
      };
      const { blob, type } = await validateImport(file).catch(fileError);
      const sha256 = await hashBlob(blob).catch(fileError);
      if (token !== this.cancellation)
        throw new DOMException("操作を取り消しました。", "AbortError");
      const id = uid();
      items.push({
        id,
        name: file.name,
        blob,
        metadata: {
          assetId: id,
          name: file.name,
          type,
          mimeType: blob.type,
          sha256,
          tagIds: [],
          description: "",
        },
      });
    }
    validateWriteSize(items.map((item) => item.blob?.size || 0));
    return { items };
  }
  async startOperation(
    type: Operation["type"],
    items: OperationItem[],
    sourceAssetIds: string[] = [],
    onCreated?: (operation: Operation) => void,
  ) {
    this.requireConnected();
    const targets = new Set(items.flatMap((item) => [item.id, item.fileId || item.id]));
    if (
      this.operations.some(
        (operation) =>
          unfinished(operation) &&
          operation.items.some(
            (item) =>
              item.status !== "completed" &&
              item.status !== "cancelled" &&
              (targets.has(item.id) || targets.has(item.fileId || item.id)),
          ),
      )
    )
      throw new Error(
        "この素材には未完了の操作があります。操作パネルで結果を確認、再試行、または取り消してから保存してください。",
      );
    validateWriteSize(items.map((item) => item.blob?.size || 0));
    for (const item of items) if (item.metadata) validateMetadata(item.metadata);
    const operation: Operation = {
      id: uid(),
      type,
      status: "pending",
      canRetry: true,
      sourceAssetIds: [...sourceAssetIds],
      completedItems: [],
      pendingItems: items.map((item) => item.id),
      items: items.map((item) => ({
        ...item,
        metadata: item.metadata ? structuredClone(item.metadata) : undefined,
        expectedVersion:
          item.expectedVersion ||
          item.metadata?.version ||
          this.files.find((file) => file.assetId === item.id)?.version,
        status: "pending",
      })),
      createdAt: now(),
    };
    this.operations = [...this.operations, operation];
    onCreated?.(operation);
    this.changed();
    return this.executeOperation(operation);
  }
  cancel() {
    this.cancellation++;
    this.progress("送信済みの結果を確認して中断します");
  }
  discardOperation(id: string) {
    const operation = this.operations.find((item) => item.id === id);
    if (!operation) return;
    this.controllers.get(id)?.abort();
    if (operation.status === "completed")
      this.operations = this.operations.filter((item) => item !== operation);
    else {
      operation.status = "cancelled";
      operation.canRetry = false;
      for (const item of operation.items) {
        item.blob = undefined;
        if (item.status !== "completed") item.status = "cancelled";
      }
      operation.pendingItems = [];
    }
    this.changed();
  }
  discardUnfinished() {
    this.cancellation++;
    this.departureGeneration++;
    this.runGeneration++;
    storage.cancelWrites();
    for (const operation of this.operations)
      if (unfinished(operation)) this.discardOperation(operation.id);
    this.uploads = 0;
    this.busy = false;
    this.status = "";
    this.transfers = [];
    this.changed();
  }
  private summarize(operation: Operation) {
    if (operation.status === "cancelled") return;
    operation.completedItems = operation.items
      .filter((item) => item.status === "completed")
      .map((item) => item.id);
    operation.pendingItems = operation.items
      .filter((item) => item.status !== "completed" && item.status !== "cancelled")
      .map((item) => item.id);
    const unknown = operation.items.some((item) => item.status === "unknown");
    operation.status = !operation.pendingItems.length
      ? "completed"
      : unknown
        ? "unknown"
        : operation.items.some((item) => item.status === "failed")
          ? "failed"
          : "pending";
    operation.canRetry =
      !unknown &&
      operation.items.some(
        (item) =>
          item.status === "pending" || (item.status === "failed" && item.retryable !== false),
      );
    operation.error = operation.items.find((item) => item.error)?.error;
  }
  private completeItem(item: OperationItem) {
    item.status = "completed";
    item.error = undefined;
    item.resultCheck = undefined;
    item.blob = undefined;
  }
  async retryOperation(id: string) {
    const operation = this.operations.find((item) => item.id === id);
    if (!operation) throw new Error("操作が見つかりません。");
    if (operation.status === "unknown") throw new Error("先に保存結果を確認してください。");
    if (!operation.canRetry || operation.status === "cancelled") return false;
    return this.executeOperation(operation);
  }
  private executeOperation(operation: Operation): Promise<boolean> {
    const existing = this.running.get(operation.id);
    if (existing) return existing;
    const work = this.executeInternal(operation).finally(() => this.running.delete(operation.id));
    this.running.set(operation.id, work);
    return work;
  }
  private async executeInternal(operation: Operation) {
    this.requireConnected();
    const controller = new AbortController();
    this.controllers.set(operation.id, controller);
    const token = this.cancellation;
    const queue = operation.items.filter(
      (item) => item.status === "pending" || (item.status === "failed" && item.retryable !== false),
    );
    const limit = operation.type === "bulk-trash" || operation.type === "bulk-tag" ? 4 : 2;
    const limiter = limit === 4 ? this.deletes : this.writes;
    let failed: unknown;
    const progress = {
      id: operation.id,
      label:
        operation.type === "bulk-trash" ? "削除" : operation.type === "bulk-tag" ? "更新" : "保存",
      done: operation.completedItems.length,
      total: operation.items.length,
    };
    operation.status = "running";
    operation.canRetry = false;
    operation.error = undefined;
    this.transfers = [...this.transfers, progress];
    this.changed();
    try {
      await Promise.all(
        Array.from({ length: Math.min(limit, queue.length) }, async () => {
          while (
            queue.length &&
            token === this.cancellation &&
            !controller.signal.aborted &&
            !failed
          ) {
            const item = queue.shift();
            if (!item) return;
            await limiter.run(async () => {
              if (token !== this.cancellation || controller.signal.aborted || failed) return;
              item.status = "running";
              item.error = undefined;
              item.resultCheck = undefined;
              this.changed();
              try {
                let stored: StoredFile | undefined;
                if (operation.type === "bulk-trash") {
                  await storage.trashFile(
                    item.fileId || item.id,
                    item.expectedVersion,
                    controller.signal,
                  );
                  if (!controller.signal.aborted && operation.status !== "cancelled") {
                    this.revision++;
                    this.files = this.files.filter((file) => file.assetId !== item.id);
                  }
                } else if (operation.type === "bulk-tag") {
                  stored = await storage.updateMetadata(
                    item.fileId || item.id,
                    item.metadata || {},
                    item.expectedVersion,
                    controller.signal,
                  );
                } else {
                  if (!item.blob || !item.metadata)
                    throw new ApiError("送信するファイルがありません。", 400);
                  const metadata = { ...item.metadata, assetId: item.id, name: item.name };
                  stored =
                    operation.type === "content-update"
                      ? await storage.updateContent(
                          item.fileId || item.id,
                          item.blob,
                          item.expectedVersion,
                          metadata,
                          controller.signal,
                        )
                      : await storage.createFile(
                          { content: item.blob, metadata },
                          controller.signal,
                        );
                }
                if (controller.signal.aborted || operation.status === "cancelled") return;
                if (stored) await this.putFile(stored);
                this.completeItem(item);
                operation.completedItems = operation.items
                  .filter((entry) => entry.status === "completed")
                  .map((entry) => entry.id);
                operation.pendingItems = operation.items
                  .filter((entry) => entry.status !== "completed" && entry.status !== "cancelled")
                  .map((entry) => entry.id);
                progress.done++;
              } catch (error) {
                if (controller.signal.aborted || operation.status === "cancelled") return;
                const unknown = !(error instanceof ApiError) || error.outcomeUnknown;
                item.status = unknown ? "unknown" : "failed";
                item.retryable = error instanceof ApiError && error.status === 429;
                item.error = unknown
                  ? `保存結果を確認できません。自動再送は行いません。${message(error)}`
                  : message(error);
                failed ??= error;
              }
              this.changed();
            });
          }
        }),
      );
      this.summarize(operation);
      if (failed) throw failed;
      return operation.items.every((item) => item.status === "completed");
    } finally {
      this.controllers.delete(operation.id);
      this.transfers = this.transfers.filter((item) => item.id !== operation.id);
      this.changed();
    }
  }
  private metadataMatches(current: StoredFile, expected: Partial<StoredFile>) {
    if (expected.name !== undefined && current.name !== expected.name.trim()) return false;
    // The API derives type, MIME and automatic tags from the normalized filename.
    for (const key of ["description", "sha256"] as const)
      if (expected[key] !== undefined && current[key] !== expected[key]) return false;
    const userTags = (ids: string[]) =>
      [...new Set(ids.filter((id) => !automaticTagIds.includes(id)))].sort();
    return (
      !expected.tagIds ||
      JSON.stringify(userTags(current.tagIds)) === JSON.stringify(userTags(expected.tagIds))
    );
  }
  async checkOperation(id: string) {
    if (this.running.has(id)) return;
    const operation = this.operations.find((item) => item.id === id);
    if (!operation || operation.status === "cancelled") return;
    this.requireConnected();
    const controller = new AbortController();
    this.controllers.set(id, controller);
    const work = (async () => {
      for (const item of operation.items.filter((entry) => entry.status === "unknown")) {
        if (controller.signal.aborted || operation.status === "cancelled") return false;
        try {
          const current = await storage.getMetadata(item.fileId || item.id, controller.signal);
          if (controller.signal.aborted) return false;
          let matches = operation.type !== "bulk-trash";
          const expected = { ...item.metadata };
          if (
            operation.type === "upload" ||
            operation.type === "tile-split" ||
            operation.type === "content-update"
          ) {
            expected.name = item.name;
            expected.description ??= "";
            expected.tagIds ??= [];
          }
          if (item.blob) expected.sha256 = expected.sha256 || (await hashBlob(item.blob));
          if (controller.signal.aborted) return false;
          matches = matches && this.metadataMatches(current, expected);
          if (matches) {
            await this.putFile(current);
            this.completeItem(item);
          } else if (item.expectedVersion && current.version === item.expectedVersion) {
            item.status = "failed";
            item.resultCheck = "not-saved";
            item.retryable = true;
            item.error = "変更は保存されていません。再試行できます。";
          } else {
            item.status = "failed";
            item.resultCheck = "mismatch";
            item.retryable = false;
            item.error = "現在の素材が送信内容と異なります。一覧を更新して内容を確認してください。";
          }
        } catch (error) {
          if (controller.signal.aborted) return false;
          if (error instanceof ApiError && error.status === 404) {
            item.resultCheck = "mismatch";
            if (operation.type === "bulk-trash") {
              item.status = "failed";
              item.retryable = true;
              item.error = "本体の削除は未確認です。削除を再試行してください。";
            } else if (operation.type === "upload" || operation.type === "tile-split") {
              item.status = "failed";
              item.retryable = true;
              item.error =
                "現時点で登録を確認できません。既に保存されている可能性があります。同じIDで再試行できます。";
            } else {
              item.status = "failed";
              item.retryable = false;
              item.error = "更新対象が見つかりません。";
            }
          } else item.error = `結果を確認できませんでした。${message(error)}`;
        }
      }
      this.summarize(operation);
      this.changed();
      return operation.status === "completed";
    })().finally(() => {
      this.controllers.delete(id);
      this.running.delete(id);
    });
    this.running.set(id, work);
    await work;
  }
  async update(file: StoredFile, name: string, description: string, tagIds: string[]) {
    if (!name.trim()) throw new Error("素材名を入力してください。");
    await this.startOperation("bulk-tag", [
      {
        id: file.assetId,
        fileId: file.fileId,
        name: name.trim(),
        expectedVersion: file.version,
        metadata: { name: name.trim(), description, tagIds },
      },
    ]);
  }
  async blob(file: StoredFile) {
    const blob = await storage.getFile(file.fileId);
    const mime =
      file.type === "image" ? await imageMime(blob, file.mimeType) : blob.type || file.mimeType;
    return mime === "image/svg+xml"
      ? sanitizeSvg(await blob.text())
      : blob.type === mime
        ? blob
        : new Blob([blob], { type: mime || file.mimeType });
  }
  async thumb(file: StoredFile): Promise<Blob | undefined> {
    const key = `${file.assetId}:${file.version}`;
    const cached = this.thumbnails.get(key);
    if (cached) {
      this.thumbnails.delete(key);
      this.thumbnails.set(key, cached);
      return cached;
    }
    if (this.thumbnailFailures.has(key) || !storage.connected) return undefined;
    const existing = this.thumbnailRequests.get(key);
    if (existing) return existing;
    const work = this.thumbnailQueue
      .run(async () => {
        let blob: Blob;
        if (editorKind(file) === "character") {
          const data = JSON.parse(await (await this.blob(file)).text());
          if (
            typeof data.previewImage !== "string" ||
            !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(data.previewImage) ||
            data.previewImage.length > 300000
          )
            return undefined;
          blob = new Blob(
            [
              Uint8Array.from(atob(data.previewImage.split(",")[1]), (value) =>
                value.charCodeAt(0),
              ),
            ],
            { type: "image/png" },
          );
        } else blob = await thumbnail(await this.blob(file));
        if (blob.size <= 16 * 1024 * 1024) {
          this.thumbnails.set(key, blob);
          this.thumbnailBytes += blob.size;
          while (this.thumbnails.size > 128 || this.thumbnailBytes > 16 * 1024 * 1024) {
            const oldest = this.thumbnails.entries().next().value;
            if (!oldest) break;
            this.thumbnails.delete(oldest[0]);
            this.thumbnailBytes -= oldest[1].size;
          }
        }
        return blob;
      })
      .then((blob) => {
        if (!blob) this.thumbnailFailures.add(key);
        return blob;
      })
      .catch(() => {
        this.thumbnailFailures.add(key);
        return undefined;
      })
      .finally(() => this.thumbnailRequests.delete(key));
    this.thumbnailRequests.set(key, work);
    return work;
  }
  async saveProject(kind: Kind, project: Project, version?: string) {
    const token = this.cancellation;
    validateProject(kind, project);
    const existing = this.files.find((file) => file.assetId === project.id);
    const content = jsonBlob(project);
    const metadata = {
      assetId: project.id,
      name: `${project.name}.json`,
      type: "json" as const,
      mimeType: "application/json",
      description: existing?.description || "",
      tagIds: [...new Set([...(existing?.tagIds || ["json"]), `editor-${kind}`])],
      sha256: await hashBlob(content),
    };
    if (token !== this.cancellation) return undefined;
    const complete = await this.startOperation(existing ? "content-update" : "upload", [
      {
        id: project.id,
        fileId: existing?.fileId,
        name: metadata.name,
        blob: content,
        metadata,
        expectedVersion: version || existing?.version,
      },
    ]);
    return complete ? this.files.find((file) => file.assetId === project.id) : undefined;
  }
  async openProject(file: StoredFile): Promise<Project> {
    const data = JSON.parse(await (await storage.getFile(file.fileId)).text());
    const kind = editorKind(file);
    if (!kind) throw new Error("エディター用タグがありません。");
    validateProject(kind, data);
    data.id = file.assetId;
    return data;
  }
  async references(ids: string[]) {
    const found: string[] = [];
    for (const file of this.files.filter((entry) =>
      ["map", "character"].includes(editorKind(entry) || ""),
    )) {
      try {
        const project = await this.openProject(file);
        if (referenceIds(project).some((id) => ids.includes(id))) found.push(file.name);
      } catch {
        found.push(`${file.name}（参照の確認に失敗）`);
      }
    }
    return [...new Set(found)];
  }
  async diagnostics() {
    const issues: string[] = [];
    const ids = new Set(this.files.map((file) => file.assetId));
    for (const file of this.files) {
      if (editorKind(file))
        try {
          const project = await this.openProject(file);
          for (const id of referenceIds(project))
            if (!ids.has(id)) issues.push(`${file.name}: 素材 ${id} が見つかりません`);
        } catch (error) {
          issues.push(`${file.name}: ${message(error)}`);
        }
    }
    return issues;
  }
}
export const app = new AssetService();
