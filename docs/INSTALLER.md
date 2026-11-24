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

1.0.1 及更早便携版没有 NSIS 安装登记，不能把其任意位置的 EXE 当作“已安装目录”覆盖。安装 1.1.0 会建立固定程序目录和新快捷方式，沿用同一份用户数据；不会搜盘、删除或改写用户自行存放的旧便携 EXE。

升级前从旧程序托盘退出，安装后使用“花笺 Workbench”快捷方式。不要继续点击收藏在其他文件夹的旧便携 EXE。

## 安装生命周期验证

`npm run test:installer` 只在 GitHub 托管的临时 Windows 测试账户中运行。日常本机执行会在任何安装及注册表操作前停止，避免覆盖当前用户的安装或快捷方式。

测试步骤：

1. 确认生产 GUID 没有现存安装登记、没有运行中的 Workbench，也没有已有用户记录。
2. 用同一 NSIS 配方构建测试专用旧版本 1.0.9；这是合成安装基线，并非历史公开发行版。
3. 静默安装到工作区 `artifacts/installer-*/installed-program`，保存旧格式任务、便笺、复盘、专注记录、设置与测试用加密密钥。
4. 运行本次真实发行安装包，不提供 `/D`，要求通过稳定登记自动找到原测试安装目录。
5. 核对旧程序哨兵与旧 `app.asar` 已被替换、安装目录不变，数据与密钥文件哈希未变化；启动新版读取原记录。
6. 正常静默卸载，确认程序与安装登记移除，用户数据及加密密钥仍保留。

测试使用 `/S` 抑制安装结束后自动运行，再由测试明确启动已安装 EXE。该流程不使用清除数据参数。快捷方式仅在临时账户内操作，并保留和恢复已有同名测试入口。

如需指定安装包：

```powershell
$env:WORKBENCH_INSTALLER = 'D:\path\Workbench-Setup-1.1.0-win-x64.exe'
npm run test:installer
# 或直接传参，仍受临时托管账户保护
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/installer-lifecycle.ps1 -InstallerPath 'D:\path\Workbench-Setup-1.1.0-win-x64.exe'
```

真实 CI 运行结果记录在对应工作流与 `artifacts/installer-*/results.json`；本说明本身不代表生命周期测试已经通过。

## 依据

NSIS 配置与稳定 appId/GUID 的升级行为依据 [electron-builder 官方 NSIS 文档](https://www.electron.build/docs/nsis/)；具体保留数据、静默安装、旧路径识别及快捷方式行为也核对了随项目依赖安装的 NSIS 模板代码。
