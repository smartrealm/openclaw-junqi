# Collaboration Bootstrap Package 子域拆分规格

日期：2026-08-03

## 验收条件

- 包验证模块拒绝相对路径、非 tgz、空包、超限包、危险 entry、缺失或错误 manifest。
- package name、plugin id、package/manifest version 和 OpenClaw entry 必须精确匹配。
- 预期 SHA-256 与实际归档内容必须一致；bundled metadata 必须同时匹配编译内嵌值和资源文件。
- package verification 不执行安装、配置写入、Gateway 重启或 recovery。

## 非目标

- 不新增技能、插件或 OpenClaw RPC。
- 不改变安装 staging、配置 journal 或恢复证据的路径和生命周期。
- 不把资源目录或当前开发机的全局包作为隐式 fallback。
