import Fuse from "fuse.js";
import type { StoredFile, Tag } from "./models";
export class AssetSearch {
  private fuse: Fuse<{ file: StoredFile; tagNames: string[] }>;
  private tags = new Map<string, Set<string>>();
  constructor(
    private files: StoredFile[],
    tags: Tag[] = [],
  ) {
    const names = new Map(tags.map((t) => [t.tagId, t.name]));
    this.fuse = new Fuse(
      files.map((file) => ({ file, tagNames: file.tagIds.map((id) => names.get(id) || id) })),
      {
        keys: ["file.name", "file.description", "tagNames"],
        threshold: 0.35,
        ignoreLocation: true,
      },
    );
    for (const file of files)
      for (const tag of file.tagIds) {
        if (!this.tags.has(tag)) this.tags.set(tag, new Set());
        this.tags.get(tag)?.add(file.assetId);
      }
  }
  find(query = "", type = "", tag = "") {
    const results = query.trim() ? this.fuse.search(query).map((x) => x.item.file) : this.files;
    return results.filter(
      (f) =>
        (!type || f.type === type || (type === "audio" && f.tagIds.includes("editor-sound"))) &&
        (!tag || this.tags.get(tag)?.has(f.assetId)),
    );
  }
}
