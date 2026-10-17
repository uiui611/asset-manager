import type { StoredFile, Tag } from "../domain/models";
import type { CreateFileInput, FilePage } from "./asset-storage";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
  get outcomeUnknown() {
    return this.status === undefined || this.status === 408 || this.status >= 500;
  }
}
export class HttpAssetStorage {
  connected = false;
  private base = new URL("api/", document.baseURI).href;
  private writeController = new AbortController();
  get writeSignal() {
    return this.writeController.signal;
  }
  cancelWrites() {
    this.writeController.abort();
    this.writeController = new AbortController();
  }
  private signal(signal?: AbortSignal) {
    return signal ? AbortSignal.any([signal, this.writeSignal]) : this.writeSignal;
  }
  async request(path: string, options: RequestInit = {}) {
    options.signal?.throwIfAborted();
    let response: Response;
    try {
      response = await fetch(this.base + path, options);
    } catch (error) {
      if (options.signal?.aborted) throw error;
      throw new ApiError(
        error instanceof Error ? error.message : "サーバーに接続できませんでした。",
      );
    }
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new ApiError(
        body.error || `ストレージ要求に失敗しました (${response.status})`,
        response.status,
      );
    }
    return response;
  }
  async authenticate(signal?: AbortSignal) {
    await this.request("tags", { signal });
    signal?.throwIfAborted();
    this.connected = true;
  }
  disconnect() {
    this.cancelWrites();
    this.connected = false;
  }
  async listManagedFiles(cursor = "", signal?: AbortSignal): Promise<FilePage> {
    return (await this.request(`assets?after=${encodeURIComponent(cursor)}`, { signal })).json();
  }
  async getFile(id: string, signal?: AbortSignal): Promise<Blob> {
    return (await this.request(`assets/${id}/content`, { signal })).blob();
  }
  async getMetadata(id: string, signal?: AbortSignal): Promise<StoredFile> {
    return (await this.request(`assets/${id}`, { signal })).json();
  }
  async createFile(input: CreateFileInput, signal?: AbortSignal): Promise<StoredFile> {
    return this.upload(
      input.metadata.assetId,
      input.content,
      input.metadata,
      undefined,
      this.signal(signal),
    );
  }
  private async upload(
    id: string,
    content: Blob,
    metadata: Partial<StoredFile>,
    version: string | undefined,
    signal: AbortSignal,
  ): Promise<StoredFile> {
    signal.throwIfAborted();
    const body = new FormData();
    body.append("metadata", JSON.stringify(metadata));
    body.append("file", content, metadata.name || "asset.json");
    return (
      await this.request(`assets/${id}/content`, {
        method: "PUT",
        body,
        signal,
        headers: version ? { "If-Match": version } : {},
      })
    ).json();
  }
  async updateContent(
    id: string,
    content: Blob,
    version?: string,
    metadata: Partial<StoredFile> = {},
    signal?: AbortSignal,
  ): Promise<StoredFile> {
    const active = this.signal(signal);
    const previous =
      version &&
      metadata.name &&
      metadata.type &&
      metadata.tagIds &&
      metadata.description !== undefined
        ? metadata
        : await this.getMetadata(id, active);
    active.throwIfAborted();
    return this.upload(
      id,
      content,
      { ...previous, ...metadata },
      version || previous.version,
      active,
    );
  }
  async updateMetadata(
    id: string,
    input: Partial<StoredFile>,
    version?: string,
    signal?: AbortSignal,
  ): Promise<StoredFile> {
    return (
      await this.request(`assets/${id}`, {
        method: "PATCH",
        signal: this.signal(signal),
        headers: { "Content-Type": "application/json", "If-Match": version || "" },
        body: JSON.stringify(input),
      })
    ).json();
  }
  async trashFile(id: string, version?: string, signal?: AbortSignal) {
    await this.request(`assets/${id}`, {
      method: "DELETE",
      signal: this.signal(signal),
      headers: { "If-Match": version || "" },
    });
  }
  async listTags(signal?: AbortSignal): Promise<Tag[]> {
    return (await this.request("tags", { signal })).json();
  }
  async createTag(name: string, signal?: AbortSignal): Promise<Tag> {
    return (
      await this.request("tags", {
        method: "POST",
        signal: this.signal(signal),
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      })
    ).json();
  }
}
