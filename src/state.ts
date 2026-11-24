import type { AppState } from "./types";
export const newState = (): AppState => ({
  schemaVersion: 1,
  tasks: [],
  notes: [],
  noteTags: [],
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
type LegacyState = Omit<AppState, "noteTags" | "notes"> & {
  noteTags?: AppState["noteTags"];
  notes: (Omit<AppState["notes"][number], "tagIds"> & { tagIds?: string[] })[];
};

export function withNoteDefaults(state: LegacyState): AppState {
  return {
    ...state,
    noteTags: state.noteTags ?? [],
    notes: state.notes.map((note) => ({ ...note, tagIds: note.tagIds ?? [] })),
  };
}

export const loadState = async () => {
  if (window.workbench) {
    const data = await window.workbench.load();
    return data ? withNoteDefaults(data) : newState();
  }
  const raw = localStorage.getItem("flower-workbench");
  return raw ? withNoteDefaults(JSON.parse(raw) as LegacyState) : newState();
};
export const saveState = async (state: AppState) => {
  if (window.workbench) await window.workbench.save(state);
  else localStorage.setItem("flower-workbench", JSON.stringify(state));
};
