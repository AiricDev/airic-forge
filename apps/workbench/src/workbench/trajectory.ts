import type { TrajectoryEvent } from "./types";

/** A display projection only. Original append-only events remain citeable. */
export function presentationEvents(
  events: TrajectoryEvent[],
  focusedId?: string,
) {
  const completed = new Set(
    events.filter((e) => e.type === "turn.completed").map((e) => e.turnId),
  );
  const fragments = new Map<
    string,
    { text: string; count: number; lastId: string }
  >();
  for (const event of events) {
    const text = event.payload.agentTextDelta;
    if (
      event.type !== "message" ||
      typeof text !== "string" ||
      !event.turnId ||
      event.payload.partial === true ||
      completed.has(event.turnId)
    )
      continue;
    const group = fragments.get(event.turnId) ?? {
      text: "",
      count: 0,
      lastId: "",
    };
    group.text += text;
    group.count++;
    group.lastId = event.id;
    fragments.set(event.turnId, group);
  }
  return events.flatMap((event): TrajectoryEvent[] => {
    if (
      event.type !== "message" ||
      typeof event.payload.agentTextDelta !== "string" ||
      !event.turnId ||
      event.payload.partial === true
    )
      return [event];
    const group = fragments.get(event.turnId);
    if (completed.has(event.turnId) || event.id !== group?.lastId)
      return event.id === focusedId ? [event] : [];
    return [
      {
        ...event,
        payload: {
          ...event.payload,
          agentTextDelta: group.text,
          partial: true,
          historicalFragmentCount: group.count,
        },
      },
    ];
  });
}
