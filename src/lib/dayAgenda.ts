import type { Task } from "../types";
import { parseDate } from "./calendar";
import { taskTemplateId } from "./tasks";

export function canRescheduleTask(task: Task) {
  return !task.done && task.repeat === "none" && task.id === taskTemplateId(task.id);
}

export function agendaBacklog(tasks: Task[], today: string): Task[] {
  return tasks
    .filter((task) => canRescheduleTask(task) && (!task.date || task.date < today))
    .sort((a, b) => Number(!a.date) - Number(!b.date) || a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
}

export function rescheduleTask(tasks: Task[], id: string, target: string): Task[] {
  parseDate(target);
  const task = tasks.find((item) => item.id === id);
  if (!task || !canRescheduleTask(task)) {
    throw new Error("已完成或重复待办不能在两日清单中改期。");
  }
  if (task.date === target) return tasks;
  return tasks.map((item) => item === task ? { ...item, date: target } : item);
}
