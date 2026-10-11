import { expect, test } from "@playwright/test";

test("unnamed editors guard navigation and new files without saving local drafts", async ({
  page,
}) => {
  await page.goto("/#maps");
  const name = page.getByLabel("編集用JSON名", { exact: true });
  await expect(name).toHaveValue("");
  await name.fill("森の入り口");
  await page.getByRole("button", { name: "レイヤーを追加", exact: true }).click();
  await expect(page.getByText("未保存の変更", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "キャラクター合成", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "未保存の変更" })).toBeVisible();
  await page.getByRole("button", { name: "キャンセル", exact: true }).click();
  await expect(name).toHaveValue("森の入り口");
  await expect(page).toHaveURL(/#maps$/);
  await page.getByRole("button", { name: "新規作成", exact: true }).click();
  await page.getByRole("button", { name: "変更を破棄", exact: true }).click();
  await expect(name).toHaveValue("");
  expect(
    await page.evaluate(async () => (await import("/src/database/db.ts")).db.projects.count()),
  ).toBe(0);
  await expect(page.getByLabel("開く").locator("option")).toHaveCount(1);
  await page.getByRole("button", { name: "音楽・効果音", exact: true }).click();
  await expect(page.getByLabel("効果音名", { exact: true })).toHaveValue("");
  await expect(page.locator(".waveform i").first()).toBeVisible();
  const before = await page.locator(".waveform").innerHTML();
  await page.getByLabel("基本周波数", { exact: true }).fill("0.85");
  await expect.poll(() => page.locator(".waveform").innerHTML()).not.toBe(before);
  await page.getByRole("button", { name: "トラックを追加", exact: true }).click();
  await expect(page.locator(".waveform")).toHaveCount(2);
  await page.getByRole("button", { name: "元に戻す", exact: true }).click();
  await expect(page.locator(".waveform")).toHaveCount(1);
  await page.getByRole("button", { name: "やり直す", exact: true }).click();
  await expect(page.locator(".waveform")).toHaveCount(2);
  await page.getByRole("button", { name: "新規作成", exact: true }).click();
  await page.getByRole("button", { name: "キャンセル", exact: true }).click();
  await expect(page.locator(".waveform")).toHaveCount(2);
});

test("SVG sanitization and worker tile processing", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { sanitizeSvg } = await import("/src/canvas/images.ts");
    const { split, hashBlob } = await import("/src/application/media.ts");
    const cleaned = await sanitizeSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" onload="alert(1)"><script>alert(1)</script><image href="https://evil.example/image"/><rect width="32" height="32" fill="red"/></svg>',
    ).text();
    const canvas = document.createElement("canvas");
    canvas.width = 32;
    canvas.height = 16;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.fillStyle = "green";
      ctx.fillRect(0, 0, 16, 16);
    }
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((b) => resolve(b as Blob), "image/png"),
    );
    const hash = await hashBlob(blob);
    const tiles = await split(blob, {
      width: 16,
      height: 16,
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      spacing: 0,
      skipEmpty: true,
      prefix: "test",
    });
    return {
      cleaned,
      hash,
      tiles: tiles.map((t) => ({ name: t.name, type: t.blob.type })),
    };
  });
  expect(result.cleaned).not.toMatch(/script|onload|evil/);
  expect(result.hash).toMatch(/^[a-f0-9]{64}$/);
  expect(result.tiles).toEqual([{ name: "test_0001.png", type: "image/png" }]);
});
test("10,000 item library virtualizes cards and filters locally", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "素材ライブラリ" })).toBeVisible();
  await page.evaluate(async () => {
    const { app } = await import("/src/application/asset-service.ts");
    await app.init();
    app.files = Array.from({ length: 10000 }, (_, i) => ({
      assetId: `a${i}`,
      fileId: `f${i}`,
      name: `forest-${String(i).padStart(5, "0")}.png`,
      kind: "asset",
      type: "image",
      role: "source",
      mimeType: "image/png",
      size: 512,
      version: "1",
      modifiedTime: "2026-09-21",
      tagIds: [],
      description: "",
    }));
    app.changed();
  });
  await expect(page.getByText("10,000 件の素材", { exact: true })).toBeVisible();
  expect(await page.locator("asset-card").count()).toBeLessThan(50);
  await page.getByRole("textbox", { name: "素材を検索" }).fill("forest-09999");
  await expect(
    page.getByRole("button", { name: "forest-09999.png の詳細", exact: true }),
  ).toBeVisible();
});
test("settings validation and narrow layout", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#settings");
  await expect(page.getByText("RustFS / assets バケット・YugabyteDB")).toBeVisible();
  await expect(page.getByRole("button", { name: "接続を確認・一覧を更新" })).toBeEnabled();
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(390);
});
