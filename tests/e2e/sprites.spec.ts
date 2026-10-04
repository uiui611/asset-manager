import { expect, test } from "@playwright/test";

test("sprite grid, local import, frame order, range, playback and invalid geometry", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const writes: string[] = [];
  page.on("request", (r) => {
    if (["PUT", "POST", "PATCH", "DELETE"].includes(r.method()))
      writes.push(r.url());
  });
  await page.goto("/#sprites");
  await expect(
    page.getByRole("heading", { name: "スプライトシート再生", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "再生", exact: true }),
  ).toBeDisabled();
  const png = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 64;
    c.height = 32;
    const ctx = c.getContext("2d");
    if (!ctx) throw new Error("Canvas unavailable");
    [
      "red",
      "green",
      "blue",
      "yellow",
      "cyan",
      "magenta",
      "white",
      "black",
    ].forEach((color, i) => {
      ctx.fillStyle = color;
      ctx.fillRect((i % 4) * 16, Math.floor(i / 4) * 16, 16, 16);
    });
    return c.toDataURL().split(",")[1];
  });
  await page.locator("#sprite-import").setInputFiles({
    name: "walk.png",
    mimeType: "image/png",
    buffer: Buffer.from(png, "base64"),
  });
  await page.getByLabel("コマの幅", { exact: true }).fill("16");
  await page.getByLabel("コマの幅", { exact: true }).blur();
  await page.getByLabel("コマの高さ", { exact: true }).fill("16");
  await page.getByLabel("コマの高さ", { exact: true }).blur();
  await expect(page.getByText("1 / 8 コマ", { exact: true })).toBeVisible();
  await expect(page.getByLabel("表示倍率", { exact: true })).toHaveValue("4");
  const pixel = () =>
    page
      .locator("#sprite-frame")
      .evaluate((canvas: HTMLCanvasElement) => [
        ...(canvas.getContext("2d")?.getImageData(8, 8, 1, 1).data || []),
      ]);
  expect(await pixel()).toEqual([255, 0, 0, 255]);
  await page.getByRole("button", { name: "次のコマ", exact: true }).click();
  expect(await pixel()).toEqual([0, 128, 0, 255]);
  await page.getByLabel("現在のコマ", { exact: true }).fill("5");
  const cyan = await pixel();
  expect(cyan[0]).toBeLessThanOrEqual(1);
  expect(cyan.slice(1)).toEqual([255, 255, 255]);
  await page.getByLabel("開始コマ", { exact: true }).fill("2");
  await page.getByLabel("開始コマ", { exact: true }).blur();
  await page.getByLabel("終了コマ", { exact: true }).fill("4");
  await page.getByLabel("終了コマ", { exact: true }).blur();
  await page.getByLabel("FPS", { exact: true }).fill("12");
  await page.getByLabel("FPS", { exact: true }).blur();
  await page.getByLabel("ループ再生", { exact: true }).uncheck();
  await page.getByRole("button", { name: "再生", exact: true }).click();
  await expect(page.getByLabel("現在のコマ", { exact: true })).toHaveValue("4");
  await expect(
    page.getByRole("button", { name: "再生", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "停止", exact: true }).click();
  await expect(page.getByLabel("現在のコマ", { exact: true })).toHaveValue("2");
  await page.getByLabel("ループ再生", { exact: true }).check();
  await page.getByRole("button", { name: "再生", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "一時停止", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "一時停止", exact: true }).click();
  await page.getByLabel("コマの幅", { exact: true }).fill("100");
  await page.getByLabel("コマの幅", { exact: true }).blur();
  await expect(page.getByRole("alert")).toContainText(
    "画像内に収まるタイルがありません",
  );
  await expect(
    page.getByRole("button", { name: "再生", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("コマの幅", { exact: true }).fill("16");
  await page.getByLabel("コマの幅", { exact: true }).blur();
  if (testInfo.project.name === "chromium")
    await page.screenshot({ path: "test-results/sprites.png", fullPage: true });
  await page.getByRole("button", { name: "音楽・効果音", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "音声ライブラリ", exact: true }),
  ).toHaveCount(0);
  await expect(
    page
      .locator(".page-head")
      .getByRole("button", { name: "新規作成", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .locator(".page-head")
      .getByRole("button", { name: "保存する", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "試聴する", exact: true }),
  ).toHaveText("");
  await expect(
    page.getByRole("button", { name: "停止", exact: true }),
  ).toHaveText("");
  expect(writes).toEqual([]);
  expect(errors).toEqual([]);
});

test("export downloads JSON locally in every editor without storage writes", async ({
  page,
}) => {
  const writes: string[] = [];
  page.on("request", (r) => {
    if (["PUT", "POST", "PATCH", "DELETE"].includes(r.method()))
      writes.push(r.url());
  });
  for (const [route, field] of [
    ["maps", "編集用JSON名"],
    ["characters", "編集用JSON名"],
    ["sounds", "効果音名"],
  ]) {
    await page.goto(`/#${route}`);
    await expect(page.getByLabel("開く", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "インポート", exact: true }),
    ).toBeVisible();
    await page.getByLabel(field, { exact: true }).fill("local-export");
    const downloaded = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "エクスポート", exact: true })
      .click();
    const download = await downloaded;
    expect(download.suggestedFilename()).toBe("local-export.json");
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    if (stream)
      for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    const json = JSON.parse(Buffer.concat(chunks).toString());
    expect(json.name).toBe("local-export");
    await page.getByRole("button", { name: "新規作成", exact: true }).click();
    await page.getByRole("button", { name: "変更を破棄", exact: true }).click();
    await expect(page.getByLabel(field, { exact: true })).toHaveValue("");
  }
  expect(writes).toEqual([]);
});
