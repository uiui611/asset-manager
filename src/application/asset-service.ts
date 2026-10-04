import { sanitizeSvg, thumbnail } from "../canvas/images";
import { db } from "../database/db";
import { editorKind } from "../domain/library";
import { imageMime } from "../domain/media-type";
import {
  encodeProperties,
  referenceIds,
  validateWriteSize,
} from "../domain/metadata";
import {
  type JournalItem,
  type Kind,
  now,
  type OperationJournal,
  type Project,
  type StoredFile,
  type Tag,
  uid,
} from "../domain/models";
import { validateProject } from "../schemas/projects";
import { HttpAssetStorage } from "../storage/http-asset-storage";
import { Limiter } from "./limiter";
import { hashBlob, jsonBlob, validateImport } from "./media";
import { SyncService } from "./sync";
export const storage = new HttpAssetStorage();
export class AssetService extends EventTarget {
  busy = false;
  uploads = 0;
  uploadTotal = 0;
  transfers: { id: string; label: string; done: number; total: number }[] = [];
  private writes = new Limiter(2);
  private deletes = new Limiter(4);
  private running = new Map<string, Promise<void>>();
  private uploadQueue = Promise.resolve();
  enqueueImport(files: File[]) {
    try {
      validateWriteSize(files.map((f) => f.size));
    } catch (error) {
      this.error = String(error);
      this.changed();
      return Promise.resolve();
    }
    if (!this.uploads) this.uploadTotal = 0;
    this.uploadTotal += files.length;
    this.uploads += files.length;
    this.changed();
    this.uploadQueue = this.uploadQueue.then(async () => {
      const queue = [...files];
      await Promise.all(
        Array.from({ length: Math.min(2, files.length) }, async () => {
          while (queue.length) {
            const file = queue.shift();
            if (!file) return;
            try {
              const prepared = await this.prepareImport([file]);
              await this.startOperation("upload", prepared.items);
            } catch (error) {
              this.error = `${file.name}: ${error instanceof Error ? error.message : String(error)}`;
            } finally {
              this.uploads--;
              await this.refresh();
            }
          }
        }),
      );
    });
    return this.uploadQueue;
  }
  status = "";
  error = "";
  files: StoredFile[] = [];
  tags: Tag[] = [];
  lastSync = "";
  private cancellation = 0;
  private thumbnailQueue = new Limiter(4);
  changed() {
    this.dispatchEvent(new Event("change"));
  }
  async init() {
    await this.refresh();
    if (import.meta.env.MODE !== "e2e") await this.connect();
  }
  async refresh() {
    const generation = ++this.refreshGeneration;
    const [files, tags, lastSync] = await Promise.all([
      db.assets.toArray(),
      db.tags.toArray(),
      db.syncState.get("lastSync"),
    ]);
    if (generation !== this.refreshGeneration) return;
    this.files = files;
    this.tags = tags;
    this.lastSync = lastSync?.value || "";
    this.changed();
  }
  private refreshGeneration = 0;
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
    this.busy = true;
    this.error = "";
    this.changed();
    try {
      return await action();
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
      return undefined;
    } finally {
      this.busy = false;
      this.status = "";
      await this.refresh();
    }
  }
  progress(text: string) {
    this.status = text;
    this.changed();
  }
  requireConnected() {
    if (!storage.connected)
      throw new Error("ストレージ に接続してから保存してください。");
    if (!navigator.onLine)
      throw new Error(
        "オフラインです。画面を閉じず、接続後に保存してください。",
      );
  }
  async connect() {
    await this.run(async () => {
      await storage.authenticate();
      await this.syncInternal();
    });
  }
  async sync() {
    await this.run(() => this.syncInternal());
  }
  private async syncInternal() {
    this.requireConnected();
    await new SyncService(db, storage).sync((s) => this.progress(s));
    const tags = await storage.listTags();
    await db.tags.clear();
    await db.tags.bulkPut(tags);
  }
  async putFile(file: StoredFile) {
    await db.transaction("rw", [db.assets, db.fileMap], async () => {
      await db.assets.put(file);
      await db.fileMap.put({
        fileId: file.fileId,
        assetId: file.assetId,
      });
    });
  }
  async createTag(name: string) {
    this.requireConnected();
    if (!name.trim()) throw new Error("タグ名を入力してください。");
    if (this.tags.some((t) => t.name === name.trim()))
      throw new Error("同じ名前のタグがあります。");
    const tag = await storage.createTag(name.trim());
    await db.tags.put(tag);
    await this.refresh();
    return tag;
  }
  async prepareImport(files: File[]) {
    this.requireConnected();
    validateWriteSize(files.map((f) => f.size));
    const items: JournalItem[] = [];
    const duplicates: string[] = [];
    const hashes = new Set(this.files.map((f) => f.sha256));
    for (const file of files) {
      this.progress(`${file.name} を確認中`);
      const { blob, type } = await validateImport(file);
      const sha256 = await hashBlob(blob);
      if (hashes.has(sha256)) duplicates.push(file.name);
      hashes.add(sha256);
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
    validateWriteSize(items.map((i) => i.blob?.size || 0));
    return { items, duplicates };
  }
  async startOperation(
    type: OperationJournal["type"],
    items: JournalItem[],
    sourceAssetIds: string[] = [],
  ) {
    this.requireConnected();
    validateWriteSize(items.map((i) => i.blob?.size || 0));
    for (const i of items) if (i.metadata) encodeProperties(i.metadata);
    const journal: OperationJournal = {
      id: uid(),
      type,
      status: "pending",
      sourceAssetIds,
      completedItems: [],
      pendingItems: items.map((i) => i.id),
      items,
      createdAt: now(),
    };
    await this.persistJournal(journal);
    await this.resume(journal.id);
    return (await db.operationJournal.get(journal.id))?.status === "completed";
  }
  get cancellationToken() {
    return this.cancellation;
  }
  cancel() {
    this.cancellation++;
    this.progress("現在のファイルの完了後に中断します");
  }
  private async persistJournal(journal: OperationJournal) {
    try {
      await db.operationJournal.put(journal);
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !["UnknownError", "DataCloneError"].includes(error.name) ||
        !journal.items.some((i) => i.blob)
      )
        throw error;
      // Some WebKit ports cannot persist file-backed Blob objects. Binary bytes
      // preserve the same recoverable payload without depending on a temp file.
      for (const item of journal.items)
        if (item.blob) {
          item.bytes = await item.blob.arrayBuffer();
          item.blobType = item.blob.type;
          item.blob = undefined;
        }
      await db.operationJournal.put(journal);
    }
  }
  resume(id: string): Promise<void> {
    const existing = this.running.get(id);
    if (existing) return existing;
    const work = this.resumeInternal(id).finally(() => this.running.delete(id));
    this.running.set(id, work);
    return work;
  }
  private async resumeInternal(id: string) {
    this.requireConnected();
    const journal = await db.operationJournal.get(id);
    if (!journal) throw new Error("操作が見つかりません。");
    const cancellation = this.cancellation;
    journal.status = "running";
    journal.error = undefined;
    await db.operationJournal.put(journal);
    const progress = {
      id,
      label:
        journal.type === "bulk-trash"
          ? "削除"
          : journal.type === "bulk-tag"
            ? "更新"
            : "保存",
      done: journal.completedItems.length,
      total: journal.completedItems.length + journal.pendingItems.length,
    };
    this.transfers = [...this.transfers, progress];
    this.changed();
    const queue = [...journal.pendingItems];
    let failed: unknown;
    let persist = Promise.resolve();
    const limiter =
      journal.type === "bulk-trash" || journal.type === "bulk-tag"
        ? this.deletes
        : this.writes;
    try {
      await Promise.all(
        Array.from(
          {
            length: Math.min(
              journal.type === "bulk-trash" || journal.type === "bulk-tag"
                ? 4
                : 2,
              queue.length,
            ),
          },
          async () => {
            while (
              queue.length &&
              cancellation === this.cancellation &&
              !failed
            ) {
              const itemId = queue.shift();
              const item = journal.items.find((i) => i.id === itemId);
              if (!item) {
                failed = new Error("復旧データがありません。");
                break;
              }
              try {
                await limiter.run(async () => {
                  if (journal.type === "bulk-trash") {
                    const cached = await db.assets.get(item.id);
                    try {
                      await storage.trashFile(
                        item.fileId || "",
                        cached?.version || item.metadata?.version,
                      );
                    } catch (e) {
                      if (!(e instanceof Error) || !e.message.includes("(404)"))
                        throw e;
                    }
                    await db.assets.delete(item.id);
                    if (item.fileId) await db.fileMap.delete(item.fileId);
                    await db.thumbnails.delete(item.id);
                  } else if (journal.type === "bulk-tag") {
                    const cached = await db.assets.get(item.id);
                    await this.putFile(
                      await storage.updateMetadata(
                        item.fileId || "",
                        item.metadata || {},
                        cached?.version,
                      ),
                    );
                  } else if ((item.blob || item.bytes) && item.metadata) {
                    await this.putFile(
                      await storage.createFile({
                        content:
                          item.blob ||
                          new Blob([item.bytes as ArrayBuffer], {
                            type: item.blobType,
                          }),
                        metadata: {
                          ...item.metadata,
                          assetId: item.id,
                          name: item.name,
                        },
                      }),
                    );
                  }
                });
                journal.completedItems.push(item.id);
                journal.pendingItems = journal.pendingItems.filter(
                  (i) => i !== item.id,
                );
                item.blob = undefined;
                item.bytes = undefined;
                // Serialize journal checkpoints while independent network requests overlap.
                persist = persist.then(() => this.persistJournal(journal));
                await persist;
                progress.done = journal.completedItems.length;
                this.changed();
              } catch (error) {
                failed ??= error;
              }
            }
          },
        ),
      );
      journal.status = failed
        ? "failed"
        : journal.pendingItems.length
          ? "pending"
          : "completed";
      journal.error = failed
        ? failed instanceof Error
          ? failed.message
          : String(failed)
        : undefined;
      if (journal.status === "completed") journal.items = [];
      await this.persistJournal(journal);
      if (failed) throw failed;
    } finally {
      this.transfers = this.transfers.filter((p) => p.id !== id);
      this.changed();
    }
  }
  async update(
    file: StoredFile,
    name: string,
    description: string,
    tagIds: string[],
  ) {
    this.requireConnected();
    if (!name.trim()) throw new Error("素材名を入力してください。");
    await this.putFile(
      await storage.updateMetadata(
        file.fileId,
        { name: name.trim(), description, tagIds },
        file.version,
      ),
    );
  }
  async blob(file: StoredFile) {
    const blob = await storage.getFile(file.fileId);
    const mime =
      file.type === "image"
        ? await imageMime(blob, file.mimeType)
        : blob.type || file.mimeType;
    return mime === "image/svg+xml"
      ? sanitizeSvg(await blob.text())
      : blob.type === mime
        ? blob
        : new Blob([blob], { type: mime || file.mimeType });
  }
  async thumb(file: StoredFile) {
    return this.thumbnailQueue.run(async () => {
      const cached = await db.thumbnails.get(file.assetId);
      if (cached?.version === file.version)
        return (
          cached.blob ||
          (cached.bytes
            ? new Blob([cached.bytes], { type: "image/png" })
            : undefined)
        );
      if (!storage.connected) return undefined;
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
            Uint8Array.from(atob(data.previewImage.split(",")[1]), (c) =>
              c.charCodeAt(0),
            ),
          ],
          { type: "image/png" },
        );
      } else blob = await thumbnail(await this.blob(file));
      const cache = {
        assetId: file.assetId,
        version: file.version,
        blob,
      };
      try {
        await db.thumbnails.put(cache);
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !["UnknownError", "DataCloneError"].includes(error.name)
        )
          throw error;
        await db.thumbnails.put({
          ...cache,
          blob: undefined,
          bytes: await blob.arrayBuffer(),
        });
      }
      return blob;
    });
  }
  async saveProject(kind: Kind, project: Project, version?: string) {
    validateProject(kind, project);
    this.requireConnected();
    const content = jsonBlob(project);
    const existing = this.files.find((f) => f.assetId === project.id);
    let stored: StoredFile;
    if (existing) {
      stored = await storage.updateContent(
        existing.fileId,
        content,
        version || existing.version,
      );
      if (
        stored.name !== `${project.name}.json` ||
        !stored.tagIds.includes(`editor-${kind}`)
      )
        stored = await storage.updateMetadata(
          stored.fileId,
          {
            name: `${project.name}.json`,
            tagIds: [...new Set([...stored.tagIds, `editor-${kind}`])],
          },
          stored.version,
        );
    } else
      stored = await storage.createFile({
        content,
        metadata: {
          assetId: project.id,
          name: `${project.name}.json`,
          type: "json",
          tagIds: ["json", `editor-${kind}`],
        },
      });
    await this.putFile(stored);
    return stored;
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
    for (const f of this.files.filter((f) =>
      ["map", "character"].includes(editorKind(f) || ""),
    )) {
      try {
        const p = await this.openProject(f);
        if (referenceIds(p).some((id) => ids.includes(id))) found.push(f.name);
      } catch {
        found.push(`${f.name}（参照の確認に失敗）`);
      }
    }
    return [...new Set(found)];
  }
  async diagnostics() {
    const issues: string[] = [];
    const ids = new Set(this.files.map((f) => f.assetId));
    for (const f of this.files) {
      if (editorKind(f))
        try {
          const p = await this.openProject(f);
          for (const id of referenceIds(p))
            if (!ids.has(id))
              issues.push(`${f.name}: 素材 ${id} が見つかりません`);
        } catch (e) {
          issues.push(`${f.name}: ${String(e)}`);
        }
    }
    return issues;
  }
}
export const app = new AssetService();
