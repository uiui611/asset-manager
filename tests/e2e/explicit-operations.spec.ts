import { expect, test } from "@playwright/test";
import type { StoredFile } from "../../src/domain/models";

test("without IndexedDB, unknown uploads require result confirmation and an explicit same-ID retry", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "indexedDB", {
      get() {
        throw new Error("IndexedDB must not be opened");
      },
    });
  });
  const attempts: string[] = [];
  const files: StoredFile[] = [];
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith("/tags")) return route.fulfill({ json: [] });
    if (path.endsWith("/assets")) return route.fulfill({ json: { files } });
    const id = path.split("/assets/")[1]?.split("/")[0];
    if (request.method() === "PUT") {
      attempts.push(id);
      if (attempts.length === 1) return route.abort("failed");
      const metadata = /name="metadata"\r\n\r\n([\s\S]*?)\r\n--/.exec(
        request.postData() || "",
      )?.[1];
      if (!metadata) throw new Error("multipart metadata missing");
      const file = {
        ...JSON.parse(metadata),
        assetId: id,
        fileId: id,
        version: "1",
        modifiedTime: "2026-10-17",
        size: 1,
      } as StoredFile;
      files.push(file);
      return route.fulfill({ json: file });
    }
    return route.fulfill({ status: 404, json: { error: "未登録です。" } });
  });
  await page.goto("/");
  await page.evaluate(async () =>
    (await import("/src/application/asset-service.ts")).app.connect(),
  );
  const png = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 2;
    canvas.height = 2;
    return canvas.toDataURL().split(",")[1];
  });
  await page.locator("#upload").setInputFiles({
    name: "manual.png",
    mimeType: "image/png",
    buffer: Buffer.from(png, "base64"),
  });
  const panel = page.locator("operation-progress").first();
  await expect(panel.getByText("素材の登録 · 結果不明", { exact: true })).toBeVisible();
  await expect(panel.getByRole("button", { name: /再試行/ })).toHaveCount(0);
  await page.clock.install();
  await page.evaluate(() => {
    window.dispatchEvent(new Event("online"));
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.clock.fastForward(60_000);
  expect(attempts).toHaveLength(1);
  await panel.getByRole("button", { name: "結果を確認", exact: true }).click();
  await expect(panel.getByRole("button", { name: /^再試行/ })).toBeVisible();
  expect(attempts).toHaveLength(1);
  await panel.getByRole("button", { name: /^再試行/ }).click();
  await expect(panel.getByText("素材の登録 · 完了", { exact: true })).toBeVisible();
  expect(attempts).toHaveLength(2);
  expect(attempts[1]).toBe(attempts[0]);
  await page.reload();
  await page.evaluate(async () =>
    (await import("/src/application/asset-service.ts")).app.connect(),
  );
  await expect(page.getByRole("button", { name: "manual.png の詳細", exact: true })).toBeVisible();
  expect(attempts).toHaveLength(2);
  expect(
    await page.evaluate(
      async () => (await import("/src/application/asset-service.ts")).app.operations.length,
    ),
  ).toBe(0);
});

test("pagehide invalidates file preparation and BFCache restoration never starts an upload", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { app, storage } = await import("/src/application/asset-service.ts");
    storage.connected = true;
    let sent = 0;
    storage.createFile = async () => {
      sent++;
      throw new Error("unexpected write");
    };
    let release: () => void = () => {};
    const original = window.Worker;
    let hashing = false;
    window.Worker = class {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror = null;
      postMessage() {
        hashing = true;
        release = () => this.onmessage?.(new MessageEvent("message", { data: { result: "hash" } }));
      }
      terminate() {}
    } as unknown as typeof Worker;
    const canvas = document.createElement("canvas");
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((value) => resolve(value as Blob), "image/png"),
    );
    const work = app.enqueueImport([new File([blob], "late.png", { type: "image/png" })]);
    while (!hashing) await new Promise((resolve) => setTimeout(resolve, 5));
    const warning = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(warning);
    const warned = warning.defaultPrevented;
    window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
    release();
    await work;
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    window.Worker = original;
    return { warned, sent, pending: app.hasUnfinishedOperations };
  });
  expect(result).toEqual({ warned: true, sent: 0, pending: false });
});

test("legacy browser stores remain untouched and never execute on startup", async ({ page }) => {
  let writes = 0;
  await page.route("**/api/**", async (route) => {
    if (route.request().method() !== "GET") writes++;
    return route.fulfill({ json: route.request().url().includes("/tags") ? [] : { files: [] } });
  });
  await page.goto("/");
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("asset-atelier-rustfs-v2", 7);
      request.onupgradeneeded = () => {
        for (const name of ["operationJournal", "projects", "fileMap"])
          request.result.createObjectStore(name);
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction(
          ["operationJournal", "projects", "fileMap"],
          "readwrite",
        );
        for (const name of ["operationJournal", "projects", "fileMap"])
          transaction
            .objectStore(name)
            .put({ marker: name, status: "pending", type: "bulk-trash" }, "legacy");
        transaction.oncomplete = () => {
          database.close();
          resolve();
        };
        transaction.onerror = () => reject(transaction.error);
      };
    });
  });
  await page.reload();
  await page.evaluate(async () =>
    (await import("/src/application/asset-service.ts")).app.connect(),
  );
  const preserved = await page.evaluate(async () => {
    return new Promise<{ version: number; markers: string[] }>((resolve, reject) => {
      const request = indexedDB.open("asset-atelier-rustfs-v2");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        const names = ["operationJournal", "projects", "fileMap"];
        const transaction = database.transaction(names, "readonly");
        const requests = names.map((name) => transaction.objectStore(name).get("legacy"));
        transaction.oncomplete = () => {
          const result = {
            version: database.version,
            markers: requests.map((entry) => entry.result.marker),
          };
          database.close();
          resolve(result);
        };
      };
    });
  });
  expect(preserved).toEqual({ version: 7, markers: ["operationJournal", "projects", "fileMap"] });
  expect(writes).toBe(0);
});

test("a save name prompt cannot start a stale write after pagehide", async ({ page }) => {
  await page.goto("/#sounds");
  await expect(page.getByLabel("効果音名", { exact: true })).toBeVisible();
  await page.evaluate(async () => {
    const { app, storage } = await import("/src/application/asset-service.ts");
    storage.connected = true;
    app.changed();
  });
  await page.getByRole("button", { name: "保存する", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "保存名を入力", exact: true })).toBeVisible();
  await page.evaluate(() =>
    window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })),
  );
  await page.getByLabel("保存名", { exact: true }).fill("stale-save");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  expect(
    await page.evaluate(
      async () => (await import("/src/application/asset-service.ts")).app.operations.length,
    ),
  ).toBe(0);
});
