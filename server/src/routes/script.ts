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

// POST /api/script/analyze — analyze script text via LLM (falls back to mock)
script.post("/analyze", async (c) => {
  const config = resolveLlmConfig();
  const { text } = await c.req.json().catch(() => ({}));
  if (!text || text.trim().length < 20) {
    return c.json({ code: "TOO_SHORT", message: "剧本太短，至少 20 个字符" }, 400);
  }

  // Mock mode — returns demo analysis. Enable real LLM when API key is active.
  return c.json(getMockAnalysis());
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
    const analysisData = JSON.stringify({ characters, scenes, props });
    db.prepare("INSERT INTO storyboards (id, user_id, title, analysis_data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(sbId, userId, title || "剧本分镜", analysisData, now(), now());

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

function getMockAnalysis() {
  return {
    title: "月光下的约定",
    characters: [
      { name: "小夜", description: "年轻女性，黑色长发泛银光，紫色眼眸，身穿深蓝色斗篷，气质冷峻神秘", tags: ["角色", "主角"] },
      { name: "守护者", description: "高大男性，银白短发凌乱，暗红长袍，右眼有旧伤疤，神情沧桑", tags: ["角色", "配角"] },
    ],
    scenes: [
      { name: "钟楼长廊", description: "古老石质长廊，月光透过彩色玻璃窗洒入，光影斑驳，氛围幽静神秘", timeOfDay: "夜晚", tags: ["场景"] },
    ],
    props: [
      { name: "白银匕首", description: "刻满符文的银色匕首，泛着冷光，手柄镶嵌暗色宝石", tags: ["物品"] },
      { name: "月长石", description: "发光的乳白色宝石，内部有流光转动，散发着柔和的光芒", tags: ["物品"] },
    ],
    shots: [
      { sceneName: "钟楼长廊", shotSize: "全景", cameraAngle: "仰视", cameraMovement: "慢推", dialogue: "", speaker: "", description: "月光透过彩色玻璃窗洒在石板地面上，古老的钟楼内部，高大的石柱和拱门，氛围神秘庄严" },
      { sceneName: "钟楼长廊", shotSize: "中景", cameraAngle: "平视", cameraMovement: "跟拍", dialogue: "", speaker: "", description: "小夜裹紧深蓝色斗篷，悄无声息地穿过长廊。她的黑发在月光下泛着银光，紫色眼眸警惕地扫视四周" },
      { sceneName: "钟楼长廊", shotSize: "近景", cameraAngle: "平视", cameraMovement: "固定", dialogue: "", speaker: "", description: "小夜的手紧握白银匕首，匕首上刻满符文，在月光下泛着冷光" },
      { sceneName: "钟楼长廊", shotSize: "中景", cameraAngle: "平视", cameraMovement: "固定", dialogue: "你终于来了", speaker: "守护者", description: "守护者从石柱后走出，暗红长袍轻摆，银白短发垂在额前，右眼旧伤疤在月光下清晰可见" },
      { sceneName: "钟楼长廊", shotSize: "近景", cameraAngle: "平视", cameraMovement: "固定", dialogue: "把钥匙交出来。我知道是你偷走的。", speaker: "小夜", description: "小夜举起匕首指向守护者，紫色眼眸直视对方，表情冷峻坚定" },
      { sceneName: "钟楼长廊", shotSize: "特写", cameraAngle: "平视", cameraMovement: "固定", dialogue: "你在找这个？可惜，我不能给你。", speaker: "守护者", description: "守护者手中托着发光的月长石，宝石内部流光转动，照亮他的手掌和半边脸" },
    ],
  };
}

export default script;
