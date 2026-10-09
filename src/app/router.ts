export const pages = ["assets", "maps", "characters", "sounds", "sprites", "settings"] as const;
export type Page = (typeof pages)[number];
export function currentPage(): Page {
  const page = location.hash.slice(1).split("?")[0];
  return pages.includes(page as Page) ? (page as Page) : "assets";
}
export function currentProject() {
  return new URLSearchParams(location.hash.split("?")[1]).get("project");
}
export function navigate(page: Page, projectId?: string) {
  history.pushState(
    null,
    "",
    `#${page}${projectId ? `?project=${encodeURIComponent(projectId)}` : ""}`,
  );
  window.dispatchEvent(new PopStateEvent("popstate"));
}
