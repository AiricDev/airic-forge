import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider } from "@mui/material";
import { afterEach, expect, it, vi } from "vitest";
import { SettingsPage } from "./pages/AdminOverviewPages";
import { theme } from "./theme";

afterEach(() => vi.unstubAllGlobals());

it("retries unavailable instance metadata without inventing defaults without catalog management", async () => {
  const settings = {
    operatingModel: {
      repositoryPath: "/srv/actual OM/project",
      dataPath: "/srv/actual OM/data",
      personalWorktreesPath: "/srv/actual OM/data/worktrees/users",
    },
    integration: {
      appId: "certlab",
      organizationId: "bound-organization",
      baseUrl: "https://configured.example",
      mcpUrl: "https://configured.example/mcp",
      transport: "streamable-http",
    },
  };
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status });
  let reads = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url === "/api/v1/instance-settings") {
        return ++reads === 1
          ? json({ error: "FixtureSettingsUnavailable" }, 503)
          : json(settings);
      }
      throw new Error(`Unexpected request: ${url}`);
    }),
  );
  render(
    <ThemeProvider theme={theme}>
      <SettingsPage />
    </ThemeProvider>,
  );
  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent(
      "FixtureSettingsUnavailable",
    ),
  );
  expect(
    screen.queryByText(settings.operatingModel.repositoryPath),
  ).not.toBeInTheDocument();
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "重试" }));
  expect(
    await screen.findByText(settings.operatingModel.repositoryPath),
  ).toBeVisible();
  expect(
    screen.getByRole("link", { name: settings.integration.mcpUrl }),
  ).toHaveAttribute("href", settings.integration.mcpUrl);
  expect(screen.getByText("传输类型：streamable-http")).toBeVisible();
  expect(screen.queryByText(/Reflection lens/)).not.toBeInTheDocument();
  expect(screen.queryByRole("tab")).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "实例设置" })).toBeVisible();
  expect(
    screen.queryByRole("heading", { name: "能力目录" }),
  ).not.toBeInTheDocument();
});
