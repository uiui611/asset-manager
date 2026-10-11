import { expect, type Page, test } from "@playwright/test";
import { withSvgMetadata } from "../fixtures/png";

test("background upload, split, saved JSON, thumbnails, multitrack sound and missing references", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "素材ライブラリ" })).toBeVisible();
  const png = await setup(page);
  const payload = {
    name: "forest.png",
    mimeType: "image/png",
    buffer: withSvgMetadata(Buffer.from(png, "base64")),
  };
  await page.locator("#upload").setInputFiles(payload);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "forest.png の詳細", exact: true })).toBeVisible();
  const transfer = await page.evaluateHandle(
    (bytes) => {
      const data = new DataTransfer();
      data.items.add(new File([new Uint8Array(bytes)], "dropped.png", { type: "image/png" }));
      return data;
    },
    [...payload.buffer],
  );
  const card = page.getByRole("button", {
    name: "forest.png の詳細",
    exact: true,
  });
  await card.dispatchEvent("dragenter", { dataTransfer: transfer });
  await expect(page.getByText("画像・音声をドロップして追加", { exact: true })).toBeVisible();
  await card.dispatchEvent("dragover", { dataTransfer: transfer });
  await card.dispatchEvent("drop", { dataTransfer: transfer });
  await expect(page.getByText("画像・音声をドロップして追加", { exact: true })).toHaveCount(0);

  await expect(page.getByRole("button", { name: "dropped.png の詳細", exact: true })).toBeVisible();
  await page.locator("#split-upload").setInputFiles(payload);
  await page.getByLabel("タイル幅", { exact: true }).fill("16");
  await page.getByLabel("タイル高さ", { exact: true }).fill("16");
  await page.getByRole("button", { name: "分割結果を確認", exact: true }).click();
  await expect(page.getByText(/1枚のPNG/)).toBeVisible();
  await page.getByRole("button", { name: "画像素材として保存", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "forest_0001.png の詳細", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "マップエディター", exact: true }).click();
  await page.getByRole("button", { name: "forest_0001.png", exact: false }).click();
  await page.locator("#editor-canvas").click({ position: { x: 16, y: 16 } });
  await page.getByRole("button", { name: "保存する", exact: true }).click();
  await page.getByLabel("保存名", { exact: true }).fill("森のマップ");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByText("保存済み", { exact: true })).toBeVisible();
  const cells = await page.evaluate(async () => {
    const { app } = await import("/src/application/asset-service.ts");
    const file = app.files.find((f) => f.tagIds.includes("editor-map"));
    const map = file ? await app.openProject(file) : undefined;
    return map && "tilesets" in map ? map.layers[0].cells : [];
  });
  expect(cells[0]).toBe(0);
  if (testInfo.project.name === "chromium")
    await page.screenshot({
      path: "test-results/map-editor.png",
      fullPage: true,
    });
  await page.getByRole("button", { name: "キャラクター合成", exact: true }).click();
  await page.getByRole("button", { name: "forest_0001.png", exact: false }).click();
  await page.getByRole("button", { name: "ベース画像にする", exact: true }).click();
  await expect(page.locator("#editor-canvas")).toHaveAttribute("width", "16");
  await expect(page.locator("asset-thumbnail img").first()).toBeVisible();
  await page.locator("#editor-canvas").focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByLabel("X座標", { exact: true })).toHaveValue("1");
  await page.keyboard.press("+");
  await expect(page.getByLabel("横倍率", { exact: true })).toHaveValue("1.1");
  await expect(page.getByLabel("縦倍率", { exact: true })).toHaveValue("1.1");
  await page.getByLabel("横倍率", { exact: true }).fill("2");
  await page.getByLabel("横倍率", { exact: true }).blur();
  await expect(page.getByLabel("縦倍率", { exact: true })).toHaveValue("2");
  await page.getByLabel("編集用JSON名", { exact: true }).fill("森のキャラクター");
  await page.getByLabel("X座標", { exact: true }).fill("4");
  await page.getByLabel("X座標", { exact: true }).blur();
  await page.getByRole("button", { name: "保存する", exact: true }).click();
  await expect(page.getByText("保存済み", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "合成PNGをストレージへ", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.getByRole("button", { name: /素材ライブラリ/ }).click();
  await expect(
    page.getByRole("button", {
      name: "森のキャラクター.png の詳細",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "音楽・効果音", exact: true }).click();
  await page.getByLabel("効果音名", { exact: true }).fill("ライブラリ効果音");
  await page.getByRole("button", { name: "保存する", exact: true }).click();
  await expect(page.getByText("保存済み", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /素材ライブラリ/ }).click();
  await page.getByRole("button", { name: "JSON", exact: true }).click();
  await expect(page.locator("asset-card")).toHaveCount(2);
  await expect(page.locator("audio-row")).toHaveCount(1);
  await expect(
    page
      .getByRole("button", {
        name: "森のキャラクター.json の詳細",
        exact: true,
      })
      .locator("img"),
  ).toBeVisible();
  for (const [name, field, route] of [
    ["森のマップ", "編集用JSON名", "maps"],
    ["森のキャラクター", "編集用JSON名", "characters"],
    ["ライブラリ効果音", "効果音名", "sounds"],
  ]) {
    await page.getByRole("button", { name: `${name}.json の詳細`, exact: true }).click();
    await page.getByRole("button", { name: "編集画面で開く", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`#${route}\\?project=`));
    await expect(page.getByLabel(field, { exact: true })).toHaveValue(name);
    if (route === "maps") {
      await expect
        .poll(() =>
          page.locator("editor-page").evaluate(
            (el) =>
              (
                el as unknown as {
                  project: { layers: { cells: number[] }[] };
                }
              ).project.layers[0].cells[0],
          ),
        )
        .toBe(0);
    }
    if (route === "characters")
      await expect(page.getByLabel("X座標", { exact: true })).toHaveValue("4");
    await page.getByRole("button", { name: /素材ライブラリ/ }).click();
  }
  // A local source can be split without storing the source image.
  await page.locator("#split-upload").setInputFiles({ ...payload, name: "unregistered.png" });
  await page.getByLabel("タイル幅", { exact: true }).fill("16");
  await page.getByLabel("タイル高さ", { exact: true }).fill("16");
  await page.getByRole("button", { name: "分割結果を確認", exact: true }).click();
  await page.getByRole("button", { name: "画像素材として保存", exact: true }).click();
  await expect(
    page.getByRole("button", {
      name: "unregistered_0001.png の詳細",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "unregistered.png の詳細", exact: true }),
  ).toHaveCount(0);
  // Deleting a referenced image leaves the map editable and saveable.
  await page.getByRole("button", { name: "forest_0001.png の詳細", exact: true }).click();
  await page.locator(".dialog footer button.danger").click();
  await page.getByRole("button", { name: "削除する", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "forest_0001.png の詳細", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "森のマップ.json の詳細", exact: true }).click();
  await page.getByRole("button", { name: "編集画面で開く", exact: true }).click();
  await expect(page.getByText(/1件の素材が見つかりません/)).toBeVisible();
  await page.getByRole("button", { name: "保存する", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.getByRole("button", { name: "音楽・効果音", exact: true }).click();
  await page.getByLabel("効果音名", { exact: true }).fill("新しい効果音");
  await page.getByRole("button", { name: "WAVを素材として保存", exact: true }).click();
  await page.getByRole("button", { name: /素材ライブラリ/ }).click();
  await page.getByRole("button", { name: "変更を破棄", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "新しい効果音.wav の詳細", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
  if (testInfo.project.name === "chromium")
    await page.screenshot({
      path: "test-results/asset-library.png",
      fullPage: true,
    });
});

async function setup(page: Page) {
  return page.evaluate(async () => {
    const { app, storage } = await import("/src/application/asset-service.ts");
    await app.init();
    type FileRecord = import("/src/domain/models.ts").StoredFile;
    const files = new Map<string, { file: FileRecord; blob: Blob }>();
    Object.defineProperty(storage, "connected", { get: () => true });
    storage.createFile = async (input) => {
      const file: FileRecord = {
        fileId: `storage-${input.metadata.assetId}`,
        type: "image",
        mimeType: input.content.type,
        size: input.content.size,
        version: "1",
        modifiedTime: new Date().toISOString(),
        description: "",
        tagIds: [],
        ...input.metadata,
      };
      files.set(file.fileId, { file, blob: input.content });
      return file;
    };
    storage.getFile = async (id) => {
      const f = files.get(id);
      if (!f) throw new Error("missing");
      return f.blob;
    };
    storage.getMetadata = async (id) => {
      const f = files.get(id);
      if (!f) throw new Error("missing");
      return f.file;
    };

    storage.updateContent = async (id, blob, version) => {
      const old = files.get(id);
      if (!old || old.file.version !== version) throw new Error("conflict");
      const file = { ...old.file, version: String(Number(version) + 1) };
      files.set(id, { file, blob });
      return file;
    };
    storage.updateMetadata = async (id, patch, version) => {
      const old = files.get(id);
      if (!old || old.file.version !== version) throw new Error("conflict");
      const file = {
        ...old.file,
        ...patch,
        version: String(Number(version) + 1),
      };
      files.set(id, { file, blob: old.blob });
      return file;
    };
    storage.trashFile = async (id) => {
      files.delete(id);
    };
    app.changed();
    const canvas = document.createElement("canvas");
    canvas.width = 32;
    canvas.height = 16;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.fillStyle = "#639947";
      ctx.fillRect(0, 0, 16, 16);
    }
    return canvas.toDataURL("image/png").split(",")[1];
  });
}

test("save as keeps independent assets, undo never changes identity, and opening ignores local drafts", async ({
  page,
}) => {
  await page.goto("/");
  await setup(page);
  await page.getByRole("button", { name: "音楽・効果音", exact: true }).click();
  await page.getByRole("button", { name: "保存する", exact: true }).click();
  await page.getByLabel("保存名", { exact: true }).fill("元の音");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByText("保存済み", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "トラックを追加", exact: true }).click();
  await page.getByRole("button", { name: "別名で保存する", exact: true }).click();
  await page.getByLabel("保存名", { exact: true }).fill("重ねた音");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByText("保存済み", { exact: true })).toBeVisible();
  const copyId = await page
    .locator("sounds-page")
    .evaluate((el) => (el as unknown as { preset: { id: string } }).preset.id);
  await page.getByRole("button", { name: "元に戻す", exact: true }).click();
  expect(
    await page
      .locator("sounds-page")
      .evaluate((el) => (el as unknown as { preset: { id: string } }).preset.id),
  ).toBe(copyId);
  await page.getByRole("button", { name: "保存する", exact: true }).click();
  await expect(page.getByText("保存済み", { exact: true })).toBeVisible();
  const files = await page.evaluate(async () => {
    const { app } = await import("/src/application/asset-service.ts");
    const { db } = await import("/src/database/db.ts");
    const files = app.files.filter((f) => f.tagIds.includes("editor-sound"));
    const first = files[0];
    const data = await app.openProject(first);
    await db.projects.put({
      projectId: first.assetId,
      data: { ...data, name: "古いローカル下書き" },
      dirty: true,
      kind: "sound",
    });
    return {
      files: files.map((f) => ({ id: f.assetId, version: f.version })),
      first: first.assetId,
      name: data.name,
    };
  });
  expect(files.files).toHaveLength(2);
  expect(files.files.find((f) => f.id !== copyId)?.version).toBe("1");
  await page.getByLabel("開く", { exact: true }).selectOption(files.first);
  await expect(page.getByLabel("効果音名", { exact: true })).toHaveValue(files.name);
  await page.getByRole("button", { name: /素材ライブラリ/ }).click();
  await page.getByRole("button", { name: "音声", exact: true }).click();
  await expect(page.locator("audio-row")).toHaveCount(2);
  await expect(page.locator("asset-card")).toHaveCount(0);
});

test("uploads continue while navigating and do not open a confirmation dialog", async ({
  page,
}) => {
  await page.goto("/");
  const png = await setup(page);
  await page.evaluate(async () => {
    const { storage } = await import("/src/application/asset-service.ts");
    const create = storage.createFile.bind(storage);
    storage.createFile = async (input) => {
      await new Promise<void>((resolve) => {
        (window as unknown as { finishUpload: () => void }).finishUpload = resolve;
      });
      return create(input);
    };
  });
  await page.locator("#upload").setInputFiles({
    name: "background.png",
    mimeType: "image/png",
    buffer: Buffer.from(png, "base64"),
  });
  await expect(page.getByText(/素材を登録中/)).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "マップエディター", exact: true }).click();
  await expect(page.getByRole("heading", { name: "マップエディター", exact: true })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => typeof (window as unknown as { finishUpload?: () => void }).finishUpload),
    )
    .toBe("function");
  await page.evaluate(() => (window as unknown as { finishUpload: () => void }).finishUpload());
  await expect(page.getByText(/素材を登録中/)).toHaveCount(0);
  await expect(page.locator("asset-thumbnail img")).toBeVisible();
  await page.getByRole("button", { name: /素材ライブラリ/ }).click();
  await expect(
    page.getByRole("button", { name: "background.png の詳細", exact: true }),
  ).toBeVisible();
});
