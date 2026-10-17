import { expect, test } from "@playwright/test";
import { soundControls } from "../../src/domain/sound-parameters";

test("every preset previews valid audio, including random boundary values", async ({ page }) => {
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
  await expect(page.getByRole("heading", { name: "音楽・効果音", exact: true })).toBeVisible();
  await page.evaluate(() => {
    Math.random = () => 0;
  });
  let starts = 0;
  const count = () => page.evaluate(() => Reflect.get(window, "previewStarts") as number);
  for (const name of [
    "コイン",
    "レーザー",
    "爆発",
    "パワーアップ",
    "ダメージ",
    "ジャンプ",
    "決定音",
    "ランダム",
  ]) {
    await page.getByRole("button", { name, exact: true }).click();
    await expect.poll(count).toBe(++starts);
    await expect(page.getByRole("alert")).toHaveCount(0);
  }
  await page.getByRole("button", { name: "すべてのパラメータを表示", exact: true }).click();
  for (const [key, label, min] of soundControls) {
    const slider = page.locator(".knobs").getByRole("slider", { name: label, exact: true });
    const value = Number(await slider.inputValue());
    const displayed = Number(await slider.locator("..").locator(".value").textContent());
    expect(displayed).toBeCloseTo(value, 2);
    expect(value).toBeGreaterThanOrEqual(min);
    expect(value).toBeLessThanOrEqual(key === "sound_vol" ? 0.5 : 1);
  }
  await page.getByRole("button", { name: "試聴する", exact: true }).click();
  await expect.poll(count).toBe(++starts);
  await page.getByLabel("波形", { exact: true }).selectOption("2");
  await expect.poll(count).toBe(++starts);
  // Stop must cancel a queued automatic preview.
  await page.getByRole("button", { name: "決定音", exact: true }).click();
  await page.getByRole("button", { name: "停止", exact: true }).click();
  await page.clock.install();
  await page.clock.runFor(500);
  expect(await count()).toBe(starts);
});

test("parameter labels show explanations with keyboard dismissal and focus return", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#sounds");
  await page.getByRole("button", { name: "すべてのパラメータを表示", exact: true }).click();
  for (const [, label, , description] of soundControls) {
    const button = page
      .locator(".knobs")
      .getByRole("button", { name: `${label}の解説`, exact: true });
    await button.click();
    const popup = page.getByRole("dialog", { name: label, exact: true });
    await expect(popup).toBeVisible();
    await expect(popup).toContainText(description);
    await page.keyboard.press("Escape");
    await expect(popup).not.toBeVisible();
    await expect(button).toBeFocused();
  }
  for (const label of ["波形", "開始位置（秒）"]) {
    await page.getByRole("button", { name: `${label}の解説`, exact: true }).click();
    await expect(page.getByRole("dialog", { name: label, exact: true })).toBeVisible();
    await page.getByRole("button", { name: "閉じる", exact: true }).click();
  }
  await expect(page.getByRole("button", { name: "元に戻す", exact: true })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test("preset editing works without Web Audio", async ({ page }) => {
  await page.addInitScript(() => {
    Reflect.deleteProperty(window, "AudioContext");
  });
  await page.goto("/#sounds");
  await expect(page.getByRole("button", { name: "試聴する", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "ランダム", exact: true }).click();
  await expect(page.locator(".waveform i").first()).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByText("未保存の変更", { exact: true })).toBeVisible();
});
