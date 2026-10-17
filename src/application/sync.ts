import type { StoredFile } from "../domain/models";
import type { FilePage } from "../storage/asset-storage";

export class SyncService {
  constructor(
    private storage: { listManagedFiles(cursor?: string, signal?: AbortSignal): Promise<FilePage> },
  ) {}
  async sync(progress: (text: string) => void = () => {}, signal?: AbortSignal) {
    const files: StoredFile[] = [];
    const cursors = new Set<string>();
    let cursor: string | undefined;
    do {
      signal?.throwIfAborted();
      const page = await this.storage.listManagedFiles(cursor, signal);
      signal?.throwIfAborted();
      files.push(...page.files);
      cursor = page.nextCursor;
      if (cursor && cursors.has(cursor))
        throw new Error("一覧のページ情報が重複しています。もう一度更新してください。");
      if (cursor) cursors.add(cursor);
      progress(`${files.length}件を読み込み中`);
    } while (cursor);
    return files;
  }
}
