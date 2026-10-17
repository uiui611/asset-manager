import Dexie from "dexie";
import { expect, it } from "vitest";
import { AssetDatabase } from "../../src/database/db";

it("drops the unused waveform cache without deleting other stores", async () => {
  const name = `cache-upgrade-${crypto.randomUUID()}`;
  const old = new Dexie(name);
  old.version(1).stores({
    assets: "assetId,&fileId,type,modifiedTime,sha256,*tagIds",
    fileMap: "fileId,assetId",
    tags: "tagId",
    thumbnails: "assetId",
    projects: "projectId,kind",
    syncState: "key",
    operationJournal: "id,status",
    waveforms: "assetId",
  });
  const current = new AssetDatabase(name);
  try {
    await old.open();
    for (const table of old.tables) {
      const key = table.schema.primKey.keyPath as string;
      await table.put({ [key]: "saved", marker: table.name });
    }
    old.close();
    await current.open();
    expect(current.tables.some((table) => table.name === "waveforms")).toBe(false);
    for (const table of current.tables) expect((await table.get("saved"))?.marker).toBe(table.name);
  } finally {
    old.close();
    await current.delete();
  }
});
