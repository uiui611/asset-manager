import type { StoredFile } from "../domain/models";
export interface FilePage {
  files: StoredFile[];
  nextCursor?: string;
}
export interface CreateFileInput {
  content: Blob;
  metadata: Partial<StoredFile> & { assetId: string; name: string };
}
export interface AssetStorage {
  readonly connected: boolean;
  authenticate(signal?: AbortSignal): Promise<void>;
  listManagedFiles(cursor?: string, signal?: AbortSignal): Promise<FilePage>;
  getFile(fileId: string, signal?: AbortSignal): Promise<Blob>;
  getMetadata(fileId: string, signal?: AbortSignal): Promise<StoredFile>;
  createFile(input: CreateFileInput, signal?: AbortSignal): Promise<StoredFile>;
  updateMetadata(
    fileId: string,
    input: Partial<StoredFile>,
    expectedVersion?: string,
    signal?: AbortSignal,
  ): Promise<StoredFile>;
  updateContent(
    fileId: string,
    content: Blob,
    expectedVersion?: string,
    metadata?: Partial<StoredFile>,
    signal?: AbortSignal,
  ): Promise<StoredFile>;
  trashFile(fileId: string, expectedVersion?: string, signal?: AbortSignal): Promise<void>;
}
