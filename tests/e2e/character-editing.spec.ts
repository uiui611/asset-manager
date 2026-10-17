import { expect, type Page, test } from "@playwright/test";

async function setup(page: Page) {
  await page.goto("/#characters");
  await expect(page.getByRole("heading", { name: "キャラクター合成", exact: true })).toBeVisible();
  await page.evaluate(async () => {
    const { app, storage } = await import("/src/application/asset-service.ts");
    const { ApiError } = await import("/src/storage/http-asset-storage.ts");
    await app.init();
    Object.defineProperty(storage, "connected", { get: () => true });
    const canvas = document.createElement("canvas");
    canvas.width = 100;
    canvas.height = 100;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas");
    ctx.fillStyle = "red";
    ctx.fillRect(0, 0, 100, 100);
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((b) => {
        if (b) resolve(b);
      }, "image/png"),
    );
    type FileRecord = import("/src/domain/models.ts").StoredFile;
    const files = new Map<string, { file: FileRecord; blob: Blob }>();
    storage.createFile = async (input) => {
      if (input.content.type.includes("json"))
        Reflect.set(window, "jsonWrites", (Reflect.get(window, "jsonWrites") || 0) + 1);
      if (input.content.type.includes("json") && Reflect.get(window, "failJson"))
        throw new Error("JSON保存エラー");
      const file = {
        fileId: input.metadata.assetId,
        type: "image",
        mimeType: input.content.type,
        size: input.content.size,
        version: "1",
        modifiedTime: new Date().toISOString(),
        tagIds: [],
        description: "",
        ...input.metadata,
      } as FileRecord;
      files.set(file.assetId, { file, blob: input.content });
      return file;
    };
    storage.getFile = async (id) => {
      const item = files.get(id);
      if (!item) throw new Error("missing");
      return item.blob;
    };
    storage.getMetadata = async (id) => {
      const reads = Reflect.get(window, "metadataReads") || {};
      reads[id] = (reads[id] || 0) + 1;
      Reflect.set(window, "metadataReads", reads);
      const item = files.get(id);
      if (!item) throw new ApiError("missing", 404);
      return item.file;
    };
    storage.updateContent = async (id, content, version, metadata = {}) => {
      const writes = Reflect.get(window, "contentWrites") || {};
      writes[id] = (writes[id] || 0) + 1;
      Reflect.set(window, "contentWrites", writes);
      const item = files.get(id);
      if (!item || item.file.version !== version) throw new Error("conflict");
      if (Reflect.get(window, "failAsset") === id) throw new ApiError("保存を拒否しました。", 409);
      if (Reflect.get(window, "rateLimitAsset") === id) {
        Reflect.deleteProperty(window, "rateLimitAsset");
        throw new ApiError("しばらく待って再試行してください。", 429);
      }
      const { hashBlob } = await import("/src/application/media.ts");
      const file = {
        ...item.file,
        ...metadata,
        version: String(Number(version) + 1),
        mimeType: content.type,
        size: content.size,
        sha256: await hashBlob(content),
      };
      files.set(id, { file, blob: content });
      if (Reflect.get(window, "lostResponse") === id) throw new Error("response lost");
      return file;
    };
    storage.updateMetadata = async (id, patch, version) => {
      const item = files.get(id);
      if (!item || item.file.version !== version) throw new Error("conflict");
      const file = {
        ...item.file,
        ...patch,
        version: String(Number(version) + 1),
      };
      files.set(id, { ...item, file });
      return file;
    };
    storage.listManagedFiles = async () => ({
      files: [...files.values()].map((item) => item.file),
    });
    storage.listTags = async () => app.tags;
    await app.putFile(
      await storage.createFile({
        content: blob,
        metadata: {
          assetId: "base",
          name: "base.png",
          type: "image",
          tagIds: ["image"],
        },
      }),
    );
    canvas.width = 20;
    canvas.height = 12;
    ctx.fillStyle = "green";
    ctx.fillRect(0, 0, 20, 12);
    const overlay = await new Promise<Blob>((resolve) =>
      canvas.toBlob((b) => {
        if (b) resolve(b);
      }, "image/png"),
    );
    await app.putFile(
      await storage.createFile({
        content: overlay,
        metadata: {
          assetId: "overlay",
          name: "overlay.jpg",
          type: "image",
          tagIds: ["image"],
        },
      }),
    );
    await app.refresh();
  });
  await page.getByRole("button", { name: "base.png", exact: true }).click();
  await page.getByRole("button", { name: "ベース画像にする", exact: true }).click();
  await expect(page.locator("#editor-canvas")).toHaveAttribute("width", "100");
}
test("selected character layer drags in image coordinates with one undo and wheel zoom", async ({
  page,
}) => {
  await setup(page);
  await page.getByLabel("表示倍率", { exact: true }).selectOption("2");
  const canvas = page.locator("#editor-canvas"),
    box = await canvas.boundingBox();
  if (!box) throw new Error("bounds");
  await page.mouse.move(box.x + 40, box.y + 40);
  await page.mouse.down();
  await page.mouse.move(box.x + 80, box.y + 60, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByLabel("X座標", { exact: true })).toHaveValue("20");
  await expect(page.getByLabel("Y座標", { exact: true })).toHaveValue("10");
  await page.getByRole("button", { name: "元に戻す", exact: true }).click();
  await expect(page.getByLabel("X座標", { exact: true })).toHaveValue("0");
  await expect(page.getByLabel("Y座標", { exact: true })).toHaveValue("0");
  await page.getByRole("button", { name: "やり直す", exact: true }).click();
  await expect(page.getByLabel("X座標", { exact: true })).toHaveValue("20");
  await canvas.hover();
  await page.mouse.wheel(0, -100);
  await expect
    .poll(async () => Number(await page.getByLabel("表示倍率", { exact: true }).inputValue()))
    .toBeGreaterThan(2);
  await canvas.hover();
  await page.mouse.wheel(0, 200);
  await expect
    .poll(async () => Number(await page.getByLabel("表示倍率", { exact: true }).inputValue()))
    .toBeLessThan(2);
  await expect(page.getByLabel("X座標", { exact: true })).toHaveValue("20");
  const zoom = await page.getByLabel("表示倍率", { exact: true }).inputValue();
  await page.locator("asset-palette").hover();
  await page.mouse.wheel(0, 100);
  await page.waitForTimeout(100);
  expect(await page.getByLabel("表示倍率", { exact: true }).inputValue()).toBe(zoom);
});

async function prepareComposition(page: Page) {
  await setup(page);
  await page.getByRole("button", { name: "overlay.jpg", exact: true }).click();
  await page.getByRole("button", { name: "レイヤーに追加", exact: true }).click();
  await page.locator("editor-page").evaluate(async (el) => {
    const editor = el as import("/src/pages/editor/editor-page.ts").EditorPage;
    if (!("canvas" in editor.project)) throw new Error("character");
    editor.project.name = "baked";
    Object.assign(editor.project.layers[0], {
      x: -10,
      y: -5,
      scaleX: 0.8,
      scaleY: 1.2,
      rotation: 5,
    });
    Object.assign(editor.project.layers[1], {
      x: 30,
      y: 20,
      scaleX: 1.5,
      scaleY: 0.8,
      rotation: 25,
      opacity: 0.5,
    });
    editor.requestUpdate();
    await editor.updateComplete;
  });
  await expect
    .poll(() =>
      page
        .locator("editor-page")
        .evaluate((el) => (Reflect.get(el, "images") as Map<string, unknown>).size),
    )
    .toBe(2);
}
function visualDifference(a: number[], b: number[]) {
  let max = 0;
  for (let i = 0; i < a.length; i += 4) {
    max = Math.max(max, Math.abs(a[i + 3] - b[i + 3]));
    for (let c = 0; c < 3; c++)
      max = Math.max(max, Math.abs((a[i + c] * a[i + 3]) / 255 - (b[i + c] * b[i + 3]) / 255));
  }
  return max;
}
async function pixels(page: Page) {
  return page.locator("#editor-canvas").evaluate((el) => {
    const ctx = (el as HTMLCanvasElement).getContext("2d");
    if (!ctx) throw new Error("canvas");
    return Array.from(ctx.getImageData(0, 0, 100, 100).data);
  });
}
async function bake(page: Page) {
  await page.getByRole("button", { name: "元素材を切り出して上書き", exact: true }).click();
  await page
    .getByRole("dialog", { name: "元素材を切り出して上書き" })
    .getByRole("button", { name: "上書きして保存", exact: true })
    .click();
}
test("baking overwrites source PNGs, normalizes and saves JSON, and preserves composited pixels", async ({
  page,
}) => {
  await prepareComposition(page);
  const before = await pixels(page);
  await bake(page);
  await expect(page.getByText("2件の元素材とJSONを保存しました。", { exact: true })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  const after = await pixels(page);
  expect(Math.max(...after.map((v, i) => Math.abs(v - before[i])))).toBeLessThanOrEqual(2);
  await expect(page.getByLabel("X座標", { exact: true })).toHaveValue("0");
  await expect(page.getByLabel("横倍率", { exact: true })).toHaveValue("1");
  await expect(page.getByLabel("回転 (°)", { exact: true })).toHaveValue("0");
  await expect(page.getByRole("button", { name: "元に戻す", exact: true })).toBeDisabled();
  const result = await page.evaluate(async () => {
    const { app, storage } = await import("/src/application/asset-service.ts");
    const file = app.files.find((f) => f.name === "baked.json");
    if (!file) throw new Error("json");
    const json = await app.openProject(file);
    const overlay = await storage.getMetadata("overlay");
    const blob = await storage.getFile("overlay");
    const { loadImage } = await import("/src/canvas/images.ts");
    const image = await loadImage(blob);
    return {
      json,
      overlay,
      width: image.naturalWidth,
      height: image.naturalHeight,
      id: file.assetId,
    };
  });
  expect(result.overlay.name).toBe("overlay.png");
  expect(result.overlay.version).toBe("2");
  expect([result.width, result.height]).toEqual([100, 100]);
  expect(
    "layers" in result.json &&
      result.json.layers.every(
        (l) =>
          "x" in l &&
          l.x === 0 &&
          l.y === 0 &&
          l.scaleX === 1 &&
          l.rotation === 0 &&
          l.opacity === 1,
      ),
  ).toBe(true);
  await page.getByLabel("開く", { exact: true }).selectOption(result.id);
  await expect(page.getByLabel("編集用JSON名", { exact: true })).toHaveValue("baked");
  expect(visualDifference(await pixels(page), before)).toBeLessThanOrEqual(2);
});
test("baking rejects duplicate or missing references without touching sources", async ({
  page,
}) => {
  await prepareComposition(page);
  await page.locator("editor-page").evaluate((el) => {
    const editor = el as import("/src/pages/editor/editor-page.ts").EditorPage;
    if ("canvas" in editor.project) editor.project.layers[1].assetId = "base";
  });
  await bake(page);
  await expect(page.getByRole("alert")).toContainText("同じ元素材");
  await page.locator("editor-page").evaluate((el) => {
    const editor = el as import("/src/pages/editor/editor-page.ts").EditorPage;
    if ("canvas" in editor.project) editor.project.layers[1].assetId = "missing";
  });
  await bake(page);
  await expect(page.getByRole("alert")).toContainText("見つからない素材");
  expect(
    await page.evaluate(async () => {
      const { storage } = await import("/src/application/asset-service.ts");
      return (await storage.getMetadata("base")).version;
    }),
  ).toBe("1");
});
test("partial overwrite failure keeps normalized successes unsaved until explicit JSON save", async ({
  page,
}) => {
  await prepareComposition(page);
  await page.evaluate(() => Reflect.set(window, "failAsset", "overlay"));
  await bake(page);
  await expect(page.getByRole("alert")).toContainText("1 / 2 件");
  expect(await page.evaluate(() => Reflect.get(window, "jsonWrites") || 0)).toBe(0);
  expect(
    await page.evaluate(async () =>
      (await import("/src/application/asset-service.ts")).app.files.some(
        (file) => file.name === "baked.json",
      ),
    ),
  ).toBe(false);
  const current = await page
    .locator("editor-page")
    .evaluate(
      (element) => (element as import("/src/pages/editor/editor-page.ts").EditorPage).project,
    );
  expect("layers" in current && "x" in current.layers[0] && current.layers[0].x).toBe(0);
  expect("layers" in current && "x" in current.layers[1] && current.layers[1].x).toBe(30);
  await page.getByRole("button", { name: "保存する", exact: true }).click();
  await expect(page.getByText("保存済み", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => Reflect.get(window, "jsonWrites"))).toBe(1);
  const data = await page.evaluate(async () => {
    const { app } = await import("/src/application/asset-service.ts");
    const file = app.files.find((f) => f.name === "baked.json");
    if (!file) throw new Error("json");
    return app.openProject(file);
  });
  expect("layers" in data && "x" in data.layers[0] && data.layers[0].x).toBe(0);
  expect("layers" in data && "x" in data.layers[1] && data.layers[1].x).toBe(30);
});

test("hidden layers are cropped without becoming visible and failed JSON save can be retried", async ({
  page,
}) => {
  await prepareComposition(page);
  await page.locator("editor-page").evaluate(async (el) => {
    const editor = el as import("/src/pages/editor/editor-page.ts").EditorPage;
    editor.project.layers[0].visible = false;
    editor.requestUpdate();
    await editor.updateComplete;
  });
  const before = await pixels(page);
  await page.evaluate(() => Reflect.set(window, "failJson", true));
  await bake(page);
  await expect(page.getByRole("alert")).toContainText("JSONを保存できませんでした");
  await expect(page.getByLabel("X座標", { exact: true })).toHaveValue("0");
  expect(visualDifference(await pixels(page), before)).toBeLessThanOrEqual(2);
  await page.getByRole("button", { name: "素材ライブラリ", exact: false }).click();
  await expect(page.getByRole("dialog", { name: "未完了の操作" })).toBeVisible();
  await page.getByRole("button", { name: "この画面に留まる", exact: true }).click();
  await page.evaluate(() => Reflect.set(window, "failJson", false));
  const operation = page.getByRole("article", { name: "素材の登録の操作結果", exact: true });
  await operation.getByRole("button", { name: "結果を確認", exact: true }).click();
  await operation.getByRole("button", { name: /^再試行/ }).click();
  await expect(operation.getByText("素材の登録 · 完了", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => Reflect.get(window, "jsonWrites"))).toBe(2);
  const layer = await page.evaluate(async () => {
    const { app, storage } = await import("/src/application/asset-service.ts");
    const file = app.files.find((f) => f.name === "baked.json");
    if (!file) throw new Error("saved");
    const project = await app.openProject(file);
    return {
      visible: "layers" in project && project.layers[0].visible,
      version: (await storage.getMetadata("base")).version,
    };
  });
  expect(layer.visible).toBe(false);
  expect(layer.version).toBe("2");
});

test("lost overwrite response requires explicit checking before normalization and JSON save", async ({
  page,
}) => {
  await prepareComposition(page);
  const before = await pixels(page);
  await page.evaluate(() => Reflect.set(window, "lostResponse", "overlay"));
  await bake(page);
  await expect(page.getByRole("alert")).toContainText("1 / 2 件");
  const operation = page
    .getByRole("article", { name: "保存の操作結果", exact: true })
    .filter({ hasText: "結果不明" });
  await expect(operation.getByRole("button", { name: "結果を確認", exact: true })).toBeVisible();
  await expect(operation.getByRole("button", { name: "破棄", exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => Reflect.get(window, "jsonWrites") || 0)).toBe(0);
  expect(await page.evaluate(() => Reflect.get(window, "metadataReads").overlay)).toBe(1);

  for (const name of ["保存する", "合成PNGをストレージへ", "元素材を切り出して上書き"]) {
    await page.getByRole("button", { name, exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("上書き結果が未確認");
  }
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await page.evaluate(() => Reflect.get(window, "contentWrites"))).toEqual({
    base: 1,
    overlay: 1,
  });
  expect(await page.evaluate(() => Reflect.get(window, "jsonWrites") || 0)).toBe(0);
  expect(await page.evaluate(() => Reflect.get(window, "metadataReads").overlay)).toBe(1);

  await operation.getByRole("button", { name: "結果を確認", exact: true }).click();
  await expect(page.getByText(/確認できた元素材を編集内容へ反映しました/)).toBeVisible();
  await expect(page.getByLabel("X座標", { exact: true })).toHaveValue("0");
  await expect(page.getByLabel("横倍率", { exact: true })).toHaveValue("1");
  expect(await page.evaluate(() => Reflect.get(window, "metadataReads").overlay)).toBe(2);
  expect(await page.evaluate(() => Reflect.get(window, "contentWrites"))).toEqual({
    base: 1,
    overlay: 1,
  });
  expect(await page.evaluate(() => Reflect.get(window, "jsonWrites") || 0)).toBe(0);
  expect(visualDifference(await pixels(page), before)).toBeLessThanOrEqual(2);
  expect(
    await page
      .locator("editor-page")
      .evaluate((element) =>
        (Reflect.get(element, "imageVersions") as Map<string, string>).get("overlay"),
      ),
  ).toBe("2");

  await page.getByRole("button", { name: "保存する", exact: true }).click();
  await expect(page.getByText("保存済み", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => Reflect.get(window, "jsonWrites"))).toBe(1);
  expect(await page.evaluate(() => Reflect.get(window, "contentWrites"))).toEqual({
    base: 1,
    overlay: 1,
  });
});

test("explicit retry of an unsaved layer normalizes it without automatically saving JSON", async ({
  page,
}) => {
  await prepareComposition(page);
  const before = await pixels(page);
  await page.evaluate(() => Reflect.set(window, "rateLimitAsset", "overlay"));
  await bake(page);
  await expect(page.getByRole("alert")).toContainText("1 / 2 件");
  const operation = page
    .getByRole("article", { name: "保存の操作結果", exact: true })
    .filter({ hasText: "失敗" });
  expect(await page.evaluate(() => Reflect.get(window, "jsonWrites") || 0)).toBe(0);
  await operation.getByRole("button", { name: /^再試行/ }).click();
  await expect(page.getByText(/確認できた元素材を編集内容へ反映しました/)).toBeVisible();
  await expect(page.getByLabel("X座標", { exact: true })).toHaveValue("0");
  expect(await page.evaluate(() => Reflect.get(window, "contentWrites"))).toEqual({
    base: 1,
    overlay: 2,
  });
  expect(await page.evaluate(() => Reflect.get(window, "jsonWrites") || 0)).toBe(0);
  expect(visualDifference(await pixels(page), before)).toBeLessThanOrEqual(2);
  await page.getByRole("button", { name: "保存する", exact: true }).click();
  await expect(page.getByText("保存済み", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => Reflect.get(window, "jsonWrites"))).toBe(1);
});
