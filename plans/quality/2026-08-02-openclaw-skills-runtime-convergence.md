# OpenClaw 技能运行时出口收敛实施计划

1. 从当前安装 OpenClaw 的协议文档、TypeBox schema 与 handler 源码确认技能 methods、
   参数、返回字段及权限。
2. 新建 Gateway 技能运行时服务，集中 status/search/detail 解析与 update/install 管理员调用。
3. 将共享 skills store 和技能页面切换到该服务，删除空实现 adapter 与无契约 UI 操作。
4. 为解析与权限路径添加回归测试，执行类型检查、定向测试和差异检查。
5. 在已授权 Gateway 桌面环境验证搜索、详情、安装及风险确认提示。

后续官方 ZIP 归档上传的分块、SHA-256 和 `source: "upload"` 安装见
`2026-08-03-openclaw-skills-upload.md`，不回写本计划的历史文件范围。
