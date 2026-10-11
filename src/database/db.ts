import Dexie, { type Table } from "dexie";
import type { OperationJournal, Project, StoredFile, Tag } from "../domain/models";
export class AssetDatabase extends Dexie {
  assets!: Table<StoredFile, string>;
  fileMap!: Table<{ fileId: string; assetId: string }, string>;
  tags!: Table<Tag, string>;
  thumbnails!: Table<
    { assetId: string; blob?: Blob; bytes?: ArrayBuffer; version: string },
    string
  >;
  projects!: Table<
    {
      projectId: string;
      data: Project;
      dirty: boolean;
      version?: string;
      kind: string;
    },
    string
  >;
  syncState!: Table<{ key: string; value: string }, string>;
  operationJournal!: Table<OperationJournal, string>;
  waveforms!: Table<{ assetId: string; values: number[]; version: string }, string>;
  constructor(name = "asset-atelier-rustfs-v2") {
    super(name);
    this.version(1).stores({
      assets: "assetId,&fileId,type,modifiedTime,sha256,*tagIds",
      fileMap: "fileId,assetId",
      tags: "tagId",
      thumbnails: "assetId",
      projects: "projectId,kind",
      syncState: "key",
      operationJournal: "id,status",
      waveforms: "assetId",
    });
  }
}
export const db = new AssetDatabase();
