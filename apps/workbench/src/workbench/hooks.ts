import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, messageOf } from "./api";

/** A page owns the URL and its resource. Late responses cannot replace a new selection. */
export function useResource<T>(url: string | null) {
  const [state, setState] = useState<{
    url: string | null;
    data?: T;
    error: string;
    loading: boolean;
    status?: number;
  }>({ url, error: "", loading: Boolean(url) });
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    if (!url) {
      setState({ url, error: "", loading: false });
      return;
    }
    let current = true;
    setState({ url, loading: true, error: "" });
    void api<T>(url)
      .then((data) => {
        if (current) setState({ url, data, loading: false, error: "" });
      })
      .catch((error) => {
        if (current)
          setState({
            url,
            loading: false,
            error: messageOf(error),
            status: error instanceof ApiError ? error.status : undefined,
          });
      });
    return () => {
      current = false;
    };
  }, [url, revision]);
  return {
    ...(state.url === url
      ? state
      : { url, error: "", loading: Boolean(url), data: undefined }),
    reload,
  };
}

export function useCommand() {
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const run = async (
    action: () => Promise<void>,
    success = "",
  ): Promise<boolean> => {
    if (pending.current) return false;
    pending.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      setNotice(success);
      return true;
    } catch (cause) {
      setError(messageOf(cause));
      return false;
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  return { busy, error, notice, run, clearNotice: () => setNotice("") };
}
