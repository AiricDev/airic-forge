import { lazy, Suspense, useEffect, useState } from "react";
import {
  Alert,
  AppBar,
  Avatar,
  Box,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Stack,
  TextField,
  Toolbar,
  Typography,
} from "@mui/material";
import MenuIcon from "@mui/icons-material/Menu";
import DashboardIcon from "@mui/icons-material/Dashboard";
import DescriptionIcon from "@mui/icons-material/Description";
import WorkHistoryIcon from "@mui/icons-material/WorkHistory";
import CompareArrowsIcon from "@mui/icons-material/CompareArrows";
import MergeIcon from "@mui/icons-material/Merge";
import PeopleIcon from "@mui/icons-material/People";
import SettingsIcon from "@mui/icons-material/Settings";
import AssessmentIcon from "@mui/icons-material/Assessment";
import PsychologyIcon from "@mui/icons-material/Psychology";
import type { AuthResult, User } from "./types";
import { api, ApiError, command } from "./api";
import { useCommand, useResource } from "./hooks";
import { Feedback, ResourceState } from "./ui";
import { UnsavedChangesProvider, useUnsavedChanges } from "./UnsavedChanges";
import { useNavigation } from "./navigation";
import type { View } from "./navigation";
import { AuthPage } from "./AuthPage";
const DashboardPage = lazy(() =>
  import("./pages/DashboardPage").then((m) => ({ default: m.DashboardPage })),
);
const WorkListPage = lazy(() =>
  import("./pages/WorkListPage").then((m) => ({ default: m.WorkListPage })),
);
const WorkDetailPage = lazy(() =>
  import("./pages/WorkDetailPage").then((m) => ({ default: m.WorkDetailPage })),
);
const OmPage = lazy(() =>
  import("./pages/OmPage").then((m) => ({ default: m.OmPage })),
);
const ReflectionsPage = lazy(() =>
  import("./pages/ReflectionsPage").then((m) => ({
    default: m.ReflectionsPage,
  })),
);
const GitAccessPage = lazy(() =>
  import("./pages/GitAccessPage").then((m) => ({ default: m.GitAccessPage })),
);
const ContributionsPage = lazy(() =>
  import("./pages/ContributionsPage").then((m) => ({
    default: m.ContributionsPage,
  })),
);
const LensesPage = lazy(() =>
  import("./pages/LensesPage").then((m) => ({ default: m.LensesPage })),
);
const MeasurementsPage = lazy(() =>
  import("./pages/AdminOverviewPages").then((m) => ({
    default: m.MeasurementsPage,
  })),
);
const SettingsPage = lazy(() =>
  import("./pages/AdminOverviewPages").then((m) => ({
    default: m.SettingsPage,
  })),
);
const UsersPage = lazy(() =>
  import("./pages/AdminOverviewPages").then((m) => ({ default: m.UsersPage })),
);
export function WorkspaceApp() {
  return (
    <UnsavedChangesProvider>
      <AccountWorkspace />
    </UnsavedChangesProvider>
  );
}
function AccountWorkspace() {
  const [account, setAccount] = useState<AuthResult | null>(null);
  const me = useResource<AuthResult>("/api/v1/auth/me");
  const [ticket, setTicket] = useState(
    () => new URLSearchParams(window.location.hash.slice(1)).get("setup") || "",
  );
  const [setupNotice, setSetupNotice] = useState("");
  useEffect(() => {
    if (me.data) setAccount(me.data);
  }, [me.data]);
  useEffect(() => {
    const read = () =>
      setTicket(
        new URLSearchParams(window.location.hash.slice(1)).get("setup") || "",
      );
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);
  if (ticket)
    return (
      <AuthPage
        ticket={ticket}
        onLogin={setAccount}
        onPasswordSet={() => {
          window.history.replaceState(
            window.history.state,
            "",
            window.location.pathname + window.location.search,
          );
          setTicket("");
          setAccount(null);
          setSetupNotice("密码已设置，请使用 AiricForge 账户登录。");
        }}
      />
    );
  if (!account && me.loading)
    return (
      <Box sx={{ p: 4 }}>
        <ResourceState {...me} retry={me.reload} />
      </Box>
    );
  if (!account && me.error && me.status !== 401)
    return (
      <Box sx={{ p: 4 }}>
        <ResourceState {...me} retry={me.reload} />
      </Box>
    );
  if (!account)
    return (
      <>
        <AuthPage
          ticket=""
          onLogin={setAccount}
          onPasswordSet={() => undefined}
        />
        <Feedback
          error=""
          notice={setupNotice}
          clearNotice={() => setSetupNotice("")}
        />
      </>
    );
  return (
    <Workbench
      key={account.user.id}
      account={account}
      onLogout={() => {
        setAccount(null);
        window.history.replaceState(null, "", "/");
      }}
    />
  );
}
const primary = [
  { view: "dashboard", label: "工作台", icon: DashboardIcon },
  { view: "om", label: "Operating Model", icon: DescriptionIcon },
  { view: "works", label: "Work 与轨迹", icon: WorkHistoryIcon },
  { view: "reflections", label: "改进工作方式", icon: CompareArrowsIcon },
  { view: "git-access", label: "本地 agent 与 Git", icon: CompareArrowsIcon },
] as const;
const admin = [
  { view: "contributions", label: "组织贡献", icon: MergeIcon },
  { view: "users", label: "用户与资源", icon: PeopleIcon },
  { view: "settings", label: "实例设置", icon: SettingsIcon },
  { view: "lenses", label: "Lens 管理", icon: PsychologyIcon },
  { view: "measurements", label: "成效基线", icon: AssessmentIcon },
] as const;
function Workbench({
  account,
  onLogout,
}: {
  account: AuthResult;
  onLogout: () => void;
}) {
  const [user, setUser] = useState(account.user);
  const refreshAccount = async () => {
    try {
      const result = await api<AuthResult>("/api/v1/auth/me");
      setUser(result.user);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) onLogout();
    }
  };
  useEffect(() => {
    const refresh = () => {
      void refreshAccount();
    };
    window.addEventListener("focus", refresh);
    const interval = window.setInterval(refresh, 5000);
    return () => {
      window.removeEventListener("focus", refresh);
      window.clearInterval(interval);
    };
  }, []);

  const n = useNavigation();
  const { guard } = useUnsavedChanges();
  const c = useCommand();
  const users = useResource<{
    users: User[];
  }>(
    user.role === "admin" && user.status === "active" ? "/api/v1/users" : null,
  );
  useEffect(() => {
    if (n.view !== "users" || user.role !== "admin" || user.status !== "active")
      return;
    users.reload();
    const interval = window.setInterval(users.reload, 3000);
    return () => window.clearInterval(interval);
  }, [n.view, user.role, user.status, users.reload]);
  const [mobile, setMobile] = useState(false);
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const [branch, setBranch] = useState(user.id);
  const title =
    n.view === "work-detail"
      ? "Work 详情"
      : n.view === "organization"
        ? "Operating Model"
        : ([...primary, ...admin].find((item) => item.view === n.view)?.label ??
          "工作台");
  const navigate = (view: View) => {
    if (view === "works") n.list();
    else n.navigate(view);
    setMobile(false);
  };
  const openOm = (id: string) =>
    guard(() => {
      setBranch(id);
      n.navigate("om");
    });
  const content = (
    <>
      <Toolbar>
        <Typography variant="h6" component="div">
          AiricForge
        </Typography>
      </Toolbar>
      <Divider />
      <List aria-label="主导航">
        {primary.map(({ view, label, icon: Icon }) => (
          <ListItemButton
            key={view}
            disabled={user.status !== "active"}
            selected={
              n.view === view ||
              (view === "works" && n.view === "work-detail") ||
              (view === "om" && n.view === "organization")
            }
            onClick={() => {
              navigate(view);
            }}
          >
            <ListItemIcon>
              <Icon />
            </ListItemIcon>
            <ListItemText primary={label} />
          </ListItemButton>
        ))}
      </List>
      {user.role === "admin" && user.status === "active" && (
        <>
          <Divider />
          <List aria-label="管理导航">
            {admin.map(({ view, label, icon: Icon }) => (
              <ListItemButton
                key={view}
                selected={n.view === view}
                onClick={() => {
                  navigate(view);
                }}
              >
                <ListItemIcon>
                  <Icon />
                </ListItemIcon>
                <ListItemText primary={label} />
              </ListItemButton>
            ))}
          </List>
        </>
      )}
    </>
  );
  return (
    <Box sx={{ display: "flex", minHeight: "100vh" }}>
      <Box component="nav" sx={{ width: { md: 260 }, flexShrink: { md: 0 } }}>
        <Drawer
          variant="temporary"
          open={mobile}
          onClose={() => setMobile(false)}
          ModalProps={{ keepMounted: true }}
          sx={{
            display: { xs: "block", md: "none" },
            "& .MuiDrawer-paper": { width: 260 },
          }}
        >
          {content}
        </Drawer>
        <Drawer
          variant="permanent"
          open
          sx={{
            display: { xs: "none", md: "block" },
            "& .MuiDrawer-paper": { width: 260, boxSizing: "border-box" },
          }}
        >
          {content}
        </Drawer>
      </Box>
      <Box sx={{ flexGrow: 1, minWidth: 0 }}>
        <AppBar position="sticky">
          <Toolbar sx={{ gap: 1, flexWrap: "wrap" }}>
            <IconButton
              color="inherit"
              aria-label="打开导航"
              onClick={() => setMobile(true)}
              sx={{ display: { md: "none" } }}
            >
              <MenuIcon />
            </IconButton>
            <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
              {title}
            </Typography>
            {account.testIdentitySwitch && (
              <TextField
                select
                label="测试身份"
                variant="filled"
                value={user.id}
                disabled={c.busy}
                onChange={(e) =>
                  guard(() => {
                    void c.run(async () => {
                      await command("/api/v1/auth/test-identity", "POST", {
                        userId: e.target.value,
                      });
                      window.location.reload();
                    });
                  })
                }
                sx={{
                  my: 1,
                  minWidth: 200,
                  bgcolor: "background.paper",
                  borderRadius: 1,
                }}
                size="small"
              >
                {account.testIdentitySwitch.users.map((u) => (
                  <MenuItem key={u.id} value={u.id}>
                    {u.email}
                    {u.id === account.testIdentitySwitch?.originalUserId
                      ? "（原管理员）"
                      : ""}
                  </MenuItem>
                ))}
              </TextField>
            )}
            <IconButton
              color="inherit"
              aria-label="账户菜单"
              aria-controls={menu ? "account-menu" : undefined}
              aria-expanded={Boolean(menu)}
              aria-haspopup="true"
              onClick={(e) => setMenu(e.currentTarget)}
            >
              <Avatar sx={{ width: 32, height: 32 }}>
                {user.email[0].toUpperCase()}
              </Avatar>
            </IconButton>
            <Menu
              id="account-menu"
              anchorEl={menu}
              open={Boolean(menu)}
              onClose={() => setMenu(null)}
            >
              <MenuItem disabled>
                {user.email} ·{" "}
                {user.role === "admin" && user.status === "active"
                  ? "管理员"
                  : "用户"}
              </MenuItem>
              <MenuItem
                onClick={() => {
                  setMenu(null);
                  guard(() => {
                    void c.run(async () => {
                      await command("/api/v1/auth/logout");
                      onLogout();
                    });
                  });
                }}
              >
                退出
              </MenuItem>
            </Menu>
          </Toolbar>
        </AppBar>
        <Stack
          component="main"
          id="main"
          spacing={3}
          sx={{ p: { xs: 2, md: 3 }, maxWidth: 1800, mx: "auto" }}
        >
          <Feedback {...c} />
          {user.status === "draining" && (
            <Alert severity="warning">
              账号停用中。已受理任务允许结束；当前仅可查看任务进度或主动停止，不能开始新操作。
            </Alert>
          )}
          {user.role === "admin" && user.status === "active" && (
            <ResourceState {...users} retry={users.reload} />
          )}
          <Suspense
            fallback={
              <ResourceState loading error="" retry={() => undefined} />
            }
          >
            {n.view === "dashboard" && (
              <DashboardPage
                user={user}
                navigation={n}
                openOm={() => openOm(user.id)}
              />
            )}
            {n.view === "works" && (
              <WorkListPage
                user={user}
                users={users.data?.users ?? []}
                navigation={n}
              />
            )}
            {n.view === "work-detail" && (
              <WorkDetailPage key={n.route.workId} user={user} navigation={n} />
            )}
            {(n.view === "om" || n.view === "organization") && (
              <OmPage
                user={user}
                users={users.data?.users ?? []}
                branch={branch}
                selectBranch={setBranch}
              />
            )}
            {n.view === "reflections" && (
              <ReflectionsPage navigation={n} user={user} />
            )}
            {n.view === "git-access" && <GitAccessPage />}
            {user.role === "admin" && user.status === "active" && (
              <>
                {n.view === "users" && (
                  <UsersPage
                    users={users.data?.users ?? []}
                    changed={async () => {
                      await refreshAccount();
                      users.reload();
                    }}
                    openOm={openOm}
                    openWorks={(id) => n.list({ owner: id, page: 1 })}
                  />
                )}
                {n.view === "settings" && <SettingsPage />}
                {n.view === "measurements" && <MeasurementsPage />}
                {n.view === "lenses" && <LensesPage />}
                {n.view === "contributions" && (
                  <ContributionsPage users={users.data?.users ?? []} />
                )}
              </>
            )}
          </Suspense>
        </Stack>
      </Box>
    </Box>
  );
}
