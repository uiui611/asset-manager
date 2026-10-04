import "fake-indexeddb/auto";

Object.defineProperty(globalThis, "localStorage", {
  value: { getItem: () => null },
});

Object.defineProperty(globalThis, "document", {
  value: { baseURI: "http://localhost/" },
  configurable: true,
});
