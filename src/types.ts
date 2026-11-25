export type Priority = "high" | "medium" | "low";
export interface Step {
  id: string;
  title: string;
  done: boolean;
}
export interface Task {
  id: string;
  title: string;
  date: string;
  time: string;
  priority: Priority;
  done: boolean;
  completedAt?: string;
  createdAt: string;
  steps: Step[];
  repeat: "none" | "daily" | "weekly";
  estimate: number;
  reminder: boolean;
}
export interface Note {
  id: string;
  text: string;
  color: "pink" | "lavender" | "mint" | "yellow";
  createdAt: string;
  tagIds: string[];
  archivedAt?: string;
}
export interface NoteTag {
  id: string;
  name: string;
}
export interface FocusSession {
  id: string;
  date: string;
  minutes: number;
  taskId?: string;
}
export interface Settings {
  name: string;
  lastSaturdayWork: boolean;
  dayOverrides: Record<string, "work" | "rest">;
  focusMinutes: number;
  breakMinutes: number;
  morningGreeting: boolean;
  autoLaunch: boolean;
  aiEndpoint: string;
  aiModel: string;
}
export interface AppState {
  schemaVersion: 1;
  tasks: Task[];
  notes: Note[];
  noteTags: NoteTag[];
  focusSessions: FocusSession[];
  reviews: Record<string, string>;
  settings: Settings;
}
export interface FileEntry {
  name: string;
  path: string;
  category: string;
  modified: string;
  isDirectory: boolean;
}
export interface UpdateState {
  enabled: boolean;
  automatic: boolean;
  status:
    | "disabled"
    | "idle"
    | "checking"
    | "up-to-date"
    | "downloading"
    | "ready"
    | "installing"
    | "error";
  currentVersion: string;
  availableVersion?: string;
  progress?: number;
  downloadedBytes?: number;
  totalBytes?: number;
  checkedAt?: string;
  message: string;
}
export interface DesktopApi {
  load: () => Promise<AppState | null>;
  save: (state: AppState) => Promise<void>;
  notify: (title: string, body: string) => Promise<void>;
  capture: () => Promise<void>;
  pinClipboard: () => Promise<void>;
  pinNote: (text: string) => Promise<void>;
  exportData: () => Promise<boolean>;
  exportReview: (payload: {
    weekStart: string;
    weekEnd: string;
    markdown: string;
  }) => Promise<boolean>;
  importData: () => Promise<AppState | null>;
  selectFolder: () => Promise<string | null>;
  listFiles: (path: string) => Promise<FileEntry[]>;
  openPath: (path: string) => Promise<void>;
  windowAction: (
    action: "minimize" | "maximize" | "close" | "pin",
  ) => Promise<void>;
  setAutoLaunch: (enabled: boolean) => Promise<void>;
  aiReview: (payload: {
    prompt: string;
    endpoint: string;
    model: string;
    apiKey?: string;
  }) => Promise<string>;
  saveApiKey: (key: string) => Promise<void>;
  hasApiKey: () => Promise<boolean>;
  version: () => Promise<string>;
  getUpdate: () => Promise<UpdateState>;
  checkUpdate: () => Promise<UpdateState>;
  setAutomaticUpdates: (enabled: boolean) => Promise<UpdateState>;
  installUpdate: () => Promise<void>;
  onUpdate: (listener: (state: UpdateState) => void) => () => void;
}
declare global {
  interface Window {
    workbench?: DesktopApi;
  }
}
