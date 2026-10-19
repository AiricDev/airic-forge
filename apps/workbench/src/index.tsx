import "@fontsource/roboto/latin-300.css";
import "@fontsource/roboto/latin-400.css";
import "@fontsource/roboto/latin-500.css";
import "@fontsource/roboto/latin-700.css";
import ReactDOM from "react-dom/client";
import { CssBaseline, ThemeProvider } from "@mui/material";
import { StageOneApp } from "./StageOneApp";
import { theme } from "./workbench/theme";
const root = document.getElementById("root");
if (root)
  ReactDOM.createRoot(root).render(
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <StageOneApp />
    </ThemeProvider>,
  );
