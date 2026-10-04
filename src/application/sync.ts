import type { AssetDatabase } from "../database/db";
import type { StoredFile } from "../domain/models";
import type { FilePage } from "../storage/asset-storage";
export class SyncService {
  constructor(
    private db: AssetDatabase,
    private storage: { listManagedFiles(cursor?: string): Promise<FilePage> },
  ) {}
  async sync(progress: (text: string) => void = () => {}) {
    const files: StoredFile[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.storage.listManagedFiles(cursor);
      files.push(...page.files);
      cursor = page.nextCursor;
      progress(`${files.length}件を読み込み中`);
    } while (cursor);
    await this.db.transaction(
      "rw",
      [
        this.db.assets,
        this.db.fileMap,
        this.db.thumbnails,
        this.db.waveforms,
        this.db.syncState,
      ],
      async () => {
        const versions = new Map(files.map((f) => [f.assetId, f.version]));
        for (const old of await this.db.assets.toArray())
          if (versions.get(old.assetId) !== old.version) {
            await this.db.thumbnails.delete(old.assetId);
            await this.db.waveforms.delete(old.assetId);
          }
        await this.db.assets.clear();
        await this.db.assets.bulkPut(files);
        await this.db.fileMap.clear();
        await this.db.fileMap.bulkPut(
          files.map((f) => ({ fileId: f.fileId, assetId: f.assetId })),
        );
        await this.db.syncState.put({
          key: "lastSync",
          value: new Date().toISOString(),
        });
      },
    );
  }
}
