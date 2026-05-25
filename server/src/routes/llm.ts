import { Hono } from "hono";
import { auth } from "../middleware/auth";
import type { AuthVariables } from "../middleware/auth";
import { polishPrompt, resolveLlmConfig } from "../services/llm";

const llm = new Hono<{ Variables: AuthVariables }>();
llm.use("*", auth);

// POST /api/llm/polish — polish a user prompt into optimized English
llm.post("/polish", async (c) => {
  const config = resolveLlmConfig();
  if (!config) {
    return c.json({
      code: "NO_LLM_CONFIG",
      message: "未配置 LLM。请在 .env 中设置 LLM_API_KEY 或在管理页配置百炼 API Key。同时支持 OpenAI 兼容接口（设置 LLM_PROVIDER=openai LLM_API_KEY=sk-xxx LLM_BASE_URL=https://api.openai.com/v1）。",
    }, 400);
  }

  const body = await c.req.json().catch(() => ({}));
  const { prompt, kind } = body;
  if (!prompt || !prompt.trim()) {
    return c.json({ code: "INVALID_INPUT", message: "请输入提示词" }, 400);
  }

  try {
    const result = await polishPrompt(prompt.trim(), kind === "video" ? "video" : "image", config);
    return c.json(result);
  } catch (err) {
    console.error("[llm] polish failed:", (err as Error).message);
    return c.json({
      code: "POLISH_FAILED",
      message: `润色失败：${(err as Error).message}`,
    }, 500);
  }
});

export default llm;
