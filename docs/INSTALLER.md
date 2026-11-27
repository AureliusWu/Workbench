# Windows 安装与升级约定

1.1.0 起，主发行文件为 `Workbench-Setup-${version}-win-x64.exe`。采用完整离线 NSIS 包，双击后为当前 Windows 用户一键安装，完成后打开程序。后续运行同系列安装包更新已安装程序。

## 必须保持稳定的身份

| 字段 | 固定值 |
| --- | --- |
| `appId` / Windows AUMID | `com.aureliuswu.workbench` |
| NSIS GUID | `01102294-7068-596a-b26b-50193e5b226e` |
| 程序名称与 EXE | `Workbench` / `Workbench.exe` |
| 桌面与开始菜单快捷方式 | `花笺 Workbench` |
| 默认安装目录 | `%LOCALAPPDATA%\Programs\Workbench` |
| 用户数据目录 | `%APPDATA%\Workbench` |

GUID 与此前 appId 按 electron-builder 规则生成的身份一致。更改 appId、GUID 或程序名可能导致下一版不能识别原安装；不能为每次发行随机生成新 GUID。

配置为 `oneClick:true`、`perMachine:false`、`deleteAppDataOnUninstall:false`。程序目录与用户数据目录分别保存：安装程序替换旧程序文件，保留待办、便笺、复盘、设置和本机加密密钥；正常卸载也不删除用户数据。数据格式升级仍应保留旧记录，并由应用层执行兼容处理。

## 从旧便携版过渡

1.0.1 及更早版本以便携 EXE 运行。运行当前安装包会建立固定程序目录和新快捷方式，并读取同一份用户数据。之前自存的便携 EXE 仍可在原位置找到。

升级前从旧程序托盘退出，安装后使用“花笺 Workbench”快捷方式。不要继续点击收藏在其他文件夹的旧便携 EXE。

## 自动更新与发布

安装版从 1.2.0 起会在后台从本仓库 GitHub Release 检查、下载新版。更新器先用内置 Ed25519 公钥验证 `workbench-update.json`，再核对 Windows 安装包的长度和 SHA-256。选择「重启更新」后，工作台保存记录并退出，NSIS 静默覆盖当前用户的原安装路径；安装助手等待安装结束、核对新版程序版本并以正常窗口方式重新启动应用。下载或校验失败时可重试，或使用发行页的安装包。

正式发布由 [Publish signed Windows release](../.github/workflows/release.yml) 从 main 手动触发，或由 Agent 提交明确的发行请求文件触发。它先运行完整 Windows CI，再使用同一运行中的产物进入 production 签名任务。签名、暂存发行和核对全部资产后才公开 Release。参见 [发行配置](RELEASE-AUTOMATION.md)。

发布时使用通过 Windows CI 生命周期测试的同一份安装包。`workbench-update.unsigned.json` 是 CI 生成的版本、文件名、长度与 SHA-256 记录，需与下载的安装包匹配。下面的命令在持有本地签名密钥的 Windows 用户下生成最终清单。

```powershell
node scripts/sign-update.cjs release/v1.2.0/Workbench-Setup-1.2.0-win-x64.exe release/v1.2.0/workbench-update.json
```

一起上传安装包、`SHA256SUMS.txt`、`workbench-update.json` 到同一个稳定发行版。发布后检查公开的 `releases/latest/download/workbench-update.json`，并用 `electron/update-public-key.pem` 校验内容与安装包。

私钥由 Windows 当前用户 DPAPI 保护，存放在 `%LOCALAPPDATA%\WorkbenchReleaseSigning\update-ed25519.dpapi`。仓库与普通 CI 只持有公钥；production 环境 Secret 可托管同一私钥以供发行任务使用。保留受保护的离线备份，避免丢失更新信任链。若密钥不可用，已有用户需手动安装包含新公钥的受信任发行版。

## 安装生命周期验证

`npm run test:installer` 只在 GitHub 托管的临时 Windows 测试账户中运行。日常本机执行会在任何安装及注册表操作前停止，避免覆盖当前用户的安装或快捷方式。

测试步骤：

1. 确认生产 GUID 没有现存安装登记、没有运行中的 Workbench，也没有已有用户记录。
2. 1.3.0 起下载 GitHub 已发布的 1.2.0 一键安装包，并校验预先记录的 SHA-256。1.2.0 的验收使用同一配方构建的 1.1.9 合成安装基线。
3. 静默安装到工作区 `artifacts/installer-*/installed-program`，保存旧格式任务、便笺、复盘、专注记录、设置与测试用加密密钥。
4. `npm run test:updater` 使用临时公钥和本机测试源，先验证坏签名被拒绝，再让更新器下载真实候选安装包，调用安装交接并确认新版重新打开。`npm run test:installer` 可直接验收同一安装包的手动覆盖路径。两条路径都通过稳定登记定位原安装目录。
5. 核对旧程序哨兵与旧 `app.asar` 已被替换、安装目录不变，数据与密钥文件哈希未变化；启动新版读取原记录。
6. 正常静默卸载，确认程序与安装登记移除，用户数据及加密密钥仍保留。

初始基线静默安装后由脚本打开。自动更新路径检查 NSIS 安装后的自动重启。快捷方式只在临时账户内操作。

如需指定安装包：

```powershell
$env:WORKBENCH_INSTALLER = 'D:\path\Workbench-Setup-1.2.0-win-x64.exe'
npm run test:updater
# 或直接传参，仍受临时托管账户保护
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/installer-lifecycle.ps1 -UseUpdater -InstallerPath 'D:\path\Workbench-Setup-1.2.0-win-x64.exe'
```

真实 CI 运行结果记录在对应工作流与 `artifacts/installer-*/results.json`；本说明本身不代表生命周期测试已经通过。

## 依据

NSIS 配置与稳定 appId/GUID 的升级行为依据 [electron-builder 官方 NSIS 文档](https://www.electron.build/docs/nsis/)；具体保留数据、静默安装、旧路径识别及快捷方式行为也核对了随项目依赖安装的 NSIS 模板代码。
