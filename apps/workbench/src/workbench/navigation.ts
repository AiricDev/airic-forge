import { useEffect, useRef, useState } from "react";
import { useUnsavedChanges } from "./UnsavedChanges";
export type View =
  | "dashboard"
  | "om"
  | "organization"
  | "governance"
  | "contributions"
  | "measurements"
  | "works"
  | "work-detail"
  | "reflections"
  | "git-access"
  | "lenses"
  | "users"
  | "settings"
  | "capabilities";
export type WorkRoute = {
  reflectionId?: string;
  page: number;
  owner: string;
  workType: string;
  status: string;
  workId: string;
  tab: "conversation" | "reflection";
  event: string;
};
export function readWorkRoute(): WorkRoute {
  const query = new URLSearchParams(window.location.search);
  const page = Number(query.get("page") || 1);
  return {
    reflectionId:
      /^\/reflections\/([a-zA-Z0-9_-]+)$/.exec(window.location.pathname)?.[1] ??
      "",
    page: Number.isSafeInteger(page) && page > 0 && page <= 100_000 ? page : 1,
    owner: query.get("owner") || "",
    workType: query.get("workType") || "",
    status: query.get("status") || "",
    workId:
      /^\/works\/([a-zA-Z0-9_-]+)$/.exec(window.location.pathname)?.[1] || "",
    tab: query.get("tab") === "reflection" ? "reflection" : "conversation",
    event: (query.get("event") || "").slice(0, 128),
  };
}
export function workUrl(route: WorkRoute) {
  const query = new URLSearchParams({
    owner: route.owner,
    page: String(route.page),
  });
  if (route.workType) query.set("workType", route.workType);
  if (route.status) query.set("status", route.status);
  if (route.workId) query.set("tab", route.tab);
  if (route.event && route.workId) query.set("event", route.event);
  return `${route.workId ? `/works/${encodeURIComponent(route.workId)}` : "/works"}?${query}`;
}
export function useNavigation() {
  const initial = readWorkRoute();
  const [route, setRoute] = useState(initial);
  const [view, setView] = useState<View>(
    initial.workId
      ? "work-detail"
      : window.location.pathname.startsWith("/reflections")
        ? "reflections"
        : window.location.pathname === "/works"
          ? "works"
          : "dashboard",
  );
  const { guard, isDirty } = useUnsavedChanges();
  const position = useRef(
    (window.history.state?.forgePosition as number | undefined) ?? 0,
  );
  const restoring = useRef(false);
  useEffect(() => {
    window.history.replaceState(
      { ...window.history.state, forgePosition: position.current },
      "",
    );
    const pop = (event: PopStateEvent) => {
      if (restoring.current) {
        restoring.current = false;
        return;
      }
      const target = event.state?.forgePosition as number | undefined;
      const delta = (target ?? 0) - position.current;
      if (isDirty() && delta) {
        restoring.current = true;
        window.history.go(-delta);
        guard(() => window.history.go(delta));
        return;
      }
      position.current = target ?? 0;
      const next = readWorkRoute();
      setRoute(next);
      setView(
        next.workId
          ? "work-detail"
          : window.location.pathname.startsWith("/reflections")
            ? "reflections"
            : window.location.pathname === "/works"
              ? "works"
              : "dashboard",
      );
    };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, [guard, isDirty]);
  const navigate = (next: View, nextRoute = route) =>
    guard(() => {
      const url =
        next === "works" || next === "work-detail"
          ? workUrl(nextRoute)
          : next === "reflections"
            ? `/reflections${nextRoute.reflectionId ? `/${nextRoute.reflectionId}` : ""}`
            : "/";
      window.history.pushState({ forgePosition: ++position.current }, "", url);
      setRoute(nextRoute);
      setView(next);
    });
  return {
    route,
    view,
    navigate,
    workHref: (workId: string, tab: WorkRoute["tab"] = "conversation") =>
      workUrl({ ...route, workId, tab, event: "" }),
    openWork: (workId: string, tab: WorkRoute["tab"] = "conversation") =>
      navigate("work-detail", { ...route, workId, tab, event: "" }),
    list: (changes: Partial<WorkRoute> = {}) =>
      navigate("works", { ...route, ...changes, workId: "", event: "" }),
  };
}
export type Navigation = ReturnType<typeof useNavigation>;
