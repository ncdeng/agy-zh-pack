# macOS 使用说明

> [!IMPORTANT]
> **v2.0 起，macOS 请用安装包装成 Antigravity 插件**：解压安装包，在终端里用 `bash` 运行 `一键安装.command`，见 [主页的快速开始](../README.md#快速开始)。插件不用 Node.js、不用 LaunchAgent，Antigravity 会自己启动它。装插件时，这里的 LaunchAgent 会被自动删掉，数据会搬到插件的数据目录。
>
> 下面是从源码运行的方式（v1.x 的做法），只给想改代码的人用。不要和插件同时用：已经有一个注入程序在跑时，新启动的会自动退出。

> 要求：macOS + Node.js 22 或更高版本，已安装 Antigravity 并登录过一次。补算以前的用量需要 Node.js 22.13 / 23.4 或更高版本（用到内置的 `node:sqlite`，22.5～22.12 要加启动参数才能用）；版本不够时只跳过补算，其他功能照常。

## 快速开始

1. 克隆仓库到本地任意目录：

```zsh
git clone https://github.com/ncdeng/agy-zh-pack.git
cd agy-zh-pack
```

2. 安装并启动后台注入程序的登录自启（LaunchAgent）：

```zsh
node macos/manage.mjs install-agent
```

3. 带调试端口参数启动 Antigravity（Antigravity 2.33.0 起必须带 `--remote-debugging-port=0`）：

```zsh
./macos/launch-agy.command
```

也可以在 Finder 里直接双击 `macos/launch-agy.command`（首次双击如遇系统拦截，右键选择“打开”即可）。

Antigravity 打开后几秒内界面会切换为中文，并自动刷新一次以加载输入框上方的用量状态栏。若窗口打开较久后才启动注入程序，按一次 `Cmd+R` 刷新窗口即可。

## 常用命令

```zsh
# 查看后台进程、LaunchAgent、调试端口及配色状态
node macos/manage.mjs status

# 手动启动 / 停止后台注入程序
node macos/manage.mjs start
node macos/manage.mjs stop

# 可选：启用 / 恢复作者配色（默认关闭；需先按 Cmd+Q 退出 Antigravity，原配色备份在 originals.json）
node macos/manage.mjs theme on
node macos/manage.mjs theme off

# 卸载登录自启并停止后台注入程序
node macos/manage.mjs uninstall
```

## 说明

- 远程调试端口文件：`~/Library/Application Support/Antigravity/DevToolsActivePort`
- 单实例锁：`/tmp/agy-zh-pack-<uid>.sock`
- 登录自启配置：`~/Library/LaunchAgents/com.ncdeng.agy-zh-pack.plist`（优先写入 `/opt/homebrew/bin/node`、`/usr/local/bin/node` 等不随版本号变化的路径；若使用 nvm/fnm 等版本管理器，升级 Node 后重跑一次 `node macos/manage.mjs install-agent` 即可）
- 只要状态栏、不要汉化：删掉或移走 `i18n/zh-CN.json`，再在 Antigravity 中按一次 `Cmd+R`。
- 如果 Antigravity 未带 `--remote-debugging-port` 启动（例如直接从程序坞打开或自动更新后自启），注入程序会通过 macOS 系统通知提醒一次，关闭后用 `macos/launch-agy.command` 重新打开即可。
