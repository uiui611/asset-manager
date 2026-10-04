declare module "jsfxr" {
  export const sfxr: {
    generate(preset: string): Record<string, number | string | boolean>;
  };
  export const jsfxr: {
    SoundEffect: new (
      parameters: Record<string, number | string | boolean>,
    ) => { sampleRate: number; getRawBuffer(): { normalized: number[] } };
  };
}
