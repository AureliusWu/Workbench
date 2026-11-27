import { describe, expect, it } from "vitest";
import type { Task } from "../types";
import { newState } from "../state";
import { agendaBacklog, rescheduleTask } from "./dayAgenda";
import { appendTemplateSteps, taskTemplates } from "./taskTemplates";
import { dueReminders, tasksForDate, weeklyStats } from "./tasks";

function task(id: string, fields: Partial<Task> = {}): Task {
  return {
    id, title: id, date: "2026-11-29", time: "09:00", priority: "high",
    done: false, createdAt: "2026-11-25T01:00:00.000Z", steps: [],
    repeat: "none", estimate: 40, reminder: true, ...fields,
  };
}

describe("two-day agenda", () => {
  it("moves a single task between weeks and keeps its reminder and checked steps", () => {
    const source = task("move", { steps: [{ id: "step", title: "Write agenda", done: true }] });
    const history = task("history", { done: true, completedAt: "2026-11-29T09:00:00.000Z" });
    const tasks = [source, history];
    const next = rescheduleTask(tasks, source.id, "2026-11-30");
    const state = { ...newState(), tasks: next };

    expect(source.date).toBe("2026-11-29");
    expect(next[0]).toEqual({ ...source, date: "2026-11-30" });
    expect(next[1]).toBe(history);
    expect(tasksForDate(next, "2026-11-29")).toEqual([history]);
    expect(weeklyStats(state, "2026-11-29").completed).toBe(1);
    expect(weeklyStats(state, "2026-11-30").pending).toBe(1);
    expect(dueReminders(next, new Date(2026, 10, 29, 9))).toEqual([]);
    expect(dueReminders(next, new Date(2026, 10, 30, 9))).toEqual([next[0]]);
  });

  it("lists only overdue or unscheduled open single tasks without changing their dates", () => {
    const overdue = task("overdue", { date: "2026-11-27" });
    const unscheduled = task("unscheduled", { date: "", time: "", reminder: false });
    const completed = task("done", { done: true, date: "2026-11-20" });
    const weekly = task("series", { repeat: "weekly", date: "2026-11-20" });
    const snapshot = task("series::2026-11-20", { date: "2026-11-20" });
    const tasks = [unscheduled, task("current"), completed, overdue, weekly, snapshot];

    expect(agendaBacklog(tasks, "2026-11-29")).toEqual([overdue, unscheduled]);
    expect(unscheduled.date).toBe("");
    for (const entry of [completed, weekly, snapshot]) {
      expect(() => rescheduleTask(tasks, entry.id, "2026-11-30")).toThrow();
    }
    expect(() => rescheduleTask(tasks, overdue.id, "2026-11-31")).toThrow();
    expect(rescheduleTask(tasks, overdue.id, overdue.date)).toBe(tasks);
  });
});

describe("task templates", () => {
  it("adds original steps without replacing user text or duplicating a step", () => {
    const template = taskTemplates[0];
    const draft = `自定义准备事项\n ${template.steps[0]} `;
    const steps = appendTemplateSteps(draft, template.steps);
    expect(steps).toBe(`${draft}\n${template.steps[1]}\n${template.steps[2]}`);
    expect(appendTemplateSteps(steps, template.steps)).toBe(steps);
  });
});
