# Agent Note: 用 ztask init 持久化 npm 全局 PATH

Status: implemented

[English](2026-11-07-ztask-init-path.en.md) | 中文

## Problem

`npm install -g ztask` 会把可执行 shim 放进 npm 的全局目录（POSIX 为 `<prefix>/bin`，Windows 为前缀本身）。很多环境没有把这个目录加入 PATH，于是安装成功却运行 `ztask serve` 时提示找不到命令。用户需要一个一次性命令把目录写进 PATH；子进程本身无法修改父 shell 的环境变量，因此必须落到持久化配置。

## Decision

新增 `ztask init`：用 `npm prefix --global` 解析全局前缀并计算可执行目录；若目录已在 PATH 中则直接成功退出。POSIX 下按 `$SHELL` 选择启动文件（zsh → `~/.zshrc`，bash → `~/.bashrc`，fish → `~/.config/fish/config.fish`，其它 → `~/.profile`），追加带 `# ztask init` 标记的 PATH 配置块，并打印当前终端可用的 `source`/`fish_add_path` 命令；Windows 下用 PowerShell 读取并更新当前用户 PATH。已有配置或 PATH 已包含时不重复写入；npx/npm run 会把自身 bin 目录前置到子进程 PATH，这类调用不据此跳过持久化，改为检查启动文件。若全局目录里找不到 ztask shim，提示先 `npm install -g ztask`。

## Alternatives considered

- 只打印 `export PATH=...` 让用户手动粘贴：改动最小，但用户明确要求"执行这个命令就能加到 PATH"，手动步骤容易出错且不持久，否决。
- 在 `/usr/local/bin` 等既有 PATH 目录建 symlink：通常需要 sudo，且会与 nvm/Volta 等多 Node 版本环境冲突，否决。
- 用 `setx PATH` 更新 Windows 环境变量：会截断超长 PATH，并可能把系统与用户变量合并后写回用户作用域，否决；改用 PowerShell 只改用户作用域。
- 让 init 重新执行 `npm install -g`：没解决 PATH 根因，还引入网络与重复安装，否决。

## Consequences

- init 会持久修改用户的 shell 启动文件或 Windows 用户 PATH；只追加带标记的块，重复执行幂等，用户可自行删除。
- 启动文件按 `$SHELL` 推断，非常规 shell 需要用户按打印的提示手动配置；已打开的终端必须重开或 source 才能生效。
- 仅通过 npx 临时运行、没有全局安装时，init 只提示安装而不会自动安装，避免替用户改动全局包。
- Windows 分支依赖 PowerShell；脚本失败时打印手动指引并以非零退出码结束。
