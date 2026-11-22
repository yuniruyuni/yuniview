import React from "react";
import ReactDOM from "react-dom/client";
import { trackDailyUse } from "./daily-usage";
import "./i18n";
import { App } from "./App";

const root = document.getElementById("root");
if (root) {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

trackDailyUse();
