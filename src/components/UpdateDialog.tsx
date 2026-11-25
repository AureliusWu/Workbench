import { Download, RefreshCw, ShieldCheck, X } from "lucide-react";
import type { UpdateState } from "../types";

export function UpdateDialog({
  status,
  pending,
  error,
  close,
  check,
  install,
  setAutomatic,
}: {
  status: UpdateState;
  pending: boolean;
  error: string;
  close: () => void;
  check: () => void;
  install: () => void;
  setAutomatic: (enabled: boolean) => void;
}) {
  const installing = pending || status.status === "installing";
  const checking =
    status.status === "checking" || status.status === "downloading";
  return (
    <div className="modal-backdrop" onClick={installing ? undefined : close}>
      <section
        className="modal update-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-heading">
          <div className="update-title">
            <span className="dialog-icon">
              <RefreshCw size={21} />
            </span>
            <div>
              <h2 id="update-title">应用更新</h2>
              <p>当前版本 v{status.currentVersion}</p>
            </div>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={close}
            disabled={installing}
            aria-label="关闭更新窗口"
            autoFocus
          >
            <X size={19} />
          </button>
        </div>
        <div className="update-status" role="status" aria-live="polite">
          {status.availableVersion && (
            <strong>版本 v{status.availableVersion}</strong>
          )}
          <p>
            {pending && status.status !== "installing"
              ? "正在确认本机记录已保存…"
              : status.message}
          </p>
          {status.status === "downloading" && (
            <progress
              max={100}
              value={status.progress ?? 0}
              aria-label="更新下载进度"
            />
          )}
        </div>
        {status.enabled && (
          <label className="update-option">
            <span>
              <b>自动检查并下载</b>
              <small>在后台准备安装包，点击「重启更新」时安装。</small>
            </span>
            <input
              type="checkbox"
              checked={status.automatic}
              onChange={(event) => setAutomatic(event.target.checked)}
              disabled={installing}
            />
          </label>
        )}
        <p className="update-trust">
          <ShieldCheck size={15} />
          更新前校验发行签名，沿用本机工作台数据。
        </p>
        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}
        <div className="modal-footer">
          <button
            type="button"
            className="secondary-button"
            onClick={close}
            disabled={installing}
          >
            {status.status === "ready" ? "稍后" : "关闭"}
          </button>
          {status.status === "ready" || status.status === "installing" ? (
            <button
              type="button"
              className="primary-button"
              onClick={install}
              disabled={installing}
            >
              <Download size={16} />
              {installing ? "正在更新…" : "重启更新"}
            </button>
          ) : (
            <button
              type="button"
              className="primary-button"
              onClick={check}
              disabled={!status.enabled || checking || installing}
            >
              <RefreshCw size={15} />
              检查更新
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
