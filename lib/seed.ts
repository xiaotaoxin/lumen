import { KEYS, storage } from "./storage";
import type { Generation, RegistrationApplication, Session, Subject, User } from "./types";
import { MODELS } from "./catalog";
import { mockImageDataUri, mockVideoPosterDataUri } from "./mock-assets";
import { hashPassword } from "./auth-helpers";

// Seed the local mock with a baseline admin + a few sample users +
// a couple weeks of synthesized generations so the analytics dashboard
// looks alive on first run.
export function seedIfNeeded() {
  if (typeof window === "undefined") return;
  if (storage.get(KEYS.seeded, false)) return;

  const now = Date.now();
  const adminPwd = hashPassword("admin1234");
  const userPwd = hashPassword("user1234");

  const users: User[] = [
    {
      id: "u_admin",
      username: "admin",
      passwordHash: adminPwd,
      role: "admin",
      status: "active",
      createdAt: new Date(now - 30 * 86400_000).toISOString(),
      approvedAt: new Date(now - 30 * 86400_000).toISOString(),
    },
    {
      id: "u_demo",
      username: "demo",
      passwordHash: userPwd,
      role: "user",
      status: "active",
      createdAt: new Date(now - 14 * 86400_000).toISOString(),
      approvedAt: new Date(now - 14 * 86400_000).toISOString(),
    },
    {
      id: "u_alice",
      username: "alice",
      passwordHash: userPwd,
      role: "user",
      status: "active",
      createdAt: new Date(now - 12 * 86400_000).toISOString(),
      approvedAt: new Date(now - 12 * 86400_000).toISOString(),
    },
    {
      id: "u_bryan",
      username: "bryan",
      passwordHash: userPwd,
      role: "user",
      status: "active",
      createdAt: new Date(now - 10 * 86400_000).toISOString(),
      approvedAt: new Date(now - 10 * 86400_000).toISOString(),
    },
    {
      id: "u_chloe",
      username: "chloe",
      passwordHash: userPwd,
      role: "user",
      status: "disabled",
      createdAt: new Date(now - 8 * 86400_000).toISOString(),
      approvedAt: new Date(now - 8 * 86400_000).toISOString(),
    },
  ];

  const applications: RegistrationApplication[] = [
    {
      id: "app_1",
      username: "newcomer",
      passwordHash: userPwd,
      submittedAt: new Date(now - 6 * 3600_000).toISOString(),
      status: "pending",
    },
    {
      id: "app_2",
      username: "studio_li",
      passwordHash: userPwd,
      submittedAt: new Date(now - 2 * 3600_000).toISOString(),
      status: "pending",
    },
    {
      id: "app_3",
      username: "wang_design",
      passwordHash: userPwd,
      submittedAt: new Date(now - 30 * 60_000).toISOString(),
      status: "pending",
    },
  ];

  // Synthesize 14 days of generations across users + models, grouped into
  // sessions (~2-4 generations per session) so the sidebar's 历史创作 list
  // looks lived-in.
  const generations: Generation[] = [];
  const sessions: Session[] = [];
  const userIds = ["u_demo", "u_alice", "u_bryan", "u_chloe"];
  const samplePrompts = [
    "夜色中的霓虹街道，雨后倒影",
    "深山古寺，晨雾未散",
    "宇航员漂浮在花海上空",
    "极简北欧客厅，落日斜照",
    "水墨竹林，鹤翔其中",
    "赛博朋克少女，半侧脸特写",
    "海面上漂浮的几何冰山",
    "复古胶片质感，老咖啡馆",
  ];

  let gid = 1;
  let sid = 1;
  // BUILT_IN_MODELS 现在为空（所有模型走 /admin/models 自定义配置），
  // 没法生成假 Generation 记录，跳过这部分 seed。
  for (let d = 13; d >= 0 && MODELS.length > 0; d--) {
    const dayBase = now - d * 86400_000;
    const callsToday = 12 + Math.floor(Math.random() * 28);
    let i = 0;
    while (i < callsToday) {
      // Open a session of 2..4 generations on the same kind for one user
      const model = MODELS[Math.floor(Math.random() * MODELS.length)];
      const userId = userIds[Math.floor(Math.random() * userIds.length)];
      const sessionLen = Math.min(callsToday - i, 2 + Math.floor(Math.random() * 3));
      const sessionId = `sess_${sid++}`;
      const sessionStart = dayBase + Math.floor(Math.random() * 86400_000);
      const titleSeed = samplePrompts[Math.floor(Math.random() * samplePrompts.length)];

      let lastUpdated = sessionStart;

      for (let k = 0; k < sessionLen; k++) {
        const prompt = k === 0
          ? titleSeed
          : samplePrompts[Math.floor(Math.random() * samplePrompts.length)];
        const created = sessionStart + k * (5 * 60_000 + Math.floor(Math.random() * 10 * 60_000));
        const failed = Math.random() < model.baseFailureRate;
        const latency = Math.floor(model.avgLatencyMs * (0.6 + Math.random() * 0.8));
        const completed = created + latency;
        const gen: Generation = {
          id: `g_${gid++}`,
          userId,
          sessionId,
          kind: model.kind,
          modelId: model.id,
          prompt,
          status: failed ? "failed" : "succeeded",
          createdAt: new Date(created).toISOString(),
          completedAt: new Date(completed).toISOString(),
          durationMs: latency,
          cost: failed ? 0 : model.costPerCall,
          errorMessage: failed ? "上游超时，请稍后再试" : undefined,
        };
        if (!failed) {
          if (model.kind === "image") {
            const batch = 1 + Math.floor(Math.random() * 3);
            gen.imageUrls = Array.from({ length: batch }, (_, kk) =>
              mockImageDataUri(prompt, kk),
            );
            gen.imageParams = {
              size: "1024x1024",
              batch: batch as 1 | 2 | 3,
              style: "general",
            };
          } else {
            gen.videoPosterUrl = mockVideoPosterDataUri(prompt);
            gen.videoUrl = "";
            gen.videoParams = {
              duration: 5,
              resolution: "720p",
              camera: "static",
            };
          }
        }
        generations.push(gen);
        lastUpdated = completed;
      }

      sessions.push({
        id: sessionId,
        userId,
        kind: model.kind,
        title: titleSeed.slice(0, 30),
        createdAt: new Date(sessionStart).toISOString(),
        updatedAt: new Date(lastUpdated).toISOString(),
      });

      i += sessionLen;
    }
  }

  // Demo subjects — seeded for `demo` so the @-mention picker isn't empty
  const subjects: Subject[] = [
    {
      id: "s_lina",
      userId: "u_demo",
      name: "Lina",
      description: "短发亚裔少女，淡灰色风衣，左眼下有一颗小痣，常出现在城市夜景中",
      imageUrl: mockImageDataUri("subject:lina", 0, 512, 512),
      tags: ["角色", "原创"],
      createdAt: new Date(now - 5 * 86400_000).toISOString(),
      updatedAt: new Date(now - 5 * 86400_000).toISOString(),
    },
    {
      id: "s_kai",
      userId: "u_demo",
      name: "Kai",
      description: "灰白色机械义肢的少年，深色帽衫，眼神冷静，赛博朋克风",
      imageUrl: mockImageDataUri("subject:kai", 0, 512, 512),
      tags: ["角色", "原创"],
      createdAt: new Date(now - 4 * 86400_000).toISOString(),
      updatedAt: new Date(now - 4 * 86400_000).toISOString(),
    },
    {
      id: "s_studio",
      userId: "u_demo",
      name: "工作室",
      description: "极简北欧风工作室，落地窗、混凝土墙、暖光台灯、木地板",
      imageUrl: mockImageDataUri("subject:studio", 0, 512, 512),
      tags: ["场景"],
      createdAt: new Date(now - 3 * 86400_000).toISOString(),
      updatedAt: new Date(now - 3 * 86400_000).toISOString(),
    },
    {
      id: "s_rain_tokyo",
      userId: "u_demo",
      name: "雨夜东京",
      description: "霓虹倒映在湿漉漉的柏油路上，35mm 胶片质感，色调偏青蓝",
      imageUrl: mockImageDataUri("subject:rain_tokyo", 0, 512, 512),
      tags: ["场景", "氛围"],
      createdAt: new Date(now - 2 * 86400_000).toISOString(),
      updatedAt: new Date(now - 2 * 86400_000).toISOString(),
    },
  ];

  storage.set(KEYS.users, users);
  storage.set(KEYS.applications, applications);
  storage.set(KEYS.generations, generations);
  storage.set(KEYS.sessions, sessions);
  storage.set(KEYS.subjects, subjects);
  storage.set(KEYS.seeded, true);
}
