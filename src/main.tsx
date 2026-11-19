import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "katex/dist/katex.min.css";
import "./app/styles/tokens.css";
import "./app/styles/global.css";
import "./app/styles/library.css";
import "./app/styles/workbench.css";
import "./app/styles/reader.css";
import App from "./app/App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
