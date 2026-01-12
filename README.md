# AI 面试陪练（JD→题库→语音陪练）

## 本地运行（可选）
你可以用任意静态服务器打开 index.html（比如 VSCode Live Server）。
注意：本地直接打开 file:// 可能会因为 fetch 限制而失败，建议起一个静态服务。

## Vercel 部署（推荐）
1. 把本仓库推到 GitHub
2. Vercel -> Add New Project -> Import Git Repository
3. 在 Vercel Project Settings -> Environment Variables 添加：
   - DEEPSEEK_API_KEY = 你的 DeepSeek Key
   - （可选）DEEPSEEK_MODEL = deepseek-chat
4. Deploy

## 说明
- 前端调用 /api/deepseek
- 后端使用 Vercel Serverless Function 读取环境变量 DEEPSEEK_API_KEY，再代理请求 DeepSeek
