import type { StoredFile, Tag } from "../domain/models";
import type { CreateFileInput, FilePage } from "./asset-storage";
export class HttpAssetStorage {
  connected = false;
  private base = new URL("api/", document.baseURI).href;
  async request(path: string, options: RequestInit = {}) {
    const response = await fetch(this.base + path, options);
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || `ストレージ要求に失敗しました (${response.status})`);
    }
    return response;
  }
  async authenticate() {
    await this.request("tags");
    this.connected = true;
  }
  disconnect() {
    this.connected = false;
  }
  async listManagedFiles(cursor = ""): Promise<FilePage> {
    return (await this.request(`assets?after=${encodeURIComponent(cursor)}`)).json();
  }
  async getFile(id: string): Promise<Blob> {
    return (await this.request(`assets/${id}/content`)).blob();
  }
  async getMetadata(id: string): Promise<StoredFile> {
    return (await this.request(`assets/${id}`)).json();
  }
  async createFile(input: CreateFileInput): Promise<StoredFile> {
    return this.upload(input.metadata.assetId, input.content, input.metadata);
  }
  private async upload(
    id: string,
    content: Blob,
    metadata: Partial<StoredFile>,
    version?: string,
  ): Promise<StoredFile> {
    const body = new FormData();
    body.append("metadata", JSON.stringify(metadata));
    body.append("file", content, metadata.name || "asset.json");
    return (
      await this.request(`assets/${id}/content`, {
        method: "PUT",
        body,
        headers: version ? { "If-Match": version } : {},
      })
    ).json();
  }
  async updateContent(
    id: string,
    content: Blob,
    version?: string,
    metadata: Partial<StoredFile> = {},
  ): Promise<StoredFile> {
    const previous = await this.getMetadata(id);
    return this.upload(id, content, { ...previous, ...metadata }, version || previous.version);
  }
  async updateMetadata(
    id: string,
    input: Partial<StoredFile>,
    version?: string,
  ): Promise<StoredFile> {
    return (
      await this.request(`assets/${id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "If-Match": version || "",
        },
        body: JSON.stringify(input),
      })
    ).json();
  }
  async trashFile(id: string, version?: string) {
    await this.request(`assets/${id}`, {
      method: "DELETE",
      headers: { "If-Match": version || "" },
    });
  }
  async listTags(): Promise<Tag[]> {
    return (await this.request("tags")).json();
  }
  async createTag(name: string): Promise<Tag> {
    return (
      await this.request("tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      })
    ).json();
  }
}
