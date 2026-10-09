import { html } from "lit";

const paths: Record<string, string> = {
  grid: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  image: "M3 4h18v16H3z M3 16l5-5 5 5 3-3 5 5 M15 8h.01",
  map: "M3 5l6-2 6 2 6-2v16l-6 2-6-2-6 2z M9 3v16 M15 5v16",
  character: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M4 21v-2a8 8 0 0 1 16 0v2",
  sound:
    "M9 18V5l12-2v13 M9 8l12-2 M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6 M18 19a3 3 0 1 0 0-6 3 3 0 0 0 0 6",
  settings:
    "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M12 2v3 M12 19v3 M2 12h3 M19 12h3 M5 5l2 2 M17 17l2 2 M5 19l2-2 M17 7l2-2",
  upload: "M12 16V3 M7 8l5-5 5 5 M3 15v6h18v-6",
  search: "M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14 M15 15l6 6",
  cloud: "M6 18a5 5 0 0 1-1-10 7 7 0 0 1 13-1 5 5 0 0 1 0 11z",
  arrow: "M5 12h14 M13 6l6 6-6 6",
  plus: "M12 4v16 M4 12h16",
  download: "M12 3v13 M7 11l5 5 5-5 M3 17v4h18v-4",
  close: "M5 5l14 14 M5 19L19 5",
  trash: "M3 6h18 M9 6V3h6v3 M6 6l1 15h10l1-15 M10 10v7 M14 10v7",
  check: "M4 12l5 5L20 6",
  layers: "M2 8l10-6 10 6-10 6z M2 12l10 6 10-6 M2 16l10 6 10-6",
  refresh: "M3 11a9 9 0 0 1 16-6l2 2 M21 3v4h-4 M21 13a9 9 0 0 1-16 6l-2-2 M3 21v-4h4",
  folder: "M3 5h7l2 3h9v13H3z",
  stop: "M6 6h12v12H6z",
  pause: "M8 4v16 M16 4v16",
  previous: "M5 4v16 M19 4L7 12l12 8z",
  next: "M19 4v16 M5 4l12 8-12 8z",
  play: "M8 4l12 8-12 8z",
  tag: "M3 3h9l9 9-9 9-9-9z M7 7h.01",
  code: "M8 5l-7 7 7 7 M16 5l7 7-7 7 M14 3l-4 18",
};
export const icon = (name: string, size = 18) =>
  html`<svg
    width=${size}
    height=${size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.6"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path d=${paths[name] || paths.folder}></path>
  </svg>`;
