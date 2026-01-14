export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method Not Allowed" });
      return;
    }

    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      res.status(500).json({ error: "Missing DEEPSEEK_API_KEY in environment variables." });
      return;
    }

    const body = req.body || {};
    const action = body.action;
    const meta = body.meta || {};
    const sessionId = body.sessionId || "session";

    if (action === "generate_questions") {
      const { questions, history } = await generateQuestions({ apiKey, meta, sessionId });
      res.status(200).json({ questions, history });
      return;
    }

    if (action === "coach_turn") {
      const reply = await coachTurn({ apiKey, meta, sessionId, payload: body });
      res.status(200).json(reply);
      return;
    }

    res.status(400).json({ error: "Unknown action." });
  } catch (e) {
    res.status(500).json({ error: e.message || "Server error" });
  }
}

async function deepseekChat({ apiKey, messages, temperature = 0.6 }) {
  // DeepSeek 官方：POST https://api.deepseek.com/chat/completions :contentReference[oaicite:10]{index=10}
  const resp = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages,
      temperature,
      stream: false,
    }),
  });

  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`DeepSeek API error: ${resp.status} ${t}`);
  }

  const data = await resp.json();
  const text = data?.choices?.[0]?.message?.content ?? "";
  return text;
}

function systemPrompt(meta) {
  const style = meta.style === "pressure" ? "更强追问、节奏更快、要求更具体" : "友好引导、结构化提示、鼓励表达";
  const goal = meta.goal === "star"
    ? "重点推动 STAR（情境-任务-行动-结果），要求结果量化"
    : meta.goal === "quant"
      ? "重点追问数据、指标、对比基线、ROI、复盘"
      : "重点用情境推进：选项、权衡、风险、决策依据";

  return `
你是一名中文面试官与陪练教练的合体（同一个声音输出）。
你将以“面试官口吻”进行提问/追问/点评，不要输出“教练：”字样。
你必须非常口语化、短句、易听懂（因为会被 TTS 播放）。

候选人岗位：${meta.job || "未指定"}
面试官类型：${meta.interviewerType || "专业严谨"}
当前场景：${meta.sceneLabel || "面试室"}（氛围：${meta.sceneMood || "正式"}）
陪练风格：${style}
训练目标：${goal}

规则：
1) 每轮输出不超过 80~140 字，便于语音播报。
2) 结构：先给一句反馈（可选），再给 1~2 个追问问题。
3) 追问要落到细节：时间、对象、动作、结果、指标、反例、风险。
4) 如果候选人答得很好：给一句肯定 + 进入下一题的过渡句。
5) 严禁输出冗长清单、严禁输出 Markdown、严禁输出多段落。
`.trim();
}

async function generateQuestions({ apiKey, meta }) {
  const messages = [
    { role: "system", content: systemPrompt(meta) },
    {
      role: "user",
      content:
        `请为岗位「${meta.job}」生成 3-5 个面试问题：按从易到难，覆盖动机/能力/案例/复盘/数据。只输出 JSON 数组，例如：["Q1...","Q2..."]，不要输出其它文本。`
    }
  ];

  const text = await deepseekChat({ apiKey, messages, temperature: 0.4 });

  let questions = [];
  try {
    questions = JSON.parse(text);
  } catch {
    // 容错：提取中括号
    const m = text.match(/\[[\s\S]*\]/);
    if (m) questions = JSON.parse(m[0]);
  }

  if (!Array.isArray(questions) || questions.length < 3) {
    questions = [
      "请用 60 秒做一个与你岗位相关的自我介绍（含一个关键成果）。",
      "讲一个你主导解决问题的案例：你做了什么、结果是什么？",
      "如果资源不足/目标冲突，你会如何决策？请举例说明。"
    ];
  }

  // history：用来后续 multi-round（stateless API 需要你带上下文）:contentReference[oaicite:11]{index=11}
  const history = [
    { role: "system", content: systemPrompt(meta) },
    { role: "assistant", content: "我们开始。请准备好后回答我的问题。" },
  ];

  return { questions: questions.slice(0, 5), history };
}

async function coachTurn({ apiKey, meta, payload }) {
  const history = Array.isArray(payload.history) ? payload.history : [];
  const currentQuestion = payload.currentQuestion || "";

  // 让模型知道“当前题”，但仍保持口语输出短
  const messages = [
    { role: "system", content: systemPrompt(meta) },
    ...history,
    {
      role: "user",
      content:
        `当前题是：「${currentQuestion}」。基于我刚才的回答，请按规则给出追问/点评。`
    }
  ];

  const reply = (await deepseekChat({ apiKey, messages, temperature: 0.65 })).trim();

  // 简单策略：如果出现“进入下一题/下一题/我们继续下一题”就推进
  const move = /下一题|进入下一题|我们继续下一题/.test(reply)
    ? "next"
    : /整体点评|本轮结束|到这里/.test(reply)
      ? "end"
      : "stay";

  return { reply, move };
}
