import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, messageOf } from "./api";
import type { ReflectionRun } from "./types";

export const runIsActive = (run: ReflectionRun | null) =>
  run?.status === "running" || run?.status === "cancelling";

/** SSE text.delta frames carry a full snapshot, never a string to append. */
export function mergeRun(current: ReflectionRun | null, next: ReflectionRun) {
  if (current?.id === next.id && current.sequence >= next.sequence)
    return current;
  return next;
}

export async function readReflectionStream(
  response: Response,
  accept: (run: ReflectionRun, type: string) => void,
) {
  if (!response.ok)
    throw new ApiError(`读取回复失败（${response.status}）`, response.status);
  if (!response.body) throw new Error("回复连接未提供数据流。");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      buffer = buffer.replace(/\r\n/g, "\n");
      if (buffer.length > 2_000_000)
        throw new Error("回复数据超过单次读取限制。");
      let index;
      while ((index = buffer.indexOf("\n\n")) >= 0) {
        const frame = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        const lines = frame.split("\n");
        if (!lines.some((line) => line.trim() === "event: reflection"))
          continue;
        const raw = lines
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        const event = JSON.parse(raw) as {
          version: number;
          type: string;
          run: ReflectionRun;
        };
        if (
          event.version !== 1 ||
          !event.run?.id ||
          !Number.isSafeInteger(event.run.sequence)
        )
          throw new Error("回复数据格式无效。");
        accept(event.run, event.type);
        if (!runIsActive(event.run)) return;
      }
      if (done) return;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

type Pending = { message: string; requestId: string };

/** Observes server-owned runs. Disposing this hook only disconnects the reader. */
export function useReflectionRun(reflectionId: string, onChanged: () => void) {
  const [run, setRun] = useState<ReflectionRun | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const pendingRef = useRef<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [connection, setConnection] = useState("正在核对运行状态…");
  const [reconnect, setReconnect] = useState(0);
  const changed = useRef(onChanged);
  changed.current = onChanged;
  const epoch = useRef(0);
  const notified = useRef("");
  const base = `/api/v1/reflections/${encodeURIComponent(reflectionId)}/runs`;
  const savePending = (value: Pending | null) => {
    pendingRef.current = value;
    setPending(value);
  };
  const accept = useCallback(
    (next: ReflectionRun) => {
      if (next.reflectionId !== reflectionId) return;
      setRun((current) => mergeRun(current, next));
      if (pendingRef.current?.requestId === next.requestId) savePending(null);
      if (
        !runIsActive(next) &&
        notified.current !== `${next.id}:${next.sequence}`
      ) {
        notified.current = `${next.id}:${next.sequence}`;
        changed.current();
      }
    },
    [reflectionId],
  );

  const reconcile = useCallback(async () => {
    const currentEpoch = ++epoch.current;
    setLoading(true);
    setError("");
    try {
      const data = await api<{ run: ReflectionRun | null }>(`${base}/current`, {
        signal: AbortSignal.timeout(15000),
      });
      if (currentEpoch !== epoch.current) return;
      if (data.run) accept(data.run);
      setConnection("运行状态已核对");
      setReconnect((v) => v + 1);
      changed.current();
    } catch (cause) {
      if (currentEpoch === epoch.current) {
        setError(messageOf(cause));
        setConnection("连接中断");
      }
    } finally {
      if (currentEpoch === epoch.current) setLoading(false);
    }
  }, [base, accept]);

  useEffect(() => {
    void reconcile();
    return () => {
      epoch.current++;
    };
  }, [reconcile]);

  const runId = run?.id;
  const active = runIsActive(run);
  useEffect(() => {
    if (!runId || !active) return;
    const control = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let delay = 500;
    const connect = async () => {
      try {
        setConnection("正在连接回复…");
        const response = await fetch(
          `${base}/${encodeURIComponent(runId)}/events`,
          { credentials: "include", signal: control.signal },
        );
        if (control.signal.aborted) return;
        if (response.ok) {
          setConnection("实时回复已连接");
          setError("");
          delay = 500;
        }
        let finished = false;
        await readReflectionStream(response, (next, type) => {
          if (control.signal.aborted || next.id !== runId) return;
          accept(next);
          if (type === "proposal.updated") changed.current();
          finished = !runIsActive(next);
        });
        if (finished || control.signal.aborted) return;
      } catch (cause) {
        if (control.signal.aborted) return;
        if (
          cause instanceof ApiError &&
          [401, 403, 404].includes(cause.status)
        ) {
          setError("会话或读取权限已失效，请重新登录并核对权限。");
          setConnection("连接已停止");
          return;
        }
      }
      if (control.signal.aborted) return;
      setConnection("连接中断，正在恢复同一次运行…");
      timer = setTimeout(() => void connect(), delay);
      delay = Math.min(delay * 2, 5000);
    };
    void connect();
    return () => {
      control.abort();
      if (timer) clearTimeout(timer);
    };
  }, [base, runId, active, accept, reconnect]);

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || busyRef.current || loading || active) return false;
    if (pendingRef.current && pendingRef.current.message !== message) {
      setError("请先核对上一条请求的结果，或重试原请求。");
      return false;
    }
    const original = pendingRef.current ?? {
      message,
      requestId: crypto.randomUUID(),
    };
    savePending(original);
    busyRef.current = true;
    setBusy(true);
    setError("");
    epoch.current++;
    try {
      const data = await api<{ run: ReflectionRun }>(base, {
        method: "POST",
        body: JSON.stringify(original),
        signal: AbortSignal.timeout(15000),
      });
      accept(data.run);
      savePending(null);
      changed.current();
      return true;
    } catch (cause) {
      if (cause instanceof ApiError && cause.status < 500) {
        savePending(null);
        setError(messageOf(cause));
        if (cause.status === 409) await reconcile();
      } else {
        setError("请求结果未知；请核对状态或使用原请求重试，不会自动重发。");
      }
      return false;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const cancel = async () => {
    if (!run || !active || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await api<{ run: ReflectionRun }>(
        `${base}/${encodeURIComponent(run.id)}/cancel`,
        { method: "POST", signal: AbortSignal.timeout(15000) },
      );
      accept(result.run);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  return {
    run,
    active,
    pending,
    busy,
    loading,
    error,
    connection,
    send,
    cancel,
    reconcile,
  };
}
