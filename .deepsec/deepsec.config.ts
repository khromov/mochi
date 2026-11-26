import { defineConfig } from "deepsec/config";
import { generatedMatchersPlugin } from "./generated-matchers.js";

export default defineConfig({
  defaultThinkingLevel: "xhigh", // <deepsec:default-thinking-level>
  defaultModel: "claude-opus-5", // <deepsec:default-model>
  defaultAgent: "claude-agent-sdk", // <deepsec:default-agent>
  ai: {"mode":"local","provider":"local"}, // <deepsec:model-route>
  projects: [
    { id: "mochi", root: ".." },
    // <deepsec:projects-insert-above>
  ],
  plugins: [generatedMatchersPlugin],
});
