import React, { useState } from "react";
import ReactDOM from "react-dom/client";
import { App, ConfigProvider, theme } from "antd";
import zhCN from "antd/locale/zh_CN";
import { ThemeProvider } from "antd-style";
import WorkspaceApp from "./features/workspace/WorkspaceApp";
import { BrowserRouter } from "react-router";
import "./features/workspace/workspace.css";
import "./style.css";

function Root() {
  const [dark, setDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
  return (
    <ThemeProvider appearance={dark ? "dark" : "light"}>
      <ConfigProvider
        button={{ autoInsertSpace: false }}
        locale={zhCN}
        theme={{
          algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm,
          token: {
            colorPrimary: dark ? "#a99bea" : "#242428",
            borderRadius: 10,
            fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          },
        }}
      >
        <App className={dark ? "chat-app dark" : "chat-app"}>
          <BrowserRouter basename="/apps/workspace">
            <WorkspaceApp dark={dark} onTheme={() => setDark((v) => !v)} />
          </BrowserRouter>
        </App>
      </ConfigProvider>
    </ThemeProvider>
  );
}
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
