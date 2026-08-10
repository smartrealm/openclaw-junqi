import assert from 'node:assert/strict';
import test from 'node:test';
import {
  approveSelectedGatewayDevice,
  cancelDwsOperation,
  clearPersistentNotifications,
  createOpenClawMediaPreviewUrl,
  finishTalkPlayback,
  getGatewayRuntimeSnapshot,
  getOpenclawChannelCapabilities,
  getOpenclawChannelCatalog,
  getOpenclawChannelLogs,
  getOpenclawChannelStatus,
  getPersistentNotifications,
  markPersistentNotificationRead,
  markPersistentNotificationsRead,
  openGatewayControlUi,
  playTalkPcm,
  probeSelectedGateway,
  pushPersistentNotification,
  restartGateway,
  signGatewayDeviceChallenge,
  startDwsOperation,
  startGateway,
  startVoiceCapture,
  stopGateway,
  stopTalkPlayback,
  stopVoiceCapture,
  type GatewayDeviceChallengeParams,
} from './tauri-commands';
import {
  deleteAgentProfile,
  loadAgentProfiles,
  saveAgentProfile,
} from '@/services/agentProfiles';

type TauriInvocation = {
  command: string;
  args: unknown;
};

type TauriInternals = {
  invoke?: (command: string, args?: unknown) => Promise<unknown>;
};

const tauriWindow = globalThis.window as Window & { __TAURI_INTERNALS__?: TauriInternals };

const gatewayStatus = {
  running: true,
  port: 18789,
  pid: null,
  token: null,
};

async function captureTauriInvocations<T>(
  resultFor: (command: string, args: unknown) => unknown,
  run: (calls: TauriInvocation[]) => Promise<T>,
): Promise<T> {
  const previous = tauriWindow.__TAURI_INTERNALS__;
  const calls: TauriInvocation[] = [];
  tauriWindow.__TAURI_INTERNALS__ = {
    ...previous,
    invoke: async (command, args) => {
      calls.push({ command, args });
      return resultFor(command, args);
    },
  };
  try {
    return await run(calls);
  } finally {
    tauriWindow.__TAURI_INTERNALS__ = previous;
  }
}

test('Gateway 生命周期包装器保留选定运行时的命令与参数语义', async () => {
  await captureTauriInvocations(
    (command) => {
      if (command === 'get_gateway_runtime_snapshot') {
        return { lifecycle: 'running', mode: 'managed_child', restarting: false, port: 18789, managed_pid: null };
      }
      if (command === 'probe_selected_gateway') return true;
      if (command === 'stop_gateway') return undefined;
      return gatewayStatus;
    },
    async (calls) => {
      assert.deepEqual(await startGateway(), gatewayStatus);
      assert.deepEqual(await startGateway(19000), gatewayStatus);
      assert.deepEqual(await restartGateway(), gatewayStatus);
      assert.deepEqual(await restartGateway(19000), gatewayStatus);
      assert.equal(await probeSelectedGateway(), true);
      assert.equal(await probeSelectedGateway(19000), true);
      await stopGateway();
      assert.deepEqual(await getGatewayRuntimeSnapshot(), {
        lifecycle: 'running',
        mode: 'managed_child',
        restarting: false,
        port: 18789,
        managed_pid: null,
      });
      assert.deepEqual(calls, [
        { command: 'start_gateway', args: {} },
        { command: 'start_gateway', args: { port: 19000 } },
        { command: 'restart_gateway', args: {} },
        { command: 'restart_gateway', args: { port: 19000 } },
        { command: 'probe_selected_gateway', args: {} },
        { command: 'probe_selected_gateway', args: { port: 19000 } },
        { command: 'stop_gateway', args: {} },
        { command: 'get_gateway_runtime_snapshot', args: {} },
      ]);
    },
  );
});

test('智能体资料包装器保留独立持久化命令和字段边界', async () => {
  const profile = { domain: 'research', scope: 'internal tools' };
  await captureTauriInvocations(
    (command) => {
      if (command === 'load_agent_profiles') return { research: profile };
      if (command === 'save_agent_profile') return profile;
      return undefined;
    },
    async (calls) => {
      assert.deepEqual(await loadAgentProfiles(), { research: profile });
      assert.deepEqual(await saveAgentProfile({
        agentId: ' research ',
        domain: ' research ',
        scope: ' internal tools ',
      }), profile);
      await deleteAgentProfile(' research ');
      assert.deepEqual(calls, [
        { command: 'load_agent_profiles', args: {} },
        {
          command: 'save_agent_profile',
          args: { agent_id: 'research', domain: 'research', scope: 'internal tools' },
        },
        { command: 'delete_agent_profile', args: { agent_id: 'research' } },
      ]);
    },
  );
});

test('设备签名和钉钉操作保持网关身份与操作标识的嵌套边界', async () => {
  const signatureParams: GatewayDeviceChallengeParams = {
    nonce: 'nonce-1',
    signedAt: 1_700_000_000_000,
    clientId: 'junqi-desktop',
    clientMode: 'desktop',
    role: 'operator',
    scopes: ['operator.admin'],
    token: 'session-token',
    platform: 'darwin',
    deviceFamily: 'desktop',
  };
  await captureTauriInvocations(
    (command) => {
      if (command === 'sign_gateway_device_challenge') {
        return {
          deviceId: 'device-1',
          publicKey: 'public-key-1',
          signature: 'signature-1',
          signedAt: signatureParams.signedAt,
          nonce: signatureParams.nonce,
        };
      }
      if (command === 'start_dws_operation') {
        return { operationId: 'operation-1', kind: 'authorize' };
      }
      return undefined;
    },
    async (calls) => {
      assert.equal((await signGatewayDeviceChallenge(signatureParams)).signature, 'signature-1');
      await approveSelectedGatewayDevice('request-1');
      assert.deepEqual(
        await startDwsOperation('runtime-1', 'connection-1', 'authorize'),
        { operationId: 'operation-1', kind: 'authorize' },
      );
      await cancelDwsOperation('runtime-1', 'connection-1', 'operation-1');
      assert.deepEqual(calls, [
        { command: 'sign_gateway_device_challenge', args: { params: signatureParams } },
        { command: 'approve_selected_gateway_device', args: { requestId: 'request-1' } },
        {
          command: 'start_dws_operation',
          args: {
            targetFingerprint: 'runtime-1',
            expectedConnectionId: 'connection-1',
            kind: 'authorize',
          },
        },
        {
          command: 'cancel_dws_operation',
          args: {
            targetFingerprint: 'runtime-1',
            expectedConnectionId: 'connection-1',
            operationId: 'operation-1',
          },
        },
      ]);
    },
  );
});

test('官方渠道包装器不重写不透明响应，并明确传递默认查询参数', async () => {
  const catalog = { channels: [{ id: 'dingtalk' }] };
  await captureTauriInvocations(
    (command) => command === 'get_openclaw_channel_catalog' ? catalog : { ok: true },
    async (calls) => {
      assert.equal(await getOpenclawChannelCatalog(), catalog);
      await getOpenclawChannelCapabilities('dingtalk');
      await getOpenclawChannelStatus();
      await getOpenclawChannelStatus('dingtalk', true);
      await getOpenclawChannelLogs();
      await getOpenclawChannelLogs('dingtalk', 20);
      assert.deepEqual(calls, [
        { command: 'get_openclaw_channel_catalog', args: {} },
        { command: 'get_openclaw_channel_capabilities', args: { channel: 'dingtalk' } },
        { command: 'get_openclaw_channel_status', args: { channel: null, probe: false } },
        { command: 'get_openclaw_channel_status', args: { channel: 'dingtalk', probe: true } },
        { command: 'get_openclaw_channel_logs', args: { channel: null, lines: 200 } },
        { command: 'get_openclaw_channel_logs', args: { channel: 'dingtalk', lines: 20 } },
      ]);
    },
  );
});

test('持久通知包装器保留空值和批量标记语义', async () => {
  const listed = { notifications: [], unreadCount: 0 };
  const ids = ['notice-1', 'notice-2'] as const;
  await captureTauriInvocations(
    (command) => {
      if (command === 'get_notifications') return listed;
      if (command === 'push_notification') {
        return { item: { id: 'notice-1' }, inserted: true };
      }
      return undefined;
    },
    async (calls) => {
      assert.equal(await getPersistentNotifications(), listed);
      assert.equal((await pushPersistentNotification({
        level: 'info',
        title: '标题',
        body: '正文',
      })).inserted, true);
      await markPersistentNotificationRead('notice-1');
      await markPersistentNotificationsRead(ids);
      await markPersistentNotificationsRead();
      await clearPersistentNotifications(ids);
      await clearPersistentNotifications();
      assert.deepEqual(calls, [
        { command: 'get_notifications', args: {} },
        {
          command: 'push_notification',
          args: {
            level: 'info',
            title: '标题',
            body: '正文',
            url: null,
            agent: null,
            dedupeKey: null,
          },
        },
        { command: 'mark_notification_read', args: { id: 'notice-1' } },
        { command: 'mark_all_notifications_read', args: { ids: ['notice-1', 'notice-2'] } },
        { command: 'mark_all_notifications_read', args: {} },
        { command: 'clear_notifications', args: { ids: ['notice-1', 'notice-2'] } },
        { command: 'clear_notifications', args: {} },
      ]);
    },
  );
});

test('原生语音与媒体预览包装器验证响应并保留运行时参数', async () => {
  await captureTauriInvocations(
    (command) => {
      if (command === 'voice_capture_start') {
        return { ownerId: 'owner-1', listening: true, reused: false };
      }
      if (command === 'voice_capture_stop') {
        return { ownerId: 'owner-1', listening: false, stopped: true, reused: false };
      }
      if (command === 'voice_talk_play_pcm') return { queued: false };
      if (command === 'create_openclaw_media_preview_url') {
        return { success: true, url: 'asset://preview', error: null };
      }
      return undefined;
    },
    async (calls) => {
      await assert.rejects(startVoiceCapture('', { sampleRateHz: 24_000, channels: 1 }), /owner/);
      assert.deepEqual(
        await startVoiceCapture('owner-1', { sampleRateHz: 24_000, channels: 1 }),
        { ownerId: 'owner-1', listening: true, stopped: null, reused: false },
      );
      assert.deepEqual(
        await stopVoiceCapture('owner-1'),
        { ownerId: 'owner-1', listening: false, stopped: true, reused: false },
      );
      assert.equal(
        await playTalkPcm('AA==', { sampleRateHz: 24_000, channels: 1 }),
        'overflow',
      );
      await finishTalkPlayback();
      await stopTalkPlayback();
      assert.deepEqual(await createOpenClawMediaPreviewUrl('/runtime/attachment.png'), {
        success: true,
        url: 'asset://preview',
        error: null,
      });
      await openGatewayControlUi();
      assert.deepEqual(calls, [
        {
          command: 'voice_capture_start',
          args: { ownerId: 'owner-1', sampleRateHz: 24_000, channels: 1 },
        },
        { command: 'voice_capture_stop', args: { ownerId: 'owner-1' } },
        {
          command: 'voice_talk_play_pcm',
          args: { audioBase64: 'AA==', sampleRateHz: 24_000, channels: 1 },
        },
        { command: 'voice_talk_finish_playback', args: {} },
        { command: 'voice_talk_stop_playback', args: {} },
        {
          command: 'create_openclaw_media_preview_url',
          args: { path: '/runtime/attachment.png' },
        },
        { command: 'open_control_ui', args: {} },
      ]);
    },
  );
});
