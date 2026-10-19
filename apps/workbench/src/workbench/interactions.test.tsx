import { useState } from "react";
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { ThemeProvider } from "@mui/material";
import { theme } from "./theme";
import { useCommand, useResource } from "./hooks";
import {
  UnsavedChangesProvider,
  useDirty,
  useUnsavedChanges,
} from "./UnsavedChanges";
import { ProposalReview } from "./ProposalReview";
import { AuthPage } from "./AuthPage";
afterEach(() => vi.unstubAllGlobals());
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status });
it("ignores a late response after selection changes and retries a failed read", async () => {
  let resolveOld!: (response: Response) => void;
  const fetch = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          resolveOld = resolve;
        }),
    )
    .mockResolvedValueOnce(json({ error: "Unavailable" }, 503))
    .mockResolvedValueOnce(json({ id: "new" }));
  vi.stubGlobal("fetch", fetch);
  const { result, rerender } = renderHook(
    ({ url }) => useResource<{ id: string }>(url),
    { initialProps: { url: "/old" } },
  );
  rerender({ url: "/new" });
  await waitFor(() => expect(result.current.error).toBe("Unavailable"));
  act(() => result.current.reload());
  await waitFor(() => expect(result.current.data?.id).toBe("new"));
  await act(async () => resolveOld(json({ id: "old" })));
  expect(result.current.data?.id).toBe("new");
});
it("prevents duplicate commands and keeps errors until a successful retry", async () => {
  let reject!: (error: Error) => void;
  const action = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<void>((_, r) => {
          reject = r;
        }),
    )
    .mockResolvedValue(undefined);
  const { result } = renderHook(useCommand);
  let first!: Promise<boolean>;
  act(() => {
    first = result.current.run(action);
  });
  await act(async () => {
    expect(await result.current.run(action)).toBe(false);
  });
  expect(action).toHaveBeenCalledTimes(1);
  await act(async () => {
    reject(new Error("Conflict"));
    await first;
  });
  expect(result.current.error).toBe("Conflict");
  await act(async () => {
    expect(await result.current.run(action, "Saved")).toBe(true);
  });
  expect(result.current.error).toBe("");
  expect(result.current.notice).toBe("Saved");
});
function Editor() {
  const [value, setValue] = useState("");
  const [left, setLeft] = useState(false);
  const { guard } = useUnsavedChanges();
  useDirty(Boolean(value), () => setValue(""));
  return (
    <>
      <input
        aria-label="编辑"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <button onClick={() => guard(() => setLeft(true))}>离开</button>
      {left && <span>已经离开</span>}
    </>
  );
}
it("offers continue and discard without saving and restores focus", async () => {
  const user = userEvent.setup();
  render(
    <ThemeProvider theme={theme}>
      <UnsavedChangesProvider>
        <Editor />
      </UnsavedChangesProvider>
    </ThemeProvider>,
  );
  await user.type(screen.getByLabelText("编辑"), "private input");
  await user.click(screen.getByRole("button", { name: "离开" }));
  await user.click(screen.getByRole("button", { name: "继续编辑" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(screen.getByLabelText("编辑")).toHaveValue("private input");
  expect(screen.getByRole("button", { name: "离开" })).toHaveFocus();
  await user.click(screen.getByRole("button", { name: "离开" }));
  await user.click(screen.getByRole("button", { name: "放弃修改" }));
  expect(screen.getByText("已经离开")).toBeVisible();
  expect(screen.getByLabelText("编辑")).toHaveValue("");
});
it("keeps a failed adoption dialog open and never exposes a Reflection file editor", async () => {
  const proposal = {
    proposal: {
      id: "p1",
      ownerUserId: "u",
      reflectionId: "r",
      baseRevision: "head",
      reviewedRevision: "reviewed",
      status: "open",
      reason: "Evidence-backed improvement",
      evidence: "event-1",
    },
    activeRevision: "head",
    changedPaths: ["policy.md"],
    conflicts: [],
    diff: "+ improvement",
  };
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockImplementation((path: string) =>
        Promise.resolve(
          path.endsWith("/adopt")
            ? json({ error: "ProposalBaseChanged" }, 409)
            : json(proposal),
        ),
      ),
  );
  const user = userEvent.setup();
  render(
    <ThemeProvider theme={theme}>
      <UnsavedChangesProvider>
        <ProposalReview id="p1" canWrite />
      </UnsavedChangesProvider>
    </ThemeProvider>,
  );
  await user.click(await screen.findByRole("button", { name: "确认采纳" }));
  const dialog = screen.getByRole("dialog");
  await user.click(within(dialog).getByRole("button", { name: "确认采纳" }));
  expect(await within(dialog).findByRole("alert")).toHaveTextContent(
    "ProposalBaseChanged",
  );
  expect(screen.getByRole("dialog")).toBeVisible();
  expect(screen.queryByLabelText("OM 文件内容")).not.toBeInTheDocument();
});
it("keeps authentication input after failure and validates password confirmation", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue(json({ error: "InvalidCredentials" }, 401));
  vi.stubGlobal("fetch", fetch);
  const user = userEvent.setup();
  const view = render(
    <ThemeProvider theme={theme}>
      <AuthPage ticket="" onLogin={vi.fn()} onPasswordSet={vi.fn()} />
    </ThemeProvider>,
  );
  await user.type(screen.getByLabelText(/^Email/), "user@example.invalid");
  await user.type(screen.getByLabelText(/^密码/), "secret");
  fireEvent.submit(
    screen.getByRole("button", { name: "登录" }).closest("form")!,
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "InvalidCredentials",
  );
  expect(screen.getByLabelText(/^Email/)).toHaveValue("user@example.invalid");
  expect(screen.getByLabelText(/^密码/)).toHaveValue("secret");
  view.unmount();
  fetch.mockClear();
  render(
    <ThemeProvider theme={theme}>
      <AuthPage
        ticket="setup-ticket"
        onLogin={vi.fn()}
        onPasswordSet={vi.fn()}
      />
    </ThemeProvider>,
  );
  await user.type(screen.getByLabelText(/^密码/), "new-password-123");
  await user.type(screen.getByLabelText(/^确认密码/), "different-password");
  fireEvent.submit(
    screen.getByRole("button", { name: "设置密码" }).closest("form")!,
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "两次输入的密码不一致",
  );
  expect(fetch).not.toHaveBeenCalled();
});

it("distinguishes an expired identity from a retryable identity read failure", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(json({ error: "Unauthorized" }, 401))
    .mockResolvedValueOnce(json({ error: "Unavailable" }, 503));
  vi.stubGlobal("fetch", fetch);
  const { result } = renderHook(() => useResource("/api/v1/auth/me"));
  await waitFor(() => expect(result.current.status).toBe(401));
  act(() => result.current.reload());
  await waitFor(() => expect(result.current.status).toBe(503));
});
