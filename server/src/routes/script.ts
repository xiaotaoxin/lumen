import { Hono } from "hono";
import { auth } from "../middleware/auth";
import type { AuthVariables } from "../middleware/auth";
import { resolveLlmConfig, chat } from "../services/llm";
import { getSqlite } from "../db/connection";
import { randomBytes } from "node:crypto";

const script = new Hono<{ Variables: AuthVariables }>();
script.use("*", auth);

function shortId(prefix: string) { return prefix + randomBytes(8).toString("hex"); }
function now() { return new Date().toISOString(); }

const ANALYSIS_PROMPT = `You are a professional script analyst for film/animation production. Given a story script, extract structured data for pre-production.

Output valid JSON only. No markdown, no explanation. The JSON must have this exact structure:

{
  "title": "故事标题",
  "characters": [
    { "name": "角色名", "description": "外貌、服饰、年龄、气质等视觉特征的中文描述，50-100字", "tags": ["角色", "主角/配角"] }
  ],
  "scenes": [
    { "name": "场景名", "description": "环境、光线、氛围等视觉特征的中文描述，30-60字", "timeOfDay": "白天/夜晚/黄昏", "tags": ["场景"] }
  ],
  "props": [
    { "name": "道具名", "description": "外观、材质、用途的中文描述，20-40字", "tags": ["物品"] }
  ],
  "shots": [
    {
      "sceneName": "对应的场景名（必须是上面 scenes 里出现过的名字）",
      "shotSize": "远景/全景/中景/近景/特写",
      "cameraAngle": "平视/俯视/仰视",
      "cameraMovement": "固定/慢推/横移/跟拍",
      "dialogue": "台词内容，没有则为空字符串",
      "speaker": "说话角色名，没有则为空字符串",
      "description": "镜头画面描述的中文提示词，含角色动作、表情、构图、氛围，80-150字"
    }
  ]
}

Rules:
- Character names should NOT contain spaces (use Chinese/English single words like "小明", "Alice")
- Extract ALL characters who appear or are mentioned, no matter how minor
- Extract ALL distinct locations/scenes
- Shots should cover the ENTIRE story in sequence, 3-15 shots depending on story length
- Each shot description must be detailed enough for AI image generation
- Scene/time/character descriptions should focus on VISUAL elements useful for image generation`;

// POST /api/script/analyze — analyze script text via LLM
script.post("/analyze", async (c) => {
  const config = resolveLlmConfig();
  if (!config) {
    return c.json({ code: "NO_LLM", message: "未配置 LLM，请在 .env 中设置 LLM_API_KEY" }, 400);
  }

  const { text } = await c.req.json().catch(() => ({}));
  if (!text || text.trim().length < 20) {
    return c.json({ code: "TOO_SHORT", message: "剧本太短，至少 20 个字符" }, 400);
  }

  try {
    const result = await chat(
      [{ role: "system", content: ANALYSIS_PROMPT }, { role: "user", content: text.trim() }],
      config,
    );

    // Try to parse the JSON from the LLM response
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return c.json({ code: "PARSE_FAILED", message: "LLM 返回格式异常，请重试", raw: result.slice(0, 300) }, 500);
    }

    const analysis = JSON.parse(jsonMatch[0]);
    return c.json({
      title: analysis.title || "未命名故事",
      characters: analysis.characters || [],
      scenes: analysis.scenes || [],
      props: analysis.props || [],
      shots: analysis.shots || [],
    });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes("JSON")) {
      return c.json({ code: "PARSE_FAILED", message: "解析结果失败，请尝试缩短剧本或重试" }, 500);
    }
    return c.json({ code: "LLM_FAILED", message: msg }, 500);
  }
});

// POST /api/script/apply — create subjects + storyboard from analysis
script.post("/apply", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json().catch(() => ({}));
  const { title, characters, scenes, props, shots } = body;

  if (!characters?.length && !shots?.length) {
    return c.json({ code: "EMPTY", message: "没有可创建的内容" }, 400);
  }

  const db = getSqlite();
  const created: Record<string, string[]> = { subjects: [], storyboardFrames: [] };

  // 1. Create subjects from characters + scenes + props
  for (const ch of (characters || [])) {
    const exists = db.prepare("SELECT id FROM subjects WHERE user_id = ? AND LOWER(name) = LOWER(?)").get(userId, ch.name);
    if (exists) continue;
    const id = shortId("sub_");
    db.prepare("INSERT INTO subjects (id, user_id, name, description, tags, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(id, userId, ch.name, ch.description || "", JSON.stringify(ch.tags || ["角色"]), now(), now());
    created.subjects.push(id);
  }
  for (const sc of (scenes || [])) {
    const exists = db.prepare("SELECT id FROM subjects WHERE user_id = ? AND LOWER(name) = LOWER(?)").get(userId, sc.name);
    if (exists) continue;
    const id = shortId("sub_");
    db.prepare("INSERT INTO subjects (id, user_id, name, description, tags, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(id, userId, sc.name, sc.description || "", JSON.stringify(["场景", ...(sc.tags || [])]), now(), now());
    created.subjects.push(id);
  }
  for (const pr of (props || [])) {
    const exists = db.prepare("SELECT id FROM subjects WHERE user_id = ? AND LOWER(name) = LOWER(?)").get(userId, pr.name);
    if (exists) continue;
    const id = shortId("sub_");
    db.prepare("INSERT INTO subjects (id, user_id, name, description, tags, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(id, userId, pr.name, pr.description || "", JSON.stringify(["物品", ...(pr.tags || [])]), now(), now());
    created.subjects.push(id);
  }

  // 2. Create storyboard from shots
  if (shots?.length) {
    const sbId = shortId("sb_");
    db.prepare("INSERT INTO storyboards (id, user_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .run(sbId, userId, title || "剧本分镜", now(), now());

    shots.forEach((shot: Record<string, string>, i: number) => {
      const fId = shortId("sf_");
      const prompt = [shot.description || "", `${shot.shotSize || "中景"}·${shot.cameraAngle || "平视"}·${shot.cameraMovement || "固定"}`].filter(Boolean).join("，");
      db.prepare(
        "INSERT INTO storyboard_frames (id, storyboard_id, order_index, shot_description, shot_size, camera_angle, camera_movement, dialogue, speaker, image_prompt, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'idle', ?, ?)"
      ).run(fId, sbId, i, shot.description || "", shot.shotSize || "中景", shot.cameraAngle || "平视", shot.cameraMovement || "固定", shot.dialogue || "", shot.speaker || "", prompt, now(), now());
      created.storyboardFrames.push(fId);
    });
    created["storyboardId"] = [sbId];
  }

  return c.json(created);
});

export default script;
