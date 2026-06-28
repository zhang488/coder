import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

// 预加载终端字体（含粗体），确保终端首帧即以正确字体测量与渲染
document.fonts?.load?.('14px "Caskaydia Cove Nerd Font Mono"').catch(() => {});
document.fonts?.load?.('bold 14px "Caskaydia Cove Nerd Font Mono"').catch(() => {});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
