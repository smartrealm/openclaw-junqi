import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolveComposerEnterAction,
  resolveComposerPrimaryAction,
  resolveComposerQueueMode,
} from './composerPrimaryAction';

test('单一主操作位覆盖空闲、运行和有效队列模式', () => {
  assert.deepEqual(resolveComposerPrimaryAction({
    hasContent: false,
    responseActive: false,
    sendDisabled: false,
  }), { kind: 'send', label: 'send', disabled: true });
  assert.deepEqual(resolveComposerPrimaryAction({
    hasContent: true,
    responseActive: false,
    sendDisabled: false,
  }), { kind: 'send', label: 'send', disabled: false });
  assert.deepEqual(resolveComposerPrimaryAction({
    hasContent: false,
    responseActive: true,
    sendDisabled: true,
  }), { kind: 'stop', label: 'stop', disabled: false });

  for (const [effectiveQueueMode, label] of [
    ['steer', 'steer'],
    ['followup', 'queue'],
    ['collect', 'queue'],
    ['interrupt', 'interrupt'],
  ] as const) {
    assert.deepEqual(resolveComposerPrimaryAction({
      hasContent: true,
      responseActive: true,
      sendDisabled: false,
      effectiveQueueMode,
    }), { kind: 'send', label, disabled: false });
  }
});

test('未知队列模式不改变普通发送语义', () => {
  assert.deepEqual(resolveComposerPrimaryAction({
    hasContent: true,
    responseActive: true,
    sendDisabled: false,
  }), { kind: 'send', label: 'send', disabled: false });
});

test('会话显式队列模式优先于有效默认模式', () => {
  assert.equal(resolveComposerQueueMode({
    queueMode: 'followup',
    effectiveQueueMode: 'steer',
  }), 'followup');
  assert.equal(resolveComposerQueueMode({ effectiveQueueMode: 'collect' }), 'collect');
  assert.equal(resolveComposerQueueMode({}), undefined);
});

test('Enter 决策保留换行和输入法，并只在活动运行中允许显式转向', () => {
  assert.equal(resolveComposerEnterAction({ key: 'Enter', shiftKey: true }), 'none');
  assert.equal(resolveComposerEnterAction({ key: 'Enter', composing: true }), 'none');
  assert.equal(resolveComposerEnterAction({ key: 'Enter' }), 'send');
  assert.equal(resolveComposerEnterAction({ key: 'Enter', responseActive: false, metaKey: true }), 'send');
  assert.equal(resolveComposerEnterAction({ key: 'Enter', responseActive: true, metaKey: true }), 'steer');
  assert.equal(resolveComposerEnterAction({ key: 'Enter', responseActive: true, ctrlKey: true }), 'steer');
  assert.equal(resolveComposerEnterAction({ key: 'a', responseActive: true, ctrlKey: true }), 'none');
});
