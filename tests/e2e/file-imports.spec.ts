import { expect, type Locator, type Page, test } from "@playwright/test";

type ImageFile = { name: string; mimeType: string; buffer: Buffer };
function expectPixel(actual: number[], expected: number[]) {
  expect(actual).toHaveLength(4);
  // WebKit color management can round channels during PNG decode/canvas round trips.
  for (let i = 0; i < 3; i++) expect(Math.abs(actual[i] - expected[i])).toBeLessThanOrEqual(3);
  expect(actual[3]).toBe(expected[3]);
}
async function imageFile(
  page: Page,
  name: string,
  color: string,
  width = 16,
  height = 16,
): Promise<ImageFile> {
  const png = await page.evaluate(
    ({ color, width, height }) => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas unavailable");
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, width, height);
      return canvas.toDataURL().split(",")[1];
    },
    { color, width, height },
  );
  return { name, mimeType: "image/png", buffer: Buffer.from(png, "base64") };
}

async function dropFiles(page: Page, target: Locator, files: ImageFile[]) {
  const transfer = await page.evaluateHandle(
    (files) => {
      const data = new DataTransfer();
      for (const file of files)
        data.items.add(new File([new Uint8Array(file.bytes)], file.name, { type: file.mimeType }));
      return data;
    },
    files.map((file) => ({ name: file.name, mimeType: file.mimeType, bytes: [...file.buffer] })),
  );
  try {
    await target.dispatchEvent("dragenter", { dataTransfer: transfer });
    await target.dispatchEvent("dragover", { dataTransfer: transfer });
    await target.dispatchEvent("drop", { dataTransfer: transfer });
  } finally {
    await transfer.dispose();
  }
}

async function previewPixels(preview: Locator) {
  return preview.evaluate(async (image: HTMLImageElement) => {
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas unavailable");
    ctx.drawImage(image, 0, 0);
    return {
      width: canvas.width,
      height: canvas.height,
      pixels: Array.from(ctx.getImageData(0, 0, canvas.width, canvas.height).data),
    };
  });
}

async function setupStorage(page: Page) {
  await page.evaluate(async () => {
    const { app, storage } = await import("/src/application/asset-service.ts");
    await app.init();
    await app.whenIdle();
    type StoredFile = import("/src/domain/models.ts").StoredFile;
    const files = new Map<string, { file: StoredFile; blob: Blob }>();
    const uploads: string[] = [],
      deleted: string[] = [];
    Object.defineProperties(window, {
      compositionUploads: { get: () => uploads },
      compositionDeleted: { get: () => deleted },
    });
    Object.defineProperty(storage, "connected", { get: () => true });
    storage.createFile = async (input) => {
      uploads.push(String(input.metadata.name));
      const file = {
        fileId: input.metadata.assetId,
        size: input.content.size,
        version: "1",
        modifiedTime: "",
        description: "",
        tagIds: [],
        ...input.metadata,
      } as StoredFile;
      files.set(file.fileId, { file, blob: input.content });
      return file;
    };
    storage.getFile = async (id) => {
      const item = files.get(id);
      if (!item) throw new Error("Missing image");
      return item.blob;
    };
    storage.getMetadata = async (id) => {
      const item = files.get(id);
      if (!item) throw new Error("Missing image");
      return item.file;
    };
    storage.trashFile = async (id) => {
      deleted.push(id);
      files.delete(id);
    };
    storage.listManagedFiles = async () => ({
      files: [...files.values()].map((item) => item.file),
    });
    storage.listTags = async () => [];
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 16;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas unavailable");
    ctx.fillStyle = "red";
    ctx.fillRect(0, 0, 16, 16);
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
      }),
    );
    const file: StoredFile = {
      assetId: "stored-red",
      fileId: "stored-red",
      name: "stored-red.png",
      type: "image",
      mimeType: "image/png",
      size: blob.size,
      version: "1",
      modifiedTime: "",
      tagIds: [],
      description: "",
    };
    files.set(file.fileId, { file, blob });
    await app.putFile(file);
    await app.refresh();
  });
}

test("dropping a sprite image uses local import, resets playback and preserves the image on invalid input", async ({
  page,
}) => {
  const writes: string[] = [];
  page.on("request", (request) => {
    if (["PUT", "POST", "PATCH", "DELETE"].includes(request.method())) writes.push(request.url());
  });
  await page.goto("/#sprites");
  const first = await imageFile(page, "first.png", "red", 64, 32);
  await page.locator("#sprite-import").setInputFiles(first);
  await page.getByLabel("コマの幅", { exact: true }).fill("16");
  await page.getByLabel("コマの幅", { exact: true }).blur();
  await page.getByLabel("左余白", { exact: true }).fill("1");
  await page.getByLabel("左余白", { exact: true }).blur();
  await page.getByRole("button", { name: "再生", exact: true }).click();
  await expect(page.getByRole("button", { name: "一時停止", exact: true })).toBeVisible();
  const green = await imageFile(page, "dropped.png", "lime", 32, 16);
  await dropFiles(page, page.locator("#sprite-frame"), [green, first]);
  await expect(page.getByRole("heading", { name: "dropped.png", exact: true })).toBeVisible();
  await expect(page.getByLabel("コマの幅", { exact: true })).toHaveValue("32");
  await expect(page.getByLabel("コマの高さ", { exact: true })).toHaveValue("16");
  await expect(page.getByLabel("左余白", { exact: true })).toHaveValue("0");
  await expect(page.getByText("1 / 1 コマ", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "再生", exact: true })).toBeVisible();
  const pixel = await page
    .locator("#sprite-frame")
    .evaluate((canvas: HTMLCanvasElement) =>
      Array.from(canvas.getContext("2d")?.getImageData(0, 0, 1, 1).data || []),
    );
  expectPixel(pixel, [0, 255, 0, 255]);
  await dropFiles(page, page.locator("sprites-page"), [
    { name: "invalid.txt", mimeType: "text/plain", buffer: Buffer.from("invalid") },
  ]);
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByRole("heading", { name: "dropped.png", exact: true })).toBeVisible();
  await expect(page).toHaveURL(/#sprites$/);
  expect(writes).toEqual([]);
});

test("offline tile composition imports multiple files, supports drops and ordering, and validates images", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const writes: string[] = [];
  page.on("request", (request) => {
    if (["PUT", "POST", "PATCH", "DELETE"].includes(request.method())) writes.push(request.url());
  });
  await page.goto("/#sprites");
  await page
    .locator("#sprite-import")
    .setInputFiles(await imageFile(page, "original-sheet.png", "red"));
  await expect(
    page.getByRole("heading", { name: "original-sheet.png", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "タイル合成", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "タイル合成" });
  const red = await imageFile(page, "local-red.png", "red"),
    green = await imageFile(page, "local-green.png", "lime");
  await dialog.locator("#tile-import").setInputFiles([red, green]);
  await expect(
    dialog.getByRole("button", { name: "local-green.png（インポート）", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await dialog.getByLabel("合成の列数").fill("2");
  await dialog.getByLabel("合成の列数").blur();
  const preview = dialog.getByAltText("タイル合成プレビュー");
  await expect(preview).toBeVisible();
  let result = await previewPixels(preview);
  expect([result.width, result.height]).toEqual([32, 16]);
  expectPixel(result.pixels.slice(0, 4), [255, 0, 0, 255]);
  expectPixel(result.pixels.slice(16 * 4, 16 * 4 + 4), [0, 255, 0, 255]);
  await dialog.getByRole("button", { name: "2番目を前へ", exact: true }).click();
  await expect(preview).toBeVisible();
  result = await previewPixels(preview);
  expectPixel(result.pixels.slice(0, 4), [0, 255, 0, 255]);
  const blue = await imageFile(page, "local-blue.png", "blue");
  await dropFiles(page, preview, [blue]);
  await expect(
    dialog.getByRole("button", { name: "local-blue.png（インポート）", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(preview).toBeVisible();
  result = await previewPixels(preview);
  expect([result.width, result.height]).toEqual([32, 32]);
  expectPixel(result.pixels.slice(16 * 32 * 4, 16 * 32 * 4 + 4), [0, 0, 255, 255]);
  await dialog.getByRole("button", { name: "3番目を選択解除", exact: true }).click();
  await expect(
    dialog.getByRole("button", { name: "local-blue.png（インポート）", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  await dialog.locator("#tile-import").setInputFiles({
    name: "wide.png",
    mimeType: "image/png",
    buffer: (await imageFile(page, "wide.png", "white", 32)).buffer,
  });
  await expect(dialog.getByRole("alert")).toContainText("画像サイズが一致しません");
  await dialog.getByRole("button", { name: "wide.png（インポート）", exact: true }).click();
  await expect(preview).toBeVisible();
  const svg = {
    name: "invalid.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16"/></svg>',
    ),
  };
  await dropFiles(page, dialog, [svg]);
  await expect(dialog.getByRole("alert")).toContainText("PNG・JPEG・WebP");
  await expect(preview).toBeVisible();
  await dropFiles(
    page,
    dialog,
    Array.from({ length: 257 }, () => red),
  );
  await expect(dialog.getByRole("alert")).toContainText("256枚まで");
  await dialog.getByLabel("合成画像名").fill("offline");
  await expect(dialog.getByRole("button", { name: "合成画像を保存", exact: true })).toBeDisabled();
  await expect(dialog.getByLabel("保存後に元素材を削除")).toBeDisabled();
  expect(
    await dialog.evaluate((element) => element.scrollWidth - element.clientWidth),
  ).toBeLessThanOrEqual(1);
  await dialog.getByRole("button", { name: "キャンセル", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "original-sheet.png", exact: true }),
  ).toBeVisible();
  expect(writes).toEqual([]);
});

test("mixed local and stored tiles retain version checks and only delete stored sources after saving", async ({
  page,
}) => {
  await page.goto("/#sprites");
  await setupStorage(page);
  await page.getByRole("button", { name: "タイル合成", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "タイル合成" });
  await dialog.getByRole("button", { name: "stored-red.png", exact: true }).click();
  await dialog
    .locator("#tile-import")
    .setInputFiles(await imageFile(page, "local-green.png", "lime"));
  await dialog.getByLabel("合成の列数").fill("2");
  await dialog.getByLabel("合成の列数").blur();
  await expect(dialog.getByAltText("タイル合成プレビュー")).toBeVisible();
  await dialog.getByLabel("合成画像名").fill("mixed");
  await page.evaluate(async () => {
    const { app } = await import("/src/application/asset-service.ts");
    const file = app.files.find((file) => file.assetId === "stored-red");
    if (file) file.version = "2";
    app.changed();
  });
  await dialog.getByRole("button", { name: "合成画像を保存", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("元素材が変更されました");
  expect(await page.evaluate(() => Reflect.get(window, "compositionUploads"))).toEqual([]);
  await dialog.getByRole("button", { name: "stored-red.png", exact: true }).click();
  await dialog.getByRole("button", { name: "stored-red.png", exact: true }).click();
  await dialog.getByRole("button", { name: "2番目を前へ", exact: true }).click();
  await expect(dialog.getByAltText("タイル合成プレビュー")).toBeVisible();
  await dialog.getByLabel("保存後に元素材を削除").check();
  await dialog.getByRole("button", { name: "合成画像を保存", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "mixed.png", exact: true })).toBeVisible();
  expect(await page.evaluate(() => Reflect.get(window, "compositionUploads"))).toEqual([
    "mixed.png",
  ]);
  expect(await page.evaluate(() => Reflect.get(window, "compositionDeleted"))).toEqual([
    "stored-red",
  ]);
  const pixel = await page
    .locator("#sprite-frame")
    .evaluate((canvas: HTMLCanvasElement) =>
      Array.from(canvas.getContext("2d")?.getImageData(16, 0, 1, 1).data || []),
    );
  expectPixel(pixel, [0, 255, 0, 255]);
});

test("dropping local tiles over the library composer only uploads the finished sheet", async ({
  page,
}) => {
  await page.goto("/");
  await setupStorage(page);
  await page.getByRole("button", { name: "タイル合成", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "タイル合成" });
  const red = await imageFile(page, "local-red.png", "red"),
    blue = await imageFile(page, "local-blue.png", "blue");
  await dropFiles(page, dialog.getByRole("heading", { name: "タイル合成", exact: true }), [
    red,
    blue,
  ]);
  await expect(
    dialog.getByRole("button", { name: "local-blue.png（インポート）", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(dialog.getByAltText("タイル合成プレビュー")).toBeVisible();
  expect(await page.evaluate(() => Reflect.get(window, "compositionUploads"))).toEqual([]);
  await expect(page.getByText("画像・音声をドロップして追加", { exact: true })).toHaveCount(0);
  await expect(dialog.getByLabel("保存後に元素材を削除")).toBeDisabled();
  await dialog.getByLabel("合成画像名").fill("local-sheet");
  await dialog.getByRole("button", { name: "合成画像を保存", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "local-sheet.png の詳細", exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => Reflect.get(window, "compositionUploads"))).toEqual([
    "local-sheet.png",
  ]);
  expect(await page.evaluate(() => Reflect.get(window, "compositionDeleted"))).toEqual([]);
});
