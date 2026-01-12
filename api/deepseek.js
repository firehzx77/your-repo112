export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method Not Allowed" });

  try {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    const model = process.env.DEEPSEEK_MODEL || "deepseek-chat";
    if (!apiKey) return res.status(500).json({ ok: false, error: "Missing DEEPSEEK_API_KEY in environment variables" });

    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const action = body?.action;
    const payload = body?.payload || {};

    let messages = [];
    let temperature = 0.5;
    let max_tokens = 900;

    const sysBase = `你是一个“面试语音陪练系统”的大脑（文本输入输出）。核心目标：
- 让用户感受到真实的面试对话：提问→追问→转题→总结；
- 追问要具体、可执行、能逼出细节与量化；
- 点评要短、硬、可操作（亮点1条 + 改进1条 + 1句示范）；
- 风格要可控：friendly温和引导；pressure高压但不羞辱；
- 目标要可控：star/scenario/quant；
- 输出必须是严格 JSON，不要夹带任何多余文字。
`;

    if (action === "generate_questions") {
      const role_key = String(payload.role_key || "").trim();
      const role_label = String(payload.role_label || "候选人").trim();
      const interviewer_type = String(payload.interviewer_type || "hiring_mgr").trim();
      const style = String(payload.style || "friendly").trim();
      const goal = String(payload.goal || "star").trim();
      const scene = String(payload.scene || "interview_room").trim();

      messages = [
        { role: "system", content: sysBase + "你负责根据岗位与面试官类型生成 3-5 个高质量问题。" },
        { role: "user", content: `请根据以下信息生成 3-5 个面试问题（严格 JSON）。要求：
- 问题必须贴合岗位与面试官类型；
- 每题给出 2-3 个追问种子（followup_seeds），用于后续追问；
- 每题给出一句“what_good_looks_like”（优秀回答特征）；
- 问题覆盖面要均衡：至少包含 1 个行为题、1 个场景题、1 个量化/指标题；
- 全部中文；

输入：
candidate_role_key: ${role_key}
candidate_role_label: ${role_label}
interviewer_type: ${interviewer_type} （hrbp|hiring_mgr|exec）
style: ${style}
goal: ${goal}
scene: ${scene}

输出格式（严格遵守）：
{
  "candidate_role_label": "...",
  "interviewer_role": "一句话描述面试官身份（例如：销售总监/产品负责人/HRBP/VP）",
  "questions": [
    {
      "id": "q1",
      "type": "behavior|scenario|quant",
      "question": "问题正文",
      "followup_seeds": ["追问点1","追问点2"],
      "what_good_looks_like": "一句话优秀特征"
    }
  ]
}` }
      ];
      temperature = 0.35;
      max_tokens = 1400;
    }

    else if (action === "interview_turn") {
      const active = payload.active_config || {};
      const pending = payload.pending_config || active;

      const role_label = String(payload.role_label || active.role_label || "候选人");
      const interviewer_type = String(payload.interviewer_type || active.interviewer_type || "hiring_mgr");
      const scene = String(payload.scene || active.scene || "interview_room");

      const question_index = Number(payload.question_index ?? 0);
      const followup_count = Number(payload.followup_count ?? 0);
      const followup_limit = Number(payload.followup_limit ?? 2);

      const questions = payload.questions || [];
      const current_question = payload.current_question || questions[question_index] || {};
      const user_answer = String(payload.user_answer || "").trim();
      const last_turn_brief = payload.last_turn_brief || [];

      if (!user_answer) return res.status(400).json({ ok: false, error: "user_answer is required" });
      if (!current_question?.question) return res.status(400).json({ ok: false, error: "current_question.question is required" });

      // key idea: within current question -> use active config; if moving to next question -> use pending config
      const sys = `${sysBase}

你要同时扮演：
1) Interviewer（面试官）：提问/追问/转题；语气按风格；
2) Coach（教练）：点评与训练建议；

【场景氛围】${scene}（可在话术中轻微体现，但不要喧宾夺主）
【候选人岗位】${role_label}
【面试官类型】${interviewer_type}（hrbp|hiring_mgr|exec）

【配置生效规则】
- 当前题追问必须使用 active_config（下面会给出）
- 若你决定进入下一题，则下一题必须使用 pending_config（下面会给出）
- 用户要求“下一题生效”，所以不要在当前题突然改变风格/目标。

【追问与转题策略】
- followup_limit=${followup_limit}；当前 followup_count=${followup_count}
- 如果用户回答缺少关键细节/量化/口径/取舍，则优先追问；
- 但如果已追问达到上限，必须转入下一题（next_step=next_question）；
- next_step 只能是 followup / next_question / wrap_up

【输出格式：严格 JSON】
{
  "interviewer_reply": "面试官下一句话（1~2句，followup则追问；next_question则直接问下一题；wrap_up则总结收尾）",
  "coach_feedback": {
    "total_score": 0-100,
    "subscores": {"clarity":0-100,"structure":0-100,"evidence":0-100,"fit":0-100,"impact":0-100},
    "strength": "一句话指出亮点（必须具体）",
    "improve": "一句话指出最关键的可执行改进点（必须具体）",
    "one_sentence_demo": "给用户一句更好的示范表达（1句，不要超过30字）"
  },
  "next_step": "followup|next_question|wrap_up",
  "question_index": 0
}

【active_config（当前题使用）】
${JSON.stringify(active)}

【pending_config（若进入下一题则使用）】
${JSON.stringify(pending)}

【当前题信息】
${JSON.stringify(current_question)}

【题目列表（用于决定下一题）】
${JSON.stringify(questions)}

【对话摘要（最近几轮）】
${JSON.stringify(last_turn_brief)}

【用户回答】
${user_answer}
`;

      messages = [
        { role: "system", content: sys }
      ];
      temperature = 0.45;
      max_tokens = 900;
    }

    else {
      return res.status(400).json({ ok: false, error: "Unknown action" });
    }

    const r = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        max_tokens
      })
    });

    const out = await r.json();
    if (!r.ok) {
      return res.status(500).json({ ok: false, error: out?.error?.message || "DeepSeek API error", detail: out });
    }

    const content = out?.choices?.[0]?.message?.content ?? "";
    const data = parseJsonWithExtraction(content);

    if (!data) {
      return res.status(200).json({ ok: false, error: "Model output is not valid JSON", raw: content });
    }

    return res.status(200).json({ ok: true, data });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message || "Server error" });
  }
}

function parseJsonWithExtraction(str) {
  try { return JSON.parse(str); } catch (e) {}
  const a = str.indexOf("{");
  const b = str.lastIndexOf("}");
  if (a >= 0 && b > a) {
    try { return JSON.parse(str.slice(a, b + 1)); } catch (e) {}
  }
  return null;
}
