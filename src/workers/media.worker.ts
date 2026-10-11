import { splitImage } from "../canvas/images";

self.onmessage = async (event: MessageEvent) => {
  try {
    const { type, blob, options } = event.data;
    const result =
      type === "hash"
        ? Array.from(
            new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer())),
          )
            .map((x) => x.toString(16).padStart(2, "0"))
            .join("")
        : await splitImage(blob, options);
    self.postMessage({ result });
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
