import assert from 'node:assert/strict';
import test from 'node:test';
import { projectAvatarColors, projectInitials } from './ProjectAvatar';

test('project avatars are stable and use two-letter initials', () => {
  assert.deepEqual(projectAvatarColors('OpenClaw'), projectAvatarColors('OpenClaw'));
  assert.equal(projectInitials('open-claw'), 'OC');
  assert.equal(projectInitials('JunQi'), 'JU');
});
