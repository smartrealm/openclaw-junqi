import assert from 'node:assert/strict';
import test from 'node:test';
import { groupOpenClawCommands } from './commandGroups';

test('运行时命令导航只按 Gateway 返回的类别分组，并保留无类别命令', () => {
  const groups = groupOpenClawCommands([
    { name: 'status', description: '状态', category: 'status', source: 'native', scope: 'both', acceptsArgs: false },
    { name: 'help', description: '帮助', source: 'native', scope: 'both', acceptsArgs: false },
    { name: 'tools', description: '工具', category: 'tools', source: 'plugin', scope: 'text', acceptsArgs: false },
  ]);

  assert.deepEqual(groups.map((group) => [group.id, group.commands.map((command) => command.name)]), [
    ['status', ['status']],
    ['uncategorized', ['help']],
    ['tools', ['tools']],
  ]);
});
