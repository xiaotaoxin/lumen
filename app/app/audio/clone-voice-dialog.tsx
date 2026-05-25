"use client";

/**
 * 声纹复刻对话框 —— CosyVoice voice-enrollment REST API。
 *
 * 阿里云 voice-enrollment 接口要"公网可达"的 wav URL（5-30 秒人声），不接受 base64 / data URL。
 * 所以这里让用户先粘贴一个公网 URL（比如自己上传到 COS / 七牛 / 任何 OSS 拿到的链接），
 * 后端调阿里 API 拿到 voice_id，存到 lumen.db `cloned_voices` 表里。
 *
 * 后续等接入 COS 上传管线时，可以加上"直接选本地文件 → 自动上传 → 自动调阿里"的一站式流程。
 */

import * as React from "react";
import { Loader2, UserPlus, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

const TARGET_MODELS = [
  { value: "cosyvoice-v3.5-flash", label: "v3.5-flash — 推荐（速度快）" },
  { value: "cosyvoice-v3.5-plus",  label: "v3.5-plus — 旗舰" },
  { value: "cosyvoice-v3-flash",   label: "v3-flash" },
  { value: "cosyvoice-v3-plus",    label: "v3-plus" },
];

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

export function CloneVoiceDialog({ open, onClose, onCreated }: Props) {
  const [name, setName] = React.useState("");
  const [audioUrl, setAudioUrl] = React.useState("");
  const [targetModel, setTargetModel] = React.useState("cosyvoice-v3.5-flash");
  const [language, setLanguage] = React.useState("zh");
  const [busy, setBusy] = React.useState(false);

  const reset = () => {
    setName("");
    setAudioUrl("");
    setTargetModel("cosyvoice-v3.5-flash");
    setLanguage("zh");
  };

  const onSubmit = async () => {
    if (!name.trim()) { toast.error("请填一个音色名称"); return; }
    if (!audioUrl.trim()) { toast.error("请填参考音频公网 URL"); return; }
    if (!/^https?:\/\//.test(audioUrl)) {
      toast.error("URL 必须以 http(s):// 开头，且公网可达");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/voice/clones", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          audioUrl: audioUrl.trim(),
          targetModel,
          languageHints: [language],
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `创建失败 (${res.status})`);
      }
      toast.success(`音色「${name}」复刻成功`);
      reset();
      onCreated();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "复刻失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { reset(); onClose(); } }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            <span className="inline-flex items-center gap-2">
              <UserPlus className="size-4" /> 新建复刻音色
            </span>
          </DialogTitle>
          <DialogDescription>
            上传 5-30 秒清晰人声（建议 16kHz 单声道 wav）到任意公网存储，把 URL 粘贴下面。
            阿里云会从这段录音学习音色特征，生成 voice_id 永久绑定到你的账号。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 p-1">
          <div>
            <Label className="text-xs">音色名称 <span className="text-destructive">*</span></Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：老王 / 我的男声 / 项目主播"
              className="mt-1 text-sm"
              maxLength={32}
            />
          </div>

          <div>
            <Label className="text-xs">参考音频 公网 URL <span className="text-destructive">*</span></Label>
            <Input
              value={audioUrl}
              onChange={(e) => setAudioUrl(e.target.value)}
              placeholder="https://xxx.cos.ap-shanghai.myqcloud.com/voice.wav"
              className="mt-1 font-mono text-xs"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              暂不支持本地文件直传 — 需要先上传到 COS / 七牛 / 任意公网 OSS 拿到 https URL。
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">目标模型</Label>
              <Select value={targetModel} onValueChange={setTargetModel}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TARGET_MODELS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="mt-1 text-[10px] text-muted-foreground">
                复刻完成后该音色只能搭配此模型使用
              </p>
            </div>
            <div>
              <Label className="text-xs">主要语种</Label>
              <Select value={language} onValueChange={setLanguage}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="zh">中文</SelectItem>
                  <SelectItem value="en">英文</SelectItem>
                  <SelectItem value="ja">日文</SelectItem>
                  <SelectItem value="ko">韩文</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="rounded-lg border border-border bg-secondary/30 p-3 text-[11px] text-muted-foreground">
            <div className="mb-1 flex items-center gap-1 text-foreground">
              <ExternalLink className="size-3" /> 推荐录音规格
            </div>
            <ul className="list-disc list-outside ps-4 space-y-0.5">
              <li>时长：5-30 秒</li>
              <li>格式：wav · 16kHz · 单声道（PCM）</li>
              <li>内容：自然朗读一段话，避免歌唱 / 喊叫</li>
              <li>环境：安静无回声、无背景音乐</li>
            </ul>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>取消</Button>
          <Button variant="brand" onClick={onSubmit} disabled={busy || !name.trim() || !audioUrl.trim()}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            提交复刻
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
