import type { Kind, Project } from "../domain/models";
import { character, map, sound } from "./generated";

const validators = { map, character, sound };
export function validateProject(kind: Kind, value: unknown): asserts value is Project {
  if (kind !== "map" && kind !== "character" && kind !== "sound")
    throw new Error("プロジェクト種別が不正です。");
  if (
    kind === "sound" &&
    value &&
    typeof value === "object" &&
    "format" in value &&
    value.format === "jsfxr" &&
    "parameters" in value
  ) {
    Object.assign(value, {
      format: "multitrack",
      tracks: [
        {
          id: "track-1",
          name: "トラック 1",
          gain: 1,
          offset: 0,
          muted: false,
          parameters: value.parameters,
        },
      ],
    });
    delete (value as { parameters?: unknown }).parameters;
  }
  const validate = validators[kind];
  if (!validate(value)) throw new Error(`JSONの形式が不正です: ${JSON.stringify(validate.errors)}`);
  if (kind === "map") {
    const p = value as unknown as import("../domain/models").MapProject;
    if (
      p.width * p.height > 1_000_000 ||
      p.width * p.tileWidth > 16384 ||
      p.height * p.tileHeight > 16384 ||
      p.width * p.tileWidth * p.height * p.tileHeight > 16_777_216 ||
      p.layers.some(
        (l) =>
          l.cells.length !== p.width * p.height ||
          (!l.tileset && l.cells.some((c) => c >= p.tilesets.length)),
      )
    )
      throw new Error("マップのセル数または素材参照が不正です。");
  }
  if (kind === "sound") {
    for (const track of (value as import("../domain/models").SoundPreset).tracks) {
      const p = track.parameters;
      if (
        p.oldParams !== true ||
        !Number.isInteger(p.wave_type) ||
        Number(p.wave_type) < 0 ||
        Number(p.wave_type) > 3
      )
        throw new Error("jsfxrのoldParams形式と波形 (0〜3) が必要です。");
      for (const [key, v] of Object.entries(p))
        if (
          key.startsWith("p_") &&
          (typeof v !== "number" ||
            !Number.isFinite(v) ||
            Math.abs(v) > 1 ||
            (key.startsWith("p_env_") && v < 0))
        )
          throw new Error(`jsfxrパラメータ ${key} の値が不正です。`);
    }
  }
}
