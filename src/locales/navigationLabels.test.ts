import assert from 'node:assert/strict';
import test from 'node:test';
import zh from './zh.json';
import en from './en.json';

test('agent run and Agent tasks have distinct navigation labels', () => {
  assert.notEqual(zh.nav.agentRun, zh.nav.agentTasks);
  assert.notEqual(en.nav.agentRun, en.nav.agentTasks);
  assert.equal(zh.nav.agentTasks, 'Agent 任务');
  assert.equal(en.nav.agentTasks, 'Agent Tasks');
});

test('the legacy welcome route is named as a project launcher', () => {
  assert.equal(zh.nav.agentWorkspace, '项目启动');
  assert.equal(en.nav.agentWorkspace, 'Project launcher');
});

test('the tool entry identifies the OpenClaw-native tool surface', () => {
  assert.equal(zh.nav.openClawTools, 'OpenClaw 工具');
  assert.equal(en.nav.openClawTools, 'OpenClaw Tools');
  assert.equal(zh.activity.openClawToolsHint, '查看 OpenClaw 工具');
});

test('the workbench model service label stays concise', () => {
  assert.equal(zh['sidebar.nav.models'], '模型服务');
  assert.equal(en['sidebar.nav.models'], 'Models');
  assert.equal(zh.config.addModelService, '添加模型服务');
});

test('OpenClaw runtime command catalog has localized navigation and state labels', () => {
  assert.equal(zh.nav.openclawCommands, 'OpenClaw 命令');
  assert.equal(en.nav.openclawCommands, 'OpenClaw Commands');
  assert.equal(zh.openclawCommands.title, 'OpenClaw 运行时命令');
  assert.equal(en.openclawCommands.title, 'OpenClaw Runtime Commands');
  assert.equal(zh.openclawCommands.unavailable, '当前 OpenClaw Gateway 未提供运行时命令目录。');
  assert.equal(en.openclawCommands.unavailable, 'The current OpenClaw Gateway does not provide a runtime command catalog.');
});

test('agent hub view labels remain localized in Chinese', () => {
  assert.equal(zh.agents.subtitle, '所有智能体及活跃工作者一览');
  assert.equal(zh.agents.workers, '活跃工作者');
  assert.equal(zh.agentHub.spawnLink, '派生关系');
  assert.equal(zh.agentHubExtra.activityView, '活动');
  assert.equal(zh.agentHubExtra.workersCount, '工作者');
  assert.equal(zh.agentSettings.workspace, '工作区');
  assert.equal(zh.agentSettings.lastActivity, '最后活动');
});

test('git and terminal secondary UI labels remain localized in Chinese', () => {
  assert.equal(zh.gitPage.title, 'Git 管理');
  assert.equal(zh.gitPage.selectFile, '从变更面板选择文件以查看差异。');
  assert.equal(zh.terminal.moveToNewWindow, '移至新窗口');
  assert.equal(zh.terminal.resizePane, '拖动调整大小');
});

test('legacy settings dialog has Chinese labels for visible controls', () => {
  assert.equal(zh.appSettings.sendPromptShortcut, '发送消息快捷键');
  assert.equal(zh.appSettings.saveReconnect, '保存并重新连接');
  assert.equal(zh.appSettings.shiftEnterNewline, 'Shift+Enter 插入换行');
});

test('session playback controls have Chinese labels', () => {
  assert.equal(zh.sessionPlayback.title, '会话回放');
  assert.equal(zh.sessionPlayback.copyAllMarkdown, '复制全部为 Markdown');
  assert.equal(zh.sessionPlayback.loadFailed, '加载会话失败');
});
