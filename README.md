# AI 面试陪练（语音互动 MVP）

## 功能
- 选择岗位（内置 8 个）与面试官类型（HR/用人经理/高管）
- 自动生成 3-5 个面试问题
- 语音输入（浏览器 Web Speech API）+ 可选 AI 语音播报（浏览器 TTS）
- 每次回答后：追问/点评，并根据表现动态调整（followup vs next question）

## 部署到 Vercel
1. 推送到 GitHub
2. Vercel 导入仓库
3. 设置环境变量：
   - DEEPSEEK_API_KEY = 你的 DeepSeek Key
   - （可选）DEEPSEEK_MODEL = deepseek-chat
4. 部署

## 目录
- index.html：前端
- api/deepseek.js：Vercel Serverless Function（代理调用 DeepSeek）

## 说明
本 MVP 为“语音识别 → 文本 → LLM → 文本 →（可选）语音播报”。
如需“实时流式语音大模型（可打断、低延迟）”，需要接入支持流式 ASR/TTS 的实时语音方案（后续可扩展）。
