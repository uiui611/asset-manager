const positive = { type: "integer", minimum: 1, maximum: 4096 };
const number = { type: "number" };
const unit = { type: "number", minimum: 0, maximum: 1 };
const base = {
  schemaVersion: { const: 1 },
  id: { type: "string", minLength: 1 },
  name: { type: "string", minLength: 0, maxLength: 255 },
  updatedAt: { type: "string" },
};
const required = Object.keys(base);

export const schemas = {
  map: {
    type: "object",
    required: [
      ...required,
      "width",
      "height",
      "tileWidth",
      "tileHeight",
      "layers",
      "tilesets",
    ],
    properties: {
      ...base,
      width: positive,
      height: positive,
      tileWidth: positive,
      tileHeight: positive,
      tilesets: {
        type: "array",
        items: {
          type: "object",
          required: ["assetId"],
          properties: { assetId: { type: "string" } },
        },
      },
      layers: {
        type: "array",
        minItems: 1,
        maxItems: 64,
        items: {
          type: "object",
          required: ["id", "name", "visible", "opacity", "locked", "cells"],
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            visible: { type: "boolean" },
            locked: { type: "boolean" },
            tileset: {
              type: "object",
              required: ["assetId", "tileWidth", "tileHeight"],
              properties: {
                assetId: { type: "string" },
                tileWidth: { type: "integer", minimum: 1, maximum: 4096 },
                tileHeight: { type: "integer", minimum: 1, maximum: 4096 },
              },
            },
            opacity: unit,
            cells: { type: "array", items: { type: "integer", minimum: -1 } },
          },
        },
      },
    },
  },
  character: {
    type: "object",
    required: [...required, "canvas", "layers"],
    properties: {
      ...base,
      previewImage: {
        type: "string",
        maxLength: 300000,
        pattern: "^data:image/png;base64,[A-Za-z0-9+/=]+$",
      },
      canvas: {
        type: "object",
        required: ["width", "height"],
        properties: { width: positive, height: positive },
      },
      layers: {
        type: "array",
        maxItems: 100,
        items: {
          type: "object",
          required: [
            "id",
            "assetId",
            "x",
            "y",
            "scaleX",
            "scaleY",
            "rotation",
            "opacity",
            "visible",
            "zIndex",
          ],
          properties: {
            id: { type: "string" },
            assetId: { type: "string" },
            x: number,
            y: number,
            scaleX: { type: "number", minimum: 0.01, maximum: 100 },
            scaleY: { type: "number", minimum: 0.01, maximum: 100 },
            rotation: number,
            opacity: unit,
            visible: { type: "boolean" },
            zIndex: { type: "integer" },
          },
        },
      },
    },
  },
  sound: {
    type: "object",
    required: [...required, "format", "tracks"],
    properties: {
      ...base,
      format: { const: "multitrack" },
      tracks: {
        type: "array",
        minItems: 1,
        maxItems: 8,
        items: {
          type: "object",
          required: ["id", "name", "parameters", "gain", "offset", "muted"],
          properties: {
            id: { type: "string" },
            name: { type: "string", maxLength: 255 },
            gain: unit,
            offset: { type: "number", minimum: 0, maximum: 10 },
            muted: { type: "boolean" },
            parameters: {
              type: "object",
              additionalProperties: { type: ["number", "string", "boolean"] },
            },
          },
        },
      },
    },
  },
};
