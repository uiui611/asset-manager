export type Kind = "asset" | "map" | "character" | "sound" | "collection";
export interface StoredFile {
  fileId: string;
  assetId: string;
  name: string;
  type: "image" | "audio" | "json";
  mimeType: string;
  size: number;
  modifiedTime: string;
  version: string;
  md5Checksum?: string;
  sha256?: string;
  tagIds: string[];
  description: string;
}
export interface Tag {
  tagId: string;
  name: string;
  color: string;
}
export interface AssetReference {
  assetId: string;
}
export interface MapLayer {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  locked: boolean;
  cells: number[];
  tileset?: { assetId: string; tileWidth: number; tileHeight: number };
}
export interface MapProject {
  schemaVersion: 1;
  id: string;
  name: string;
  width: number;
  height: number;
  tileWidth: number;
  tileHeight: number;
  layers: MapLayer[];
  tilesets: AssetReference[];
  updatedAt: string;
}
export interface CharacterLayer {
  id: string;
  assetId: string;
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  opacity: number;
  visible: boolean;
  zIndex: number;
}
export interface CharacterComposition {
  schemaVersion: 1;
  id: string;
  name: string;
  previewImage?: string;
  canvas: { width: number; height: number };
  layers: CharacterLayer[];
  updatedAt: string;
}
export interface SoundTrack {
  id: string;
  name: string;
  parameters: Record<string, number | string | boolean>;
  gain: number;
  offset: number;
  muted: boolean;
}
export interface SoundPreset {
  schemaVersion: 1;
  id: string;
  name: string;
  format: "multitrack";
  tracks: SoundTrack[];
  updatedAt: string;
}
export type Project = MapProject | CharacterComposition | SoundPreset;
export interface JournalItem {
  id: string;
  name: string;
  blob?: Blob;
  bytes?: ArrayBuffer;
  blobType?: string;
  metadata?: Partial<StoredFile>;
  fileId?: string;
}
export interface OperationJournal {
  id: string;
  type: "tile-split" | "upload" | "bulk-tag" | "bulk-trash";
  status: "pending" | "running" | "completed" | "failed";
  sourceAssetIds: string[];
  completedItems: string[];
  pendingItems: string[];
  items: JournalItem[];
  error?: string;
  createdAt: string;
}
export const uid = () => crypto.randomUUID();
export const now = () => new Date().toISOString();
export const isRaster = (file: StoredFile) =>
  file.type === "image" && file.mimeType !== "image/svg+xml";
