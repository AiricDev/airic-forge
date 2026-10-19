import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
} from "@mui/material";
import type { ReactNode } from "react";
type Guard = {
  register: (key: symbol, dirty: boolean, discard: () => void) => void;
  guard: (action: () => void) => void;
  isDirty: () => boolean;
};
const Context = createContext<Guard | null>(null);
export function UnsavedChangesProvider({ children }: { children: ReactNode }) {
  const dirty = useRef(new Map<symbol, () => void>());
  const [pending, setPending] = useState<(() => void) | null>(null);
  const register = useCallback(
    (key: symbol, value: boolean, discard: () => void) => {
      if (value) dirty.current.set(key, discard);
      else dirty.current.delete(key);
    },
    [],
  );
  const isDirty = useCallback(() => dirty.current.size > 0, []);
  const guard = useCallback((action: () => void) => {
    if (dirty.current.size) setPending(() => action);
    else action();
  }, []);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (dirty.current.size) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, []);
  return (
    <Context.Provider value={{ register, guard, isDirty }}>
      {children}
      <Dialog
        open={Boolean(pending)}
        onClose={() => setPending(null)}
        aria-labelledby="unsaved-title"
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle id="unsaved-title">有未保存的修改</DialogTitle>
        <DialogContent>
          <DialogContentText>
            离开将放弃尚未保存的输入，已保存的草稿会保留。
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button autoFocus onClick={() => setPending(null)}>
            继续编辑
          </Button>
          <Button
            onClick={() => {
              const action = pending;
              dirty.current.forEach((discard) => discard());
              dirty.current.clear();
              setPending(null);
              action?.();
            }}
          >
            放弃修改
          </Button>
        </DialogActions>
      </Dialog>
    </Context.Provider>
  );
}
export function useUnsavedChanges() {
  const value = useContext(Context);
  if (!value) throw new Error("UnsavedChangesProvider is required");
  return value;
}
export function useDirty(value: boolean, onDiscard?: () => void) {
  const key = useRef(Symbol("editor"));
  const discard = useRef(onDiscard);
  discard.current = onDiscard;
  const { register } = useUnsavedChanges();
  useEffect(() => {
    const id = key.current;
    register(id, value, () => discard.current?.());
    return () => register(id, false, () => undefined);
  }, [value, register]);
}
