import type { AppState } from "./types";
export const newState = (): AppState => ({
  schemaVersion: 1,
  tasks: [],
  notes: [],
  focusSessions: [],
  reviews: {},
  settings: {
    name: "",
    lastSaturdayWork: true,
    dayOverrides: {},
    focusMinutes: 25,
    breakMinutes: 5,
    morningGreeting: true,
    autoLaunch: false,
    aiEndpoint: "https://api.openai.com/v1",
    aiModel: "gpt-4.1-mini",
  },
});
export const uid = () => crypto.randomUUID();
export const localDate = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const loadState = async () => {
  if (window.workbench) return (await window.workbench.load()) || newState();
  const raw = localStorage.getItem("flower-workbench");
  return raw ? (JSON.parse(raw) as AppState) : newState();
};
export const saveState = async (state: AppState) => {
  if (window.workbench) await window.workbench.save(state);
  else localStorage.setItem("flower-workbench", JSON.stringify(state));
};
