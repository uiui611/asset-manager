import type { StoredFile } from "../domain/models";
export interface FilePage {
  files: StoredFile[];
  nextCursor?: string;
}
export interface ChangePage {
  changes: { fileId: string; removed: boolean; file?: StoredFile }[];
  nextCursor?: string;
  newCursor?: string;
}
export interface CreateFileInput {
  content: Blob;
  metadata: Partial<StoredFile> & { assetId: string; name: string };
}
export interface AssetStorage {
  readonly connected: boolean;
  authenticate(): Promise<void>;
  listManagedFiles(cursor?: string): Promise<FilePage>;
  getFile(fileId: string): Promise<Blob>;
  getMetadata(fileId: string): Promise<StoredFile>;
  createFile(input: CreateFileInput): Promise<StoredFile>;
  updateMetadata(
    fileId: string,
    input: Partial<StoredFile>,
    expectedVersion?: string,
  ): Promise<StoredFile>;
  updateContent(fileId: string, content: Blob, expectedVersion?: string): Promise<StoredFile>;
  trashFile(fileId: string, expectedVersion?: string): Promise<void>;
}
