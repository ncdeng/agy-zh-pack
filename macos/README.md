# macOS：从源码运行

> [!IMPORTANT]
> **平常使用请装插件**：解压安装包，在终端里用 `bash` 运行 `一键安装.command`，见 [README 的安装](../README.md#安装)。插件不用自己装 Node.js，也不用 LaunchAgent，Antigravity 会自己启动它。装插件时，这里的 LaunchAgent 会被自动删掉，数据会搬到插件的数据目录。
>
> 这一页是从源码运行的方式，给想改代码的人用。不要和插件同时用：已经有一个注入程序在跑时，新启动的会自动退出。原理、测试和发版见 [docs/development.md](../docs/development.md)。

要求：macOS，Node.js 22 或更高版本，已经装好 Antigravity 并登录过一次。读 agy CLI 的用量、补算以前的用量要 Node.js 22.13 / 23.4 或更高版本（用到内置的 `node:sqlite`）；版本不够时只跳过这两项，其他功能照常。

## 开始

1. 把仓库克隆到任意文件夹：

```zsh
git clone https://github.com/ncdeng/agy-zh-pack.git
cd agy-zh-pack
```

2. 装上注入程序的登录自启（LaunchAgent），并启动它：

```zsh
node macos/manage.mjs install-agent
```

3. 带调试端口参数启动 Antigravity（Antigravity 2.33.0 起必须带 `--remote-debugging-port=0`）：

```zsh
./macos/launch-agy.command
```

也可以在 Finder 里双击 `macos/launch-agy.command`。第一次双击被系统拦下时，右键选“打开”。

Antigravity 打开后几秒内界面就换成中文，并自动刷新一次，装上输入框上方的用量状态栏。如果注入程序在窗口打开很久以后才启动，按一次 `Cmd+R` 刷新窗口。

## 常用命令

```zsh
# 看注入程序、LaunchAgent、调试端口的状态
node macos/manage.mjs status

# 手动启动 / 停止注入程序
node macos/manage.mjs start
node macos/manage.mjs stop

# 删掉登录自启，并停止注入程序（以前用过作者配色的，同时按 originals.json 恢复原来的颜色；要先按 Cmd+Q 退出 Antigravity）
node macos/manage.mjs uninstall
```

## 说明

- 调试端口文件：`~/Library/Application Support/Antigravity/DevToolsActivePort`
- 单实例锁：`/tmp/agy-zh-pack-<uid>.sock`
- 登录自启的配置：`~/Library/LaunchAgents/com.ncdeng.agy-zh-pack.plist`。里面优先写 `/opt/homebrew/bin/node`、`/usr/local/bin/node` 这类不随版本号变的路径；用 nvm、fnm 等版本管理器的，升级 Node 后重新运行一次 `node macos/manage.mjs install-agent`。
- 只要状态栏、不要汉化：v2.0.15 起在插件面板里关掉“中文界面”；以前的版本删掉或移走 `i18n/zh-CN.json`，再在 Antigravity 里按一次 `Cmd+R`。
- Antigravity 没带 `--remote-debugging-port` 启动时（比如从程序坞直接打开，或者自动更新后自己重启），注入程序会用系统通知提醒一次。关掉 Antigravity，再用 `macos/launch-agy.command` 打开就行。
