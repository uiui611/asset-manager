import { expect, type Page, test } from "@playwright/test";

async function seed(page: Page) {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "素材ライブラリ" }),
  ).toBeVisible();
  await page.evaluate(async () => {
    const { app, storage } = await import("/src/application/asset-service.ts"),
      { db } = await import("/src/database/db.ts");
    await app.init();
    type Record = import("/src/domain/models.ts").StoredFile;
    const files = new Map<string, { file: Record; blob: Blob }>();
    Object.defineProperty(storage, "connected", { get: () => true });
    storage.createFile = async (input) => {
      await new Promise((r) => setTimeout(r, 100));
      const file = {
        fileId: input.metadata.assetId,
        type: "image",
        mimeType: input.content.type,
        size: input.content.size,
        version: "1",
        modifiedTime: new Date().toISOString(),
        description: "",
        tagIds: [],
        ...input.metadata,
      } as Record;
      files.set(file.fileId, { file, blob: input.content });
      return file;
    };
    storage.getFile = async (id) => {
      const item = files.get(id);
      if (!item) throw new Error("missing");
      return item.blob;
    };
    storage.trashFile = async (id) => {
      await new Promise((r) => setTimeout(r, 250));
      files.delete(id);
    };
    for (const [id, color, width] of [
      ["red", "#ff0000", 16],
      ["blue", "#0000ff", 16],
      ["green", "#00ff00", 16],
      ["wide", "#ffffff", 32],
    ] as const) {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = 16;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("canvas");
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, width, 16);
      const blob = await new Promise<Blob>((r) =>
        canvas.toBlob((b) => {
          if (b) r(b);
        }, "image/png"),
      );
      await app.putFile(
        await storage.createFile({
          content: blob,
          metadata: {
            assetId: id,
            name: `${id}.png`,
            type: "image",
            tagIds: [id === "green" ? "nature" : "color"],
          },
        }),
      );
    }
    await db.tags.bulkPut([
      { tagId: "nature", name: "自然", color: "green" },
      { tagId: "color", name: "色", color: "blue" },
    ]);
    await app.refresh();
  });
}
test("tile composition rejects mismatched sizes, preserves sources by default, and supports per-layer sheets", async ({
  page,
}, info) => {
  await seed(page);
  await page.getByRole("button", { name: "タイル合成", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "タイル合成" });
  await dialog.getByRole("button", { name: "red.png", exact: true }).click();
  await dialog.getByRole("button", { name: "wide.png", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText(
    "画像サイズが一致しません",
  );
  await expect(
    dialog.getByRole("button", { name: "合成画像を保存" }),
  ).toBeDisabled();
  await dialog.getByRole("button", { name: /wide.png/ }).click();
  await dialog.getByRole("button", { name: "blue.png", exact: true }).click();
  await dialog.getByLabel("合成の列数").fill("2");
  await dialog.getByLabel("合成の列数").blur();
  await dialog.getByLabel("合成画像名").fill("two-tiles");
  await expect(dialog.getByLabel("保存後に元素材を削除")).not.toBeChecked();
  await expect(dialog.getByAltText("タイル合成プレビュー")).toBeVisible();
  if (info.project.name === "chromium")
    await page.screenshot({
      path: "test-results/tile-composer.png",
      fullPage: true,
    });
  await dialog.getByRole("button", { name: "合成画像を保存" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "red.png の詳細", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "マップエディター", exact: true })
    .click();
  const palette = page.locator("asset-palette");
  await palette.getByLabel("パレットのタグ").selectOption("nature");
  await expect(palette.getByRole("button")).toHaveCount(1);
  await expect(palette.getByRole("button")).toHaveText("green.png");
  await palette.getByLabel("パレットのタグ").selectOption("");
  await palette.getByLabel("パレットを検索").fill("two-tiles");
  await expect(palette.getByRole("button")).toHaveCount(1);
  await palette.getByRole("button").click();
  await palette.getByLabel("パレットを検索").fill("");
  await palette.getByLabel("パレットの並び順").selectOption("name");
  await page.getByLabel("タイルセットのコマ幅", { exact: true }).fill("16");
  await page.getByLabel("タイルセットのコマ幅", { exact: true }).blur();
  await expect(page.locator("#tileset-canvas")).toHaveAttribute("width", "32");
  const box = await page.locator("#tileset-canvas").boundingBox();
  if (!box) throw new Error("canvas bounds");
  await page
    .locator("#tileset-canvas")
    .click({ position: { x: box.width * 0.75, y: box.height * 0.5 } });
  await expect(
    page.getByText("描画するタイル: 2", { exact: true }),
  ).toBeVisible();
  await page.locator("#editor-canvas").click({ position: { x: 16, y: 16 } });
  await page
    .getByRole("button", { name: "レイヤーを追加", exact: true })
    .click();
  await palette.getByRole("button", { name: "green.png", exact: true }).click();
  await expect(page.locator("#tileset-canvas")).toHaveAttribute("width", "16");
  await page.locator("#editor-canvas").click({ position: { x: 48, y: 16 } });
  const pixels = await page.locator("#editor-canvas").evaluate((el) => {
    const ctx = (el as HTMLCanvasElement).getContext("2d");
    if (!ctx) throw new Error("canvas");
    return [
      Array.from(ctx.getImageData(16, 16, 1, 1).data),
      Array.from(ctx.getImageData(48, 16, 1, 1).data),
    ];
  });
  expect(pixels[0][2]).toBeGreaterThan(250);
  expect(pixels[1][1]).toBeGreaterThan(250);
  await page.getByLabel("編集用JSON名").fill("layer-sheets");
  await page.getByRole("button", { name: "保存する", exact: true }).click();
  await expect(page.getByText("保存済み", { exact: true })).toBeVisible();
  const saved = await page.evaluate(async () => {
    const { app } = await import("/src/application/asset-service.ts");
    const file = app.files.find((f) => f.name === "layer-sheets.json");
    if (!file) throw new Error("saved map");
    return app.openProject(file);
  });
  expect("layers" in saved && saved.layers.length).toBe(2);
  if (info.project.name === "chromium")
    await page.screenshot({
      path: "test-results/layer-sheets.png",
      fullPage: true,
    });
  await page
    .getByRole("button", { name: "スプライトシート再生", exact: true })
    .click();
  await page.getByRole("button", { name: "タイル合成", exact: true }).click();
  await dialog.getByRole("button", { name: "red.png", exact: true }).click();
  await dialog.getByRole("button", { name: "blue.png", exact: true }).click();
  await dialog.getByLabel("合成画像名").fill("remove-sources");
  await dialog.getByLabel("保存後に元素材を削除").check();
  await dialog.getByRole("button", { name: "合成画像を保存" }).click();
  await expect(
    dialog.getByRole("progressbar", { name: "削除の進捗" }),
  ).toBeVisible();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "remove-sources.png", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .locator("asset-palette")
      .getByRole("button", { name: "red.png", exact: true }),
  ).toHaveCount(0);
});
test("automatic sound preview is debounced and stop cancels pending playback", async ({
  page,
}) => {
  await page.addInitScript(() => {
    let starts = 0;
    Object.defineProperty(window, "previewStarts", { get: () => starts });
    window.AudioContext = class {
      destination = {};
      async resume() {}
      createBuffer() {
        return { copyToChannel() {} };
      }
      createBufferSource() {
        return {
          connect() {},
          start() {
            starts++;
          },
          stop() {},
        };
      }
    } as unknown as typeof AudioContext;
  });
  await page.goto("/#sounds");
  await expect(
    page.getByRole("heading", { name: "音楽・効果音", exact: true }),
  ).toBeVisible();
  const count = () =>
    page.evaluate(() => Reflect.get(window, "previewStarts") as number);
  await page.getByLabel("効果音名", { exact: true }).fill("silent name");
  expect(await count()).toBe(0);
  // Hold the debounce timer while browser actions run, even on slow CI hosts.
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  const slider = page.locator(".knobs input[type=range]").first();
  await slider.evaluate((el) => {
    const input = el as HTMLInputElement;
    for (const value of ["0.1", "0.2", "0.3"]) {
      input.value = value;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });
  expect(await count()).toBe(0);
  await page.clock.runFor(349);
  expect(await count()).toBe(0);
  await page.clock.runFor(1);
  expect(await count()).toBe(1);
  await slider.evaluate((el) => {
    (el as HTMLInputElement).value = "0.4";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.getByRole("button", { name: "停止", exact: true }).click();
  await page.clock.runFor(500);
  expect(await count()).toBe(1);
  const order = await page.locator(".toolbar button").allTextContents();
  expect(order.map((s) => s.trim()).slice(-2)).toEqual([
    "エクスポート",
    "WAVを素材として保存",
  ]);
});

test("failed composite upload preserves sources and split saving displays progress", async ({
  page,
}) => {
  await seed(page);
  await page.evaluate(async () => {
    const { storage } = await import("/src/application/asset-service.ts");
    const original = storage.createFile;
    storage.createFile = async (input) => {
      if (input.metadata.name === "failed.png")
        throw new Error("保存テストの通信エラー");
      await new Promise((r) => setTimeout(r, 350));
      return original(input);
    };
  });
  await page.getByRole("button", { name: "タイル合成", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "タイル合成" });
  await dialog.getByRole("button", { name: "red.png", exact: true }).click();
  await dialog.getByRole("button", { name: "blue.png", exact: true }).click();
  await dialog.getByLabel("合成画像名").fill("failed");
  await dialog.getByLabel("保存後に元素材を削除").check();
  await dialog.getByRole("button", { name: "合成画像を保存" }).click();
  await expect(dialog.getByRole("alert")).toContainText("通信エラー");
  expect(
    await page.evaluate(async () => {
      const { app } = await import("/src/application/asset-service.ts");
      return app.files.filter((f) => ["red", "blue"].includes(f.assetId))
        .length;
    }),
  ).toBe(2);
  await dialog.getByRole("button", { name: "閉じる", exact: true }).click();
  const png = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 32;
    canvas.height = 16;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas");
    ctx.fillStyle = "red";
    ctx.fillRect(0, 0, 32, 16);
    return canvas.toDataURL().split(",")[1];
  });
  await page.locator("#split-upload").setInputFiles({
    name: "progress.png",
    mimeType: "image/png",
    buffer: Buffer.from(png, "base64"),
  });
  await page.getByLabel("タイル幅", { exact: true }).fill("8");
  await page.getByLabel("タイル高さ", { exact: true }).fill("8");
  await page
    .getByRole("button", { name: "分割結果を確認", exact: true })
    .click();
  await expect(page.getByText(/8枚のPNG/)).toBeVisible();
  await page
    .getByRole("button", { name: "画像素材として保存", exact: true })
    .click();
  const progress = page
    .getByRole("dialog")
    .getByRole("progressbar", { name: "保存の進捗" });
  await expect(progress).toBeVisible();
  await expect(progress).toHaveAttribute("max", "8");
  await expect
    .poll(async () => Number(await progress.getAttribute("value")))
    .toBeGreaterThan(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(
    await page.evaluate(async () => {
      const { app } = await import("/src/application/asset-service.ts");
      return app.files.filter((f) => f.name.startsWith("progress_")).length;
    }),
  ).toBe(8);
});
