import { expect, type Page, test } from "@playwright/test";
import type { StoredFile, Tag } from "../../src/domain/models";

async function seed(page: Page) {
  const tags: Tag[] = [
    { tagId: "json", name: "JSON", color: "green" },
    { tagId: "editor-map", name: "マップ編集", color: "green" },
    { tagId: "existing", name: "背景", color: "green" },
  ];
  const files = ["one", "two"].map(
    (id) =>
      ({
        assetId: id,
        fileId: id,
        name: `${id}.json`,
        type: "json",
        mimeType: "application/json",
        size: 2,
        version: "1",
        modifiedTime: "2026-10-12",
        description: "",
        tagIds: ["json"],
      }) satisfies StoredFile,
  );
  let creations = 0;
  await page.route("**/api/tags", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: tags });
      return;
    }
    const name = route.request().postDataJSON().name;
    if (name === "失敗") {
      await route.fulfill({ status: 503, json: { error: "タグを保存できませんでした。" } });
      return;
    }
    const tag = tags.find((t) => t.name === name) || {
      tagId: `custom-${++creations}`,
      name,
      color: "green",
    };
    if (!tags.includes(tag)) tags.push(tag);
    await route.fulfill({ json: tag });
  });
  await page.route("**/api/assets?*", (route) => route.fulfill({ json: { files } }));
  await page.route("**/api/assets/*", async (route) => {
    const file = files.find((f) => route.request().url().endsWith(`/${f.fileId}`));
    if (!file) throw new Error("missing file");
    if (route.request().method() === "PATCH")
      Object.assign(file, route.request().postDataJSON(), {
        version: String(Number(file.version) + 1),
      });
    await route.fulfill({ json: file });
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "素材ライブラリ" })).toBeVisible();
  await page.evaluate(
    async ({ files, tags }) => {
      const { app, storage } = await import("/src/application/asset-service.ts");
      await app.init();
      storage.connected = true;
      app.files = files;
      app.tags = tags;
      await app.refresh();
    },
    { files, tags },
  );
  return { files, creations: () => creations };
}

test("creates, reuses, removes and searches tags through keyboard-accessible comboboxes", async ({
  page,
}, info) => {
  const state = await seed(page);
  await page.getByRole("button", { name: "one.json の詳細", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "素材の操作" });
  const input = dialog.getByRole("combobox", { name: "素材のタグ", exact: true });
  await expect(dialog.getByRole("checkbox")).toHaveCount(0);
  await expect(dialog.getByText("（自動）", { exact: true })).toBeVisible();
  await input.fill("  森の背景  ");
  await input.press("Enter");
  await expect(dialog.getByRole("button", { name: "森の背景 を削除", exact: true })).toBeVisible();
  await input.fill("森の背景");
  await expect(dialog.getByRole("option")).toHaveCount(0);
  await input.press("Enter");
  expect(state.creations()).toBe(1);
  await input.fill("背景");
  await input.press("ArrowDown");
  await expect(input).toHaveAttribute("aria-activedescendant", "option-0");
  await input.press("Enter");
  await expect(dialog.getByRole("button", { name: "背景 を削除", exact: true })).toBeVisible();
  await input.fill("マップ");
  await input.press("Escape");
  await expect(input).toHaveAttribute("aria-expanded", "false");
  await expect(dialog).toBeVisible();
  await input.fill("マップ");
  await dialog.getByRole("option", { name: "マップ編集", exact: true }).click();
  await dialog.getByRole("button", { name: "背景 を削除", exact: true }).click();
  if (info.project.name === "chromium")
    await page.screenshot({ path: "test-results/tag-combobox.png", fullPage: true });
  await dialog.getByRole("button", { name: "変更を保存", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(state.files[0].tagIds).toEqual(["json", "custom-1", "editor-map"]);
  await page.reload();
  await page.evaluate(async () =>
    (await import("/src/application/asset-service.ts")).app.connect(),
  );
  await page.getByRole("textbox", { name: "素材を検索", exact: true }).fill("森の背景");
  await expect(page.locator("asset-card")).toHaveCount(1);
  await page.getByRole("textbox", { name: "素材を検索", exact: true }).fill("");
  const filter = page.getByRole("combobox", { name: "タグで絞り込み", exact: true });
  await filter.fill("森");
  await filter.press("ArrowDown");
  await filter.press("Enter");
  await expect(page.locator("asset-card")).toHaveCount(1);
  await page.getByRole("button", { name: "タグで絞り込みを解除", exact: true }).click();
  await expect(page.locator("asset-card")).toHaveCount(2);
});

test("bulk-adds user tags and reports invalid names and creation failures without closing", async ({
  page,
}) => {
  const state = await seed(page);
  await page.getByRole("checkbox", { name: "one.json を選択", exact: true }).check();
  await page.getByRole("checkbox", { name: "two.json を選択", exact: true }).check();
  await page.getByRole("button", { name: "タグを追加", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "素材の操作" });
  const input = dialog.getByRole("combobox", { name: "素材のタグ", exact: true });
  await input.fill("森".repeat(34));
  await input.press("Enter");
  await expect(dialog.getByRole("alert")).toContainText("100バイト");
  expect(state.creations()).toBe(0);
  await input.fill("失敗");
  await input.press("Enter");
  await expect(dialog.getByRole("alert")).toContainText("タグを保存できませんでした");
  await expect(dialog).toBeVisible();
  await input.fill("共通タグ");
  await dialog.getByRole("option", { name: "「共通タグ」を作成して追加", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "共通タグ を削除", exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "選択した素材に追加", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(state.files.map((f) => f.tagIds)).toEqual([
    ["json", "custom-1"],
    ["json", "custom-1"],
  ]);
});

test("enforces the 50-tag limit including the automatic tag", async ({ page }) => {
  const state = await seed(page);
  await page.evaluate(async () => {
    const { app } = await import("/src/application/asset-service.ts");
    const file = {
      ...app.files[0],
      tagIds: ["json", ...Array.from({ length: 49 }, (_, i) => `t${i}`)],
    };
    await app.putFile(file);
    await app.refresh();
  });
  await page.getByRole("button", { name: "one.json の詳細", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "素材の操作" });
  const input = dialog.getByRole("combobox", { name: "素材のタグ", exact: true });
  await input.fill("新しいタグ");
  await input.press("Enter");
  await expect(dialog.getByRole("alert")).toContainText("50個まで");
  expect(state.creations()).toBe(0);
  await input.fill("背景");
  await dialog.getByRole("option", { name: "背景", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("50個まで");
});

test("restores user tags using the server IDs rather than backup IDs", async ({ page }) => {
  const state = await seed(page);
  await page.getByRole("button", { name: "設定・データ管理", exact: true }).click();
  await page.locator("#manifest").setInputFiles({
    name: "backup.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        schemaVersion: 1,
        exportedAt: "2026-10-12",
        assets: [{ ...state.files[0], tagIds: ["json", "old-custom"] }],
        tags: [
          { tagId: "json", name: "JSON", color: "green" },
          { tagId: "old-custom", name: "復元タグ", color: "green" },
        ],
      }),
    ),
  });
  await page.getByRole("button", { name: "内容を復元", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "マニフェスト復元" })).toHaveCount(0);
  expect(state.files[0].tagIds).toEqual(["json", "custom-1"]);
  expect(
    await page.evaluate(async () =>
      (await import("/src/application/asset-service.ts")).app.tags.find(
        (tag) => tag.tagId === "old-custom",
      ),
    ),
  ).toBeUndefined();
  await page.getByRole("button", { name: /素材ライブラリ/ }).click();
  await page.getByRole("textbox", { name: "素材を検索", exact: true }).fill("復元タグ");
  await expect(page.locator("asset-card")).toHaveCount(1);
});

test("combobox candidates and selected tags fit a narrow dialog", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seed(page);
  await page.getByRole("button", { name: "one.json の詳細", exact: true }).click();
  const input = page.getByRole("combobox", { name: "素材のタグ", exact: true });
  await input.fill("スマートフォン幅のタグ");
  await input.press("Enter");
  await expect(
    page.getByRole("button", { name: "スマートフォン幅のタグ を削除", exact: true }),
  ).toBeVisible();
  await input.scrollIntoViewIfNeeded();
  // WebKit's elementsFromPoint misreports nested shadow roots after scrolling.
  // Send a real pointer click and verify that the input receives it and opens its list.
  const box = await input.boundingBox();
  if (!box) throw new Error("Tag input is not visible");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(input).toHaveAttribute("aria-expanded", "true");
  await input.press("ArrowUp");
  await expect(page.getByRole("option", { name: "背景", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
