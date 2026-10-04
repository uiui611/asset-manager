import { expect, test } from "@playwright/test";
import { withSvgMetadata } from "../fixtures/png";

test("PNG containing SVG text remains PNG throughout import, storage fetch and thumbnailing", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "素材ライブラリ" }),
  ).toBeVisible();
  const data = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 2;
    canvas.height = 2;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.fillStyle = "green";
      ctx.fillRect(0, 0, 2, 2);
    }
    return canvas.toDataURL().split(",")[1];
  });
  const bytes = [...withSvgMetadata(Buffer.from(data, "base64"))];
  const result = await page.evaluate(async (bytes) => {
    const { validateImport } = await import("/src/application/media.ts");
    const { thumbnail } = await import("/src/canvas/images.ts");
    const { app, storage } = await import("/src/application/asset-service.ts");
    const types = [];
    for (const type of ["image/png", "image/svg+xml", ""]) {
      const result = await validateImport(
        new File([new Uint8Array(bytes)], "test.png", { type }),
      );
      types.push(result.blob.type);
      if (result.blob.size !== bytes.length)
        throw new Error("PNG content changed");
    }
    const original = storage.getFile;
    storage.getFile = async () =>
      new Blob([new Uint8Array(bytes)], { type: "image/svg+xml" });
    try {
      const blob = await app.blob({
        fileId: "test",
        mimeType: "image/png",
        type: "image",
      } as import("/src/domain/models.ts").StoredFile);
      const thumb = await thumbnail(blob);
      const svg = await validateImport(
        new File(
          [
            '<?xml version="1.0"?><!-- header --><svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><script>alert(1)</script><rect width="2" height="2" fill="red"/></svg>',
          ],
          "disguised.png",
          { type: "image/png" },
        ),
      );
      return {
        types,
        downloadType: blob.type,
        thumbnailType: thumb.type,
        svgType: svg.blob.type,
        svg: await svg.blob.text(),
      };
    } finally {
      storage.getFile = original;
    }
  }, bytes);
  expect(result.types).toEqual(["image/png", "image/png", "image/png"]);
  expect(result.downloadType).toBe("image/png");
  expect(result.thumbnailType).toBe("image/png");
  expect(result.svgType).toBe("image/svg+xml");
  expect(result.svg).not.toContain("<script");
});

test("failed sound module fetch offers recovery", async ({ page }) => {
  await page.goto("/#maps");
  await expect(page.getByLabel("編集用JSON名", { exact: true })).toBeVisible();
  let blocked = false;
  await page.route("**/src/pages/sounds/sounds-page.ts", (route) => {
    if (!blocked) {
      blocked = true;
      return route.abort("failed");
    }
    return route.continue();
  });
  await page.getByRole("button", { name: "音楽・効果音", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "画面の読み込みに失敗しました" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "画面を再読み込み", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "音楽・効果音", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});
