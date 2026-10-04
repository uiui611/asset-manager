import { describe, expect, it } from "vitest";
import { advanceFrame } from "../../src/domain/sprites";

describe("sprite playback", () => {
  it("wraps within the selected range, including skipped animation frames", () => {
    expect(advanceFrame(3, 7, 2, 4, true)).toEqual({
      frame: 4,
      finished: false,
    });
  });
  it("holds the final frame and stops without looping", () => {
    expect(advanceFrame(3, 1, 2, 4, false)).toEqual({
      frame: 4,
      finished: false,
    });
    expect(advanceFrame(4, 1, 2, 4, false)).toEqual({
      frame: 4,
      finished: true,
    });
  });
  it("can loop a single frame", () => {
    expect(advanceFrame(2, 100, 2, 2, true)).toEqual({
      frame: 2,
      finished: false,
    });
  });
});
