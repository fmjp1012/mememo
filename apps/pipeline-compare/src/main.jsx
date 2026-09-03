import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import PipelineCompareApp from "./PipelineCompareApp.jsx";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <PipelineCompareApp />
  </StrictMode>,
);
