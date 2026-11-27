export const taskTemplates = [
  {
    title: "准备会议",
    minutes: 45,
    steps: ["确认议题和参会人", "预订会议室或建立会议链接", "发送议程和材料"],
  },
  {
    title: "整理报销",
    minutes: 30,
    steps: ["收齐发票和付款凭证", "核对日期、金额和科目", "提交报销并记录进度"],
  },
  {
    title: "家庭采买",
    minutes: 35,
    steps: ["检查家里现有存货", "列出需要补充的物品", "购买后核对清单"],
  },
] as const;

export function appendTemplateSteps(draft: string, steps: readonly string[]) {
  const existing = new Set(draft.split("\n").map((line) => line.trim()));
  const missing = steps.filter((step) => !existing.has(step));
  return [draft, ...missing].filter(Boolean).join("\n");
}
