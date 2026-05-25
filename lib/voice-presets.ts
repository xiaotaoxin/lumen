/**
 * CosyVoice 完整预设音色（86 个，cosyvoice-v3-flash 模型）。
 *
 * 数据来源：阿里百炼 cosyvoice-voice-list 文档（2026-05 抓取）。
 *   https://help.aliyun.com/zh/model-studio/cosyvoice-voice-list
 *
 * 按场景分组：陪伴 / 童声 / 主播 / 客服 / 助手 / 直播 / 有声书 / 短视频 / 方言 / 国际
 * 全部跟 cosyvoice-v3-flash 兼容；混搭 v3-plus 时仅 longanyang / longanhuan 可用。
 */

import type { ModelKind } from "./types";

/**
 * 简单语种代码：
 *   zh = 普通话 · yue = 粤语 · en = 美音 · en-uk = 英音 · ja = 日语 · ko = 韩语
 *   id = 印尼语 · ne = 东北话 · sx = 陕西话 · mn = 闽南话
 */
export type VoiceLang =
  | "zh" | "yue" | "en" | "en-uk" | "ja" | "ko" | "id"
  | "ne" | "sx" | "mn";

export const LANG_LABEL: Record<VoiceLang, string> = {
  zh: "中文",
  yue: "粤语",
  en: "美音",
  "en-uk": "英音",
  ja: "日语",
  ko: "韩语",
  id: "印尼",
  ne: "东北",
  sx: "陕西",
  mn: "闽南",
};

export interface VoicePreset {
  id: string;
  name: string;
  desc: string;
  model: string;
  gender: "male" | "female" | "neutral";
  lang: VoiceLang;
  tags: string[];
}

const FLASH = "cosyvoice-v3-flash";

export const COSYVOICE_PRESETS: VoicePreset[] = [
  // ── 主推（全场景） ──
  { id: "longanyang", name: "龙安洋", desc: "阳光暖男 · 推荐", model: FLASH, gender: "male", lang: "zh", tags: ["陪伴", "全场景", "推荐"] },
  { id: "longanhuan", name: "龙安欢", desc: "甜美女声 · 推荐", model: FLASH, gender: "female", lang: "zh", tags: ["陪伴", "全场景", "推荐"] },

  // ── 童声 / 玩具 ──
  { id: "longhuhu_v3", name: "龙呼呼", desc: "天真小女孩", model: FLASH, gender: "female", lang: "zh", tags: ["童声"] },
  { id: "longpaopao_v3", name: "龙泡泡", desc: "活泼调皮", model: FLASH, gender: "neutral", lang: "zh", tags: ["童声", "活泼"] },
  { id: "longjielidou_v3", name: "龙杰力豆", desc: "玩具男孩声", model: FLASH, gender: "male", lang: "zh", tags: ["童声", "玩具"] },
  { id: "longxian_v3", name: "龙仙", desc: "灵动小女孩", model: FLASH, gender: "female", lang: "zh", tags: ["童声", "玩具"] },
  { id: "longling_v3", name: "龙铃", desc: "清脆童声", model: FLASH, gender: "female", lang: "zh", tags: ["童声"] },

  // ── 社交陪伴 ──
  { id: "longantai_v3", name: "龙安台", desc: "知性陪伴女声", model: FLASH, gender: "female", lang: "zh", tags: ["陪伴"] },
  { id: "longhua_v3", name: "龙华", desc: "温婉女声", model: FLASH, gender: "female", lang: "zh", tags: ["陪伴"] },
  { id: "longcheng_v3", name: "龙橙", desc: "温暖男声", model: FLASH, gender: "male", lang: "zh", tags: ["陪伴"] },
  { id: "longze_v3", name: "龙泽", desc: "成熟男声", model: FLASH, gender: "male", lang: "zh", tags: ["陪伴"] },
  { id: "longzhe_v3", name: "龙哲", desc: "理性男声", model: FLASH, gender: "male", lang: "zh", tags: ["陪伴"] },
  { id: "longyan_v3", name: "龙颜", desc: "知性女声", model: FLASH, gender: "female", lang: "zh", tags: ["陪伴"] },
  { id: "longxing_v3", name: "龙星", desc: "明朗女声", model: FLASH, gender: "female", lang: "zh", tags: ["陪伴"] },
  { id: "longtian_v3", name: "龙天", desc: "正气男声", model: FLASH, gender: "male", lang: "zh", tags: ["陪伴"] },
  { id: "longwan_v3", name: "龙婉", desc: "温婉细腻", model: FLASH, gender: "female", lang: "zh", tags: ["陪伴"] },
  { id: "longqiang_v3", name: "龙嫱", desc: "古风女声", model: FLASH, gender: "female", lang: "zh", tags: ["陪伴", "古风"] },
  { id: "longfeifei_v3", name: "龙菲菲", desc: "活力女声", model: FLASH, gender: "female", lang: "zh", tags: ["陪伴"] },
  { id: "longhao_v3", name: "龙浩", desc: "干练男声", model: FLASH, gender: "male", lang: "zh", tags: ["陪伴"] },
  { id: "longanrou_v3", name: "龙安柔", desc: "柔和女声", model: FLASH, gender: "female", lang: "zh", tags: ["陪伴"] },
  { id: "longhan_v3", name: "龙寒", desc: "冷峻男声", model: FLASH, gender: "male", lang: "zh", tags: ["陪伴"] },
  { id: "longanzhi_v3", name: "龙安智", desc: "睿智男声", model: FLASH, gender: "male", lang: "zh", tags: ["陪伴"] },
  { id: "longanling_v3", name: "龙安灵", desc: "空灵女声", model: FLASH, gender: "female", lang: "zh", tags: ["陪伴"] },
  { id: "longanya_v3", name: "龙安雅", desc: "优雅女声", model: FLASH, gender: "female", lang: "zh", tags: ["陪伴"] },
  { id: "longanqin_v3", name: "龙安亲", desc: "亲切女声", model: FLASH, gender: "female", lang: "zh", tags: ["陪伴"] },

  // ── 客服 / 销售 ──
  { id: "longyingxun_v3", name: "龙应询", desc: "客服男声 · 干练", model: FLASH, gender: "male", lang: "zh", tags: ["客服"] },
  { id: "longyingjing_v3", name: "龙应静", desc: "客服女声 · 沉稳", model: FLASH, gender: "female", lang: "zh", tags: ["客服"] },
  { id: "longyingling_v3", name: "龙应聆", desc: "客服女声 · 耐心", model: FLASH, gender: "female", lang: "zh", tags: ["客服"] },
  { id: "longyingtao_v3", name: "龙应桃", desc: "客服女声 · 温和", model: FLASH, gender: "female", lang: "zh", tags: ["客服"] },
  { id: "longyingxiao_v3", name: "龙应笑", desc: "电话销售 · 热情", model: FLASH, gender: "female", lang: "zh", tags: ["销售"] },

  // ── 语音助手 ──
  { id: "longxiaochun_v3", name: "龙小淳", desc: "语音助手 · 标准女声", model: FLASH, gender: "female", lang: "zh", tags: ["助手"] },
  { id: "longxiaoxia_v3", name: "龙小夏", desc: "语音助手 · 清新", model: FLASH, gender: "female", lang: "zh", tags: ["助手"] },
  { id: "longyumi_v3", name: "YUMI", desc: "语音助手 · 灵动", model: FLASH, gender: "female", lang: "zh", tags: ["助手"] },
  { id: "longanyun_v3", name: "龙安昀", desc: "语音助手 · 沉稳男声", model: FLASH, gender: "male", lang: "zh", tags: ["助手"] },
  { id: "longanwen_v3", name: "龙安温", desc: "语音助手 · 温润女声", model: FLASH, gender: "female", lang: "zh", tags: ["助手"] },
  { id: "longanli_v3", name: "龙安莉", desc: "语音助手 · 通透女声", model: FLASH, gender: "female", lang: "zh", tags: ["助手"] },
  { id: "longanlang_v3", name: "龙安朗", desc: "语音助手 · 朗朗男声", model: FLASH, gender: "male", lang: "zh", tags: ["助手"] },
  { id: "longyingmu_v3", name: "龙应沐", desc: "语音助手 · 温柔", model: FLASH, gender: "female", lang: "zh", tags: ["助手"] },

  // ── 新闻 / 播报 ──
  { id: "longshuo_v3", name: "龙硕", desc: "新闻播报 · 醇厚男声", model: FLASH, gender: "male", lang: "zh", tags: ["新闻"] },
  { id: "longshu_v3", name: "龙书", desc: "新闻播报 · 沉稳", model: FLASH, gender: "male", lang: "zh", tags: ["新闻"] },
  { id: "loongbella_v3", name: "Bella3.0", desc: "新闻播报 · 国际", model: FLASH, gender: "female", lang: "zh", tags: ["新闻", "双语"] },

  // ── 直播带货 ──
  { id: "longanran_v3", name: "龙安燃", desc: "直播带货 · 激情女声", model: FLASH, gender: "female", lang: "zh", tags: ["带货", "直播"] },
  { id: "longanxuan_v3", name: "龙安宣", desc: "直播带货 · 高亢女声", model: FLASH, gender: "female", lang: "zh", tags: ["带货", "直播"] },

  // ── 短视频配音 ──
  { id: "longjiqi_v3", name: "龙机器", desc: "AI 机器人音", model: FLASH, gender: "neutral", lang: "zh", tags: ["短视频", "机器人"] },
  { id: "longhouge_v3", name: "龙猴哥", desc: "猴哥风趣", model: FLASH, gender: "male", lang: "zh", tags: ["短视频", "搞笑"] },
  { id: "longdaiyu_v3", name: "龙黛玉", desc: "古风林黛玉", model: FLASH, gender: "female", lang: "zh", tags: ["短视频", "古风"] },

  // ── 朗诵 ──
  { id: "longfei_v3", name: "龙飞", desc: "诗词朗诵 · 男声", model: FLASH, gender: "male", lang: "zh", tags: ["朗诵"] },

  // ── 有声书 ──
  { id: "longshanshan_v3", name: "龙闪闪", desc: "有声书 · 灵动女声", model: FLASH, gender: "female", lang: "zh", tags: ["有声书"] },
  { id: "longniuniu_v3", name: "龙牛牛", desc: "有声书 · 浑厚男声", model: FLASH, gender: "male", lang: "zh", tags: ["有声书"] },
  { id: "longmiao_v3", name: "龙妙", desc: "有声书 · 妙音女声", model: FLASH, gender: "female", lang: "zh", tags: ["有声书"] },
  { id: "longsanshu_v3", name: "龙三叔", desc: "有声书 · 沧桑男声", model: FLASH, gender: "male", lang: "zh", tags: ["有声书"] },
  { id: "longyuan_v3", name: "龙媛", desc: "有声书 · 温柔女声", model: FLASH, gender: "female", lang: "zh", tags: ["有声书"] },
  { id: "longyue_v3", name: "龙悦", desc: "有声书 · 喜悦女声", model: FLASH, gender: "female", lang: "zh", tags: ["有声书"] },
  { id: "longxiu_v3", name: "龙修", desc: "有声书 · 古风男声", model: FLASH, gender: "male", lang: "zh", tags: ["有声书", "古风"] },
  { id: "longnan_v3", name: "龙楠", desc: "有声书 · 沉稳男声", model: FLASH, gender: "male", lang: "zh", tags: ["有声书"] },
  { id: "longwanjun_v3", name: "龙婉君", desc: "有声书 · 端庄女声", model: FLASH, gender: "female", lang: "zh", tags: ["有声书"] },
  { id: "longyichen_v3", name: "龙逸尘", desc: "有声书 · 仙气男声", model: FLASH, gender: "male", lang: "zh", tags: ["有声书", "古风"] },
  { id: "longlaobo_v3", name: "龙老伯", desc: "有声书 · 老伯", model: FLASH, gender: "male", lang: "zh", tags: ["有声书", "老人"] },
  { id: "longlaoyi_v3", name: "龙老姨", desc: "有声书 · 老阿姨", model: FLASH, gender: "female", lang: "zh", tags: ["有声书", "老人"] },

  // ── 方言 ──
  { id: "longjiaxin_v3", name: "龙嘉欣", desc: "粤语女声 · 港风", model: FLASH, gender: "female", lang: "yue", tags: ["方言"] },
  { id: "longjiayi_v3", name: "龙嘉怡", desc: "粤语女声 · 知性", model: FLASH, gender: "female", lang: "yue", tags: ["方言"] },
  { id: "longanyue_v3", name: "龙安粤", desc: "粤语男声", model: FLASH, gender: "male", lang: "yue", tags: ["方言"] },
  { id: "longlaotie_v3", name: "龙老铁", desc: "东北话 · 豪爽", model: FLASH, gender: "male", lang: "ne", tags: ["方言", "搞笑"] },
  { id: "longshange_v3", name: "龙陕哥", desc: "陕西话 · 男声", model: FLASH, gender: "male", lang: "sx", tags: ["方言"] },
  { id: "longanmin_v3", name: "龙安闽", desc: "闽南话 · 女声", model: FLASH, gender: "female", lang: "mn", tags: ["方言"] },

  // ── 美式英语 ──
  { id: "loongabby_v3", name: "Abby", desc: "American female", model: FLASH, gender: "female", lang: "en", tags: ["国际"] },
  { id: "loongandy_v3", name: "Andy", desc: "American male", model: FLASH, gender: "male", lang: "en", tags: ["国际"] },
  { id: "loongannie_v3", name: "Annie", desc: "American female", model: FLASH, gender: "female", lang: "en", tags: ["国际"] },
  { id: "loongava_v3", name: "Ava", desc: "American female", model: FLASH, gender: "female", lang: "en", tags: ["国际"] },
  { id: "loongbeth_v3", name: "Beth", desc: "American female", model: FLASH, gender: "female", lang: "en", tags: ["国际"] },
  { id: "loongbetty_v3", name: "Betty", desc: "American female", model: FLASH, gender: "female", lang: "en", tags: ["国际"] },
  { id: "loongcally_v3", name: "Cally", desc: "American female", model: FLASH, gender: "female", lang: "en", tags: ["国际"] },
  { id: "loongcindy_v3", name: "Cindy", desc: "American female", model: FLASH, gender: "female", lang: "en", tags: ["国际"] },
  { id: "loongdavid_v3", name: "David", desc: "American male", model: FLASH, gender: "male", lang: "en", tags: ["国际"] },
  { id: "loongdonna_v3", name: "Donna", desc: "American female", model: FLASH, gender: "female", lang: "en", tags: ["国际"] },

  // ── 英式英语 ──
  { id: "loongemily_v3", name: "Emily", desc: "British female", model: FLASH, gender: "female", lang: "en-uk", tags: ["国际"] },
  { id: "loongeric_v3", name: "Eric", desc: "British male", model: FLASH, gender: "male", lang: "en-uk", tags: ["国际"] },
  { id: "loongluna_v3", name: "Luna", desc: "British female", model: FLASH, gender: "female", lang: "en-uk", tags: ["国际"] },
  { id: "loongluca_v3", name: "Luca", desc: "British male", model: FLASH, gender: "male", lang: "en-uk", tags: ["国际"] },

  // ── 日语 ──
  { id: "loongriko_v3", name: "Riko", desc: "Japanese female", model: FLASH, gender: "female", lang: "ja", tags: ["国际"] },
  { id: "loongtomoka_v3", name: "Tomoka", desc: "Japanese female", model: FLASH, gender: "female", lang: "ja", tags: ["国际"] },
  { id: "loongtomoya_v3", name: "Tomoya", desc: "Japanese male", model: FLASH, gender: "male", lang: "ja", tags: ["国际"] },
  { id: "loongyuuna_v3", name: "Yuuna", desc: "Japanese female", model: FLASH, gender: "female", lang: "ja", tags: ["国际"] },
  { id: "loongyuuma_v3", name: "Yuuma", desc: "Japanese male", model: FLASH, gender: "male", lang: "ja", tags: ["国际"] },

  // ── 韩语 ──
  { id: "loongkyong_v3", name: "Kyong", desc: "Korean female", model: FLASH, gender: "female", lang: "ko", tags: ["国际"] },
  { id: "loongjihun_v3", name: "Jihun", desc: "Korean male", model: FLASH, gender: "male", lang: "ko", tags: ["国际"] },

  // ── 印尼语 ──
  { id: "loongindah_v3", name: "Indah", desc: "Indonesian female", model: FLASH, gender: "female", lang: "id", tags: ["国际"] },
];

export const COSYVOICE_MODELS: Array<{ id: string; label: string; recommended?: boolean }> = [
  { id: "cosyvoice-v3.5-plus",  label: "v3.5-plus — 旗舰" },
  { id: "cosyvoice-v3.5-flash", label: "v3.5-flash — 快速" },
  { id: "cosyvoice-v3-plus",    label: "v3-plus — 仅 longanyang/longanhuan" },
  { id: "cosyvoice-v3-flash",   label: "v3-flash — 全 86 音色 ⭐", recommended: true },
  { id: "cosyvoice-v2",         label: "v2 — 老版（兼容旧 voice id）" },
];

export function modelForVoice(voiceId: string): string {
  const preset = COSYVOICE_PRESETS.find((v) => v.id === voiceId);
  return preset?.model ?? "cosyvoice-v3-flash";
}

export const COSYVOICE_KIND: ModelKind = "video";

/** 用于侧栏过滤 chip 的常用语种分类 */
export const VOICE_LANG_CHIPS: Array<{ value: string; label: string; matches: VoiceLang[] }> = [
  { value: "",        label: "全部",  matches: [] },
  { value: "zh",      label: "中文",  matches: ["zh"] },
  { value: "yue",     label: "粤语",  matches: ["yue"] },
  { value: "en",      label: "英语",  matches: ["en", "en-uk"] },
  { value: "ja",      label: "日语",  matches: ["ja"] },
  { value: "ko",      label: "韩语",  matches: ["ko"] },
  { value: "id",      label: "印尼",  matches: ["id"] },
  { value: "dialect", label: "方言",  matches: ["ne", "sx", "mn"] },
];
