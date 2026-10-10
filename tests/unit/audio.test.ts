import { describe, expect, it } from "vitest";
import { mixSamples, samplesToWav } from "../../src/application/audio";
import { validateProject } from "../../src/schemas/projects";

describe("sound mixing", () => {
  it("aligns offsets, applies gain and excludes muted tracks", () => {
    const mixed = mixSamples([
      {
        samples: new Float32Array([0.4, 0.2]),
        gain: 0.5,
        offset: 0,
        muted: false,
      },
      {
        samples: new Float32Array([0.1, 0.3]),
        gain: 1,
        offset: 1 / 44100,
        muted: false,
      },
      {
        samples: new Float32Array([1, 1, 1, 1]),
        gain: 1,
        offset: 10,
        muted: true,
      },
    ]);
    expect(mixed.length).toBe(3);
    expect([...mixed]).toEqual([expect.closeTo(0.2), expect.closeTo(0.2), expect.closeTo(0.3)]);
  });
  it("uses one shared peak limiter to preserve relative volume", () => {
    const mixed = mixSamples([
      {
        samples: new Float32Array([0.8, 0.2]),
        gain: 1,
        offset: 0,
        muted: false,
      },
      {
        samples: new Float32Array([0.8, 0.2]),
        gain: 1,
        offset: 0,
        muted: false,
      },
    ]);
    expect([...mixed]).toEqual([1, 0.25]);
  });
  it("exports the mixed timeline as mono 44.1 kHz PCM WAV", async () => {
    const blob = samplesToWav(new Float32Array([-1, 0, 1]));
    const bytes = await blob.arrayBuffer();
    const view = new DataView(bytes);
    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe("RIFF");
    expect(view.getUint32(24, true)).toBe(44100);
    expect(view.getUint32(40, true)).toBe(6);
    expect(view.getInt16(44, true)).toBe(-32768);
    expect(view.getInt16(48, true)).toBe(32767);
  });
  it("rejects unbounded track counts and offsets", () => {
    const track = {
      id: "t",
      name: "t",
      gain: 1,
      offset: 0,
      muted: false,
      parameters: { oldParams: true, wave_type: 0 },
    };
    const data = {
      schemaVersion: 1,
      id: "s",
      name: "",
      format: "multitrack",
      tracks: [track],
      updatedAt: "",
    };
    expect(() => validateProject("sound", data)).not.toThrow();
    expect(() => validateProject("sound", { ...data, tracks: Array(9).fill(track) })).toThrow();
    expect(() =>
      validateProject("sound", { ...data, tracks: [{ ...track, offset: 11 }] }),
    ).toThrow();
  });
});
