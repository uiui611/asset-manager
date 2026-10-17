import { afterEach, describe, expect, it, vi } from "vitest";
import {
  generateSound,
  mixSamples,
  playSamples,
  renderMix,
  samplesToWav,
  stopPreset,
} from "../../src/application/audio";
import type { SoundPreset } from "../../src/domain/models";
import { soundControls, soundParameterMax } from "../../src/domain/sound-parameters";
import { validateProject } from "../../src/schemas/projects";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("sound generation", () => {
  const presetNames = [
    "pickupCoin",
    "laserShoot",
    "explosion",
    "powerUp",
    "hitHurt",
    "jump",
    "blipSelect",
    "random",
  ];
  it.each(presetNames)(
    "keeps %s within the controls' ranges and renders valid project audio",
    (name) => {
      for (const random of [0, 0.2, 0.5, 0.9, 0.999]) {
        vi.spyOn(Math, "random").mockReturnValue(random);
        const parameters = generateSound(name);
        for (const [key, , min] of soundControls) {
          expect(parameters[key]).toBeGreaterThanOrEqual(min);
          expect(parameters[key]).toBeLessThanOrEqual(soundParameterMax(key));
        }
        const preset: SoundPreset = {
          schemaVersion: 1,
          id: "s",
          name: "test",
          format: "multitrack",
          updatedAt: "",
          tracks: [{ id: "t", name: "t", parameters, gain: 1, offset: 0, muted: false }],
        };
        // Include serialization: this is the same data used for saving and importing.
        expect(() => validateProject("sound", JSON.parse(JSON.stringify(preset)))).not.toThrow();
        const samples = renderMix(preset);
        expect(samples.length).toBeGreaterThan(0);
        expect(samples.every(Number.isFinite)).toBe(true);
      }
    },
  );
  it("retains negative values for signed sound changes", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.2);
    const parameters = generateSound("random");
    expect(parameters.p_freq_dramp).toBeLessThan(0);
    expect(parameters.p_arp_mod).toBeLessThan(0);
    expect(parameters.p_pha_offset).toBeLessThan(0);
  });
  it("does not start a pending preview after stop", async () => {
    let resume!: () => void;
    const start = vi.fn();
    vi.stubGlobal(
      "AudioContext",
      class {
        resume() {
          return new Promise<void>((resolve) => {
            resume = resolve;
          });
        }
        createBufferSource() {
          return { start };
        }
      },
    );
    const playing = playSamples(new Float32Array([0.1]));
    stopPreset();
    resume();
    await playing;
    expect(start).not.toHaveBeenCalled();
  });
});

describe("sound mixing", () => {
  it("rejects legacy single-track projects without mutating their data", () => {
    const legacy = {
      schemaVersion: 1,
      id: "s",
      name: "legacy",
      format: "jsfxr",
      parameters: { oldParams: true, wave_type: 0 },
      updatedAt: "",
    };
    const original = structuredClone(legacy);
    expect(() => validateProject("sound", legacy)).toThrow();
    expect(legacy).toEqual(original);
  });
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
