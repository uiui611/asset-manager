import { jsfxr, sfxr } from "jsfxr";
import { db } from "../database/db";
import type { SoundPreset, SoundTrack, StoredFile } from "../domain/models";
import { validateProject } from "../schemas/projects";

let context: AudioContext | undefined;
let source: AudioBufferSourceNode | undefined;
export const hasWebAudio = () => typeof AudioContext !== "undefined";
export const soundDefaults = () => ({
  ...sfxr.generate("pickupCoin"),
  sound_vol: 0.2,
  sample_rate: 44100,
  sample_size: 16,
});
export function peaks(samples: Float32Array | number[], bins = 160) {
  return Array.from({ length: bins }, (_, i) => {
    const start = Math.floor((i * samples.length) / bins),
      end = Math.floor(((i + 1) * samples.length) / bins);
    let peak = 0;
    for (let j = start; j < end; j++) peak = Math.max(peak, Math.abs(samples[j]));
    return peak;
  });
}
export async function playPreset(parameters: Record<string, number | string | boolean>) {
  if (!hasWebAudio())
    throw new Error(
      "このブラウザ環境ではWeb Audioを利用できません。効果音の編集・JSON保存は利用できます。",
    );
  validateProject("sound", {
    schemaVersion: 1,
    id: "preview",
    name: "preview",
    format: "jsfxr",
    parameters,
    updatedAt: new Date().toISOString(),
  });
  context ??= new AudioContext();
  await context.resume();
  source?.stop();
  const safe = {
    ...parameters,
    sound_vol: Math.min(0.5, Math.max(0, Number(parameters.sound_vol ?? 0.2))),
    sample_rate: 44100,
  };
  for (const [key, value] of Object.entries(safe))
    if (
      typeof value === "number" &&
      (!Number.isFinite(value) || (key.startsWith("p_") && Math.abs(value) > 1))
    )
      throw new Error("音声パラメータは -1〜1 の範囲で指定してください。");
  const synth = new jsfxr.SoundEffect(safe);
  const samples = synth.getRawBuffer().normalized;
  if (!samples.length) return [];
  const buffer = context.createBuffer(1, samples.length, 44100);
  buffer.copyToChannel(new Float32Array(samples), 0);
  source = context.createBufferSource();
  source.buffer = buffer;
  source.connect(context.destination);
  source.start();
  return peaks(samples);
}
export function stopPreset() {
  source?.stop();
  source = undefined;
}
export async function audioWaveform(file: StoredFile, blob: Blob) {
  const cached = await db.waveforms.get(file.assetId);
  if (cached?.version === file.version) return cached.values;
  const ctx = new AudioContext();
  try {
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
    const values = peaks(decoded.getChannelData(0));
    await db.waveforms.put({
      assetId: file.assetId,
      version: file.version,
      values,
    });
    return values;
  } finally {
    await ctx.close();
  }
}

export function renderWav(parameters: Record<string, number | string | boolean>) {
  const samples = new jsfxr.SoundEffect({
    ...parameters,
    sample_rate: 44100,
    sound_vol: Math.min(0.5, Number(parameters.sound_vol ?? 0.2)),
  }).getRawBuffer().normalized;
  return samplesToWav(samples);
}
export function samplesToWav(samples: number[] | Float32Array) {
  const buffer = new ArrayBuffer(44 + samples.length * 2),
    view = new DataView(buffer);
  const text = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 44100, true);
  view.setUint32(28, 88200, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, Math.round(s * (s < 0 ? 32768 : 32767)), true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}

export function renderTrack(track: SoundTrack): Float32Array {
  return new Float32Array(
    new jsfxr.SoundEffect({
      ...track.parameters,
      sample_rate: 44100,
      sound_vol: Math.min(0.5, Math.max(0, Number(track.parameters.sound_vol ?? 0.2))),
    }).getRawBuffer().normalized,
  ).slice(0, 44100 * 20);
}
/** Sum tracks on one timeline, then apply a shared peak limiter to avoid clipping. */
export function mixSamples(
  tracks: {
    samples: Float32Array;
    gain: number;
    offset: number;
    muted: boolean;
  }[],
) {
  const active = tracks.filter((t) => !t.muted);
  const length = Math.max(1, ...active.map((t) => t.samples.length + Math.round(t.offset * 44100)));
  const mixed = new Float32Array(length);
  for (const t of active) {
    const offset = Math.round(t.offset * 44100);
    for (let i = 0; i < t.samples.length; i++) mixed[offset + i] += t.samples[i] * t.gain;
  }
  let maximum = 1;
  for (const v of mixed) maximum = Math.max(maximum, Math.abs(v));
  if (maximum > 1) for (let i = 0; i < mixed.length; i++) mixed[i] /= maximum;
  return mixed;
}
export function renderMix(preset: SoundPreset) {
  validateProject("sound", preset);
  return mixSamples(preset.tracks.map((t) => ({ ...t, samples: renderTrack(t) })));
}
export async function playSamples(samples: Float32Array) {
  if (!hasWebAudio()) throw new Error("この環境では音声を再生できません。");
  context ??= new AudioContext();
  await context.resume();
  stopPreset();
  const buffer = context.createBuffer(1, Math.max(1, samples.length), 44100);
  buffer.copyToChannel(new Float32Array(samples), 0);
  source = context.createBufferSource();
  source.buffer = buffer;
  source.connect(context.destination);
  source.start();
}
