import { resolve } from "node:path";

process.env.PLAYWRIGHT_BROWSERS_PATH = resolve(".cache/playwright");
const { chromium, expect } = await import("@playwright/test");
const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const base = "https://ubuntu.home.arpa/asset-manager/";
const prefix = `browser-check-${Date.now()}`;
const created = new Set();
const captures = [];
page.on("response", (response) => {
  if (
    response.request().method() === "PUT" &&
    response.url().startsWith(`${base}api/assets/`) &&
    response.ok()
  ) {
    captures.push(
      response.json().then((file) => {
        if (file.name?.startsWith(prefix)) created.add(file.assetId);
      }),
    );
  }
});
async function save(name, copy = false) {
  const completed = page.waitForResponse(
    (r) => r.url().endsWith("/content") && r.request().method() === "PUT",
  );
  await page
    .getByRole("button", {
      name: copy ? "別名で保存する" : "保存する",
      exact: true,
    })
    .click();
  if (name) {
    await page.getByLabel("保存名", { exact: true }).fill(name);
    await page.getByRole("button", { name: "保存", exact: true }).click();
  }
  expect((await completed).ok()).toBeTruthy();
  await expect(page.getByText("保存済み", { exact: true })).toBeVisible({
    timeout: 30000,
  });
}
try {
  await page.goto(base);
  await expect(
    page.getByRole("button", { name: "素材を追加", exact: true }),
  ).toBeEnabled({ timeout: 30000 });
  const png = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 32;
    c.height = 24;
    const x = c.getContext("2d");
    x.fillStyle = "#629744";
    x.fillRect(0, 0, 32, 24);
    return c.toDataURL().split(",")[1];
  });
  const imageName = `${prefix}.png`;
  await page.locator("#upload").setInputFiles({
    name: imageName,
    mimeType: "image/png",
    buffer: Buffer.from(png, "base64"),
  });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: `${imageName} の詳細`, exact: true }),
  ).toBeVisible({ timeout: 30000 });

  const secondName = `${prefix}-second.png`,
    sheetName = `${prefix}-sheet.png`;
  await page.locator("#upload").setInputFiles({
    name: secondName,
    mimeType: "image/png",
    buffer: Buffer.from(png, "base64"),
  });
  await expect(
    page.getByRole("button", { name: `${secondName} の詳細`, exact: true }),
  ).toBeVisible({ timeout: 30000 });
  await page.getByRole("button", { name: "タイル合成", exact: true }).click();
  const composer = page.getByRole("dialog", { name: "タイル合成" });
  await composer.getByLabel("パレットを検索").fill(prefix);
  await composer.getByRole("button", { name: imageName, exact: true }).click();
  await composer.getByRole("button", { name: secondName, exact: true }).click();
  await composer.getByLabel("合成の列数").fill("2");
  await composer.getByLabel("合成の列数").blur();
  await composer.getByLabel("合成画像名").fill(sheetName);
  await expect(composer.getByAltText("タイル合成プレビュー")).toBeVisible();
  await page.screenshot({
    path: "test-results/kubernetes-tile-composer.png",
    fullPage: true,
  });
  await composer.getByRole("button", { name: "合成画像を保存" }).click();
  await expect(composer).toHaveCount(0, { timeout: 30000 });
  await expect(
    page.getByRole("button", { name: `${imageName} の詳細`, exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "マップエディター", exact: true })
    .click();
  await page.getByTitle(sheetName, { exact: true }).click();
  await expect(page.locator("#tileset-canvas")).toHaveAttribute("width", "64");
  const tileBox = await page.locator("#tileset-canvas").boundingBox();
  await page
    .locator("#tileset-canvas")
    .click({ position: { x: tileBox.width * 0.75, y: tileBox.height * 0.5 } });
  await page.locator("#editor-canvas").click({ position: { x: 16, y: 16 } });
  await page
    .getByRole("button", { name: "レイヤーを追加", exact: true })
    .click();
  await page.getByTitle(imageName, { exact: true }).click();
  await expect(page.locator("#tileset-canvas")).toHaveAttribute("width", "32");
  await page.locator("#editor-canvas").click({ position: { x: 48, y: 16 } });
  await save(`${prefix}-map`);
  const mapFiles = await (
    await context.request.get(`${base}api/assets`)
  ).json();
  const mapFile = mapFiles.files.find((f) => f.name === `${prefix}-map.json`);
  const mapData = await (
    await context.request.get(`${base}api/assets/${mapFile.assetId}/content`)
  ).json();
  expect(mapData.layers[0].cells[0]).toBe(1);
  expect(mapData.layers[1].cells[1]).toBe(0);
  expect(mapData.layers[0].tileset.assetId).not.toBe(
    mapData.layers[1].tileset.assetId,
  );
  await page.screenshot({
    path: "test-results/kubernetes-map-tiles.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "スプライトシート再生", exact: true })
    .click();
  await page.getByTitle(imageName, { exact: true }).click();
  await expect(
    page.getByRole("heading", { name: imageName, exact: true }),
  ).toBeVisible();
  await page.getByLabel("コマの幅", { exact: true }).fill("8");
  await page.getByLabel("コマの幅", { exact: true }).blur();
  await page.getByLabel("コマの高さ", { exact: true }).fill("8");
  await page.getByLabel("コマの高さ", { exact: true }).blur();
  await expect(page.getByText("1 / 12 コマ", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "再生", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "一時停止", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "停止", exact: true }).click();
  await expect(page.getByLabel("現在のコマ", { exact: true })).toHaveValue("1");
  await page.screenshot({
    path: "test-results/kubernetes-sprites.png",
    fullPage: true,
  });

  await page.getByRole("button", { name: "タイル合成", exact: true }).click();
  await composer.getByRole("button", { name: imageName, exact: true }).click();
  await composer.getByLabel("パレットを検索").fill(secondName);
  await composer.getByRole("button", { name: secondName, exact: true }).click();
  await composer.getByLabel("合成画像名").fill(`${prefix}-replacement`);
  await composer.getByLabel("保存後に元素材を削除").check();
  await composer.getByRole("button", { name: "合成画像を保存" }).click();
  await expect(composer).toHaveCount(0, { timeout: 30000 });
  const remaining = await (
    await context.request.get(`${base}api/assets`)
  ).json();
  expect(remaining.files.some((f) => f.name === secondName)).toBe(false);
  expect(
    remaining.files.some((f) => f.name === `${prefix}-replacement.png`),
  ).toBe(true);
  await page
    .getByRole("button", { name: "キャラクター合成", exact: true })
    .click();
  await page.getByTitle(imageName, { exact: true }).click();
  await expect(page.locator("asset-thumbnail img").first()).toBeVisible();
  await page
    .getByRole("button", { name: "ベース画像にする", exact: true })
    .click();
  await expect(page.locator("#editor-canvas")).toHaveAttribute("width", "32");
  await page.locator("#editor-canvas").focus();
  await page.keyboard.press("ArrowRight");
  await save(`${prefix}-character`);
  await save(`${prefix}-copy`, true);
  const listing = await (await context.request.get(`${base}api/assets`)).json();
  const copy = listing.files.find((f) => f.name === `${prefix}-copy.json`);
  if (!copy) throw new Error("Saved copy missing");
  const composition = await (
    await context.request.get(`${base}api/assets/${copy.assetId}/content`)
  ).json();
  if (!composition.previewImage?.startsWith("data:image/png;base64,"))
    throw new Error("Snapshot thumbnail missing");
  await page.goto(`${base}#characters?project=${copy.assetId}`);
  await expect(page.getByLabel("編集用JSON名", { exact: true })).toHaveValue(
    `${prefix}-copy`,
    { timeout: 30000 },
  );
  await expect(page.getByLabel("X座標", { exact: true })).toHaveValue("1");
  await page.getByLabel("表示倍率", { exact: true }).selectOption("2");
  const characterCanvas = page.locator("#editor-canvas"),
    characterBox = await characterCanvas.boundingBox();
  await page.mouse.move(characterBox.x + 12, characterBox.y + 12);
  await page.mouse.down();
  await page.mouse.move(characterBox.x + 16, characterBox.y + 14, { steps: 3 });
  await page.mouse.up();
  await expect(page.getByLabel("X座標", { exact: true })).toHaveValue("3");
  await characterCanvas.hover();
  await page.mouse.wheel(0, -100);
  await expect
    .poll(async () =>
      Number(await page.getByLabel("表示倍率", { exact: true }).inputValue()),
    )
    .toBeGreaterThan(2);
  const beforeBake = await characterCanvas.evaluate((el) =>
    Array.from(
      el.getContext("2d").getImageData(0, 0, el.width, el.height).data,
    ),
  );
  await page
    .getByRole("button", { name: "元素材を切り出して上書き", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "元素材を切り出して上書き" })
    .getByRole("button", { name: "上書きして保存", exact: true })
    .click();
  await expect(
    page.getByText("1件の元素材とJSONを保存しました。", { exact: true }),
  ).toBeVisible({ timeout: 30000 });
  const afterBake = await characterCanvas.evaluate((el) =>
    Array.from(
      el.getContext("2d").getImageData(0, 0, el.width, el.height).data,
    ),
  );
  expect(
    Math.max(...afterBake.map((value, i) => Math.abs(value - beforeBake[i]))),
  ).toBeLessThanOrEqual(2);
  const baked = await (
    await context.request.get(`${base}api/assets/${copy.assetId}/content`)
  ).json();
  expect(baked.layers[0].x).toBe(0);
  expect(baked.layers[0].y).toBe(0);
  expect(baked.layers[0].scaleX).toBe(1);
  expect(baked.layers[0].scaleY).toBe(1);

  await page.screenshot({
    path: "test-results/kubernetes-character.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "音楽・効果音", exact: true }).click();
  await page
    .getByRole("button", { name: "トラックを追加", exact: true })
    .click();
  await page.getByLabel("基本周波数", { exact: true }).fill("0.72");
  await page.getByLabel("トラック 2 開始位置", { exact: true }).fill("0.15");
  await page.getByLabel("トラック 2 開始位置", { exact: true }).blur();
  await expect(page.locator(".waveform i")).toHaveCount(320);
  await save(`${prefix}-sound`);
  await expect(
    page.getByRole("button", { name: "音声ライブラリ", exact: true }),
  ).toHaveCount(0);
  await expect(
    page
      .locator(".page-head")
      .getByRole("button", { name: "新規作成", exact: true }),
  ).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "エクスポート", exact: true }).click();
  expect((await downloadPromise).suggestedFilename()).toBe(
    `${prefix}-sound.json`,
  );

  await page.screenshot({
    path: "test-results/kubernetes-sound.png",
    fullPage: true,
  });
  const wavResponse = page.waitForResponse(
    (r) => r.url().endsWith("/content") && r.request().method() === "PUT",
  );
  await page
    .getByRole("button", { name: "WAVを素材として保存", exact: true })
    .click();
  expect((await wavResponse).ok()).toBeTruthy();
  await expect(
    page.getByRole("button", { name: "WAVを素材として保存", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: /素材ライブラリ/ }).click();
  await page.getByRole("button", { name: "音声", exact: true }).click();
  await page.getByLabel("素材を検索", { exact: true }).fill(prefix);
  await expect(page.locator("audio-row")).toHaveCount(2);
  await page
    .getByRole("button", { name: `${prefix}-sound.json を再生`, exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: `${prefix}-sound.json を停止`,
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "すべての素材", exact: true }).click();
  await expect(
    page
      .getByRole("button", { name: `${prefix}-copy.json の詳細`, exact: true })
      .locator("img"),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/kubernetes-library.png",
    fullPage: true,
  });
  if (errors.length) throw new Error(errors.join("\n"));
  console.log(
    "HTTPS UI passed: background PNG upload, base canvas, keyboard positioning, save as, reload, saved thumbnail, two-track synthesis, local JSON download, WAV export, audio list playback, sprite playback, tile composition with optional source deletion, independent layer sheets, character drag/wheel and source overwrite with normalized saved JSON",
  );
} finally {
  await Promise.allSettled(captures);
  for (const id of created) {
    const metadata = await context.request.get(`${base}api/assets/${id}`);
    if (metadata.status() === 404) continue;
    const file = await metadata.json();
    if (!file.name?.startsWith(prefix)) {
      console.error("Cleanup identity mismatch");
      process.exitCode = 1;
      continue;
    }
    const response = await context.request.delete(`${base}api/assets/${id}`, {
      headers: { "If-Match": file.version },
    });
    if (response.status() !== 204) {
      console.error("Test file cleanup failed");
      process.exitCode = 1;
    }
  }
  await browser.close();
}
