import { useState } from "react";
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
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
import { OmDraftReview } from "./OmDraftReview";
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
it("keeps a failed direct commit readable without introducing an approval entity", async () => {
  const draft = {
    ownerUserId: "u",
    scope: "manual",
    baseRevision: "head",
    activeRevision: "head",
    digest: "digest",
    summary: "Improve method",
    conflicts: [],
    edits: [
      {
        path: "work-definitions/report-authoring/policy.md",
        content: "Improved policy",
      },
    ],
  };
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockImplementation((path: string) =>
        Promise.resolve(
          path.endsWith("/commit")
            ? json({ error: "ActiveRevisionChanged" }, 409)
            : path.includes("/file?")
              ? json({ content: "Original policy" })
              : json(draft),
        ),
      ),
  );
  const user = userEvent.setup();
  render(
    <ThemeProvider theme={theme}>
      <UnsavedChangesProvider>
        <OmDraftReview scope="manual" canWrite />
      </UnsavedChangesProvider>
    </ThemeProvider>,
  );
  await user.click(await screen.findByRole("button", { name: "确认并提交" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "ActiveRevisionChanged",
  );
  expect(screen.getByLabelText("提交后内容")).toHaveValue("Improved policy");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
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
