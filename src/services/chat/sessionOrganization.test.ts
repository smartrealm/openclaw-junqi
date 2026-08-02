import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import {
  __resetSessionOrganizationForTests,
  createSessionOrganizationGroup,
  deleteSessionOrganizationGroup,
  getSessionOrganizationGroups,
  projectSessionOrganization,
  renameSessionOrganizationGroup,
  setSessionOrganizationFlag,
  setSessionOrganizationGroup,
} from './sessionOrganization';

const SUBJECT = { key: 'agent:main:conversation', sessionId: 'conversation-id' };

afterEach(() => __resetSessionOrganizationForTests());

describe('session organization repository', () => {
  it('binds organization state to the Gateway session identity, not a reusable key', () => {
    setSessionOrganizationFlag(SUBJECT, 'pinned', true);
    setSessionOrganizationFlag(SUBJECT, 'unread', true);

    assert.deepEqual(projectSessionOrganization(SUBJECT), {
      pinned: true,
      unread: true,
      archived: false,
    });
    assert.deepEqual(projectSessionOrganization({ ...SUBJECT, sessionId: 'replacement-id' }), {
      pinned: false,
      unread: false,
      archived: false,
    });
  });

  it('migrates legacy key-based preferences once an identity is available', () => {
    localStorage.setItem('aegis:session-pin-prefs', JSON.stringify({ [SUBJECT.key]: true }));
    localStorage.setItem('aegis:session-archive-prefs', JSON.stringify({ [SUBJECT.key]: true }));
    localStorage.setItem('aegis:session-topic-prefs', JSON.stringify({ [SUBJECT.key]: 'Legacy topic' }));

    assert.deepEqual(projectSessionOrganization(SUBJECT), {
      pinned: true,
      unread: false,
      archived: true,
      topic: 'Legacy topic',
    });
    assert.deepEqual(JSON.parse(localStorage.getItem('aegis:session-pin-prefs') ?? '{}'), {});
    assert.deepEqual(JSON.parse(localStorage.getItem('aegis:session-archive-prefs') ?? '{}'), {});
    assert.deepEqual(JSON.parse(localStorage.getItem('aegis:session-topic-prefs') ?? '{}'), {});
  });

  it('does not persist organization state before Gateway provides a session identity', () => {
    const unidentified = { key: SUBJECT.key };
    setSessionOrganizationFlag(unidentified, 'pinned', true);

    assert.deepEqual(projectSessionOrganization(unidentified), {
      pinned: false,
      unread: false,
      archived: false,
    });
    assert.deepEqual(projectSessionOrganization({ ...unidentified, sessionId: 'later-id' }), {
      pinned: false,
      unread: false,
      archived: false,
    });
  });

  it('creates, renames, assigns, and deletes a group without deleting its sessions', () => {
    const group = createSessionOrganizationGroup('Active work');
    assert.ok(group);
    assert.equal(renameSessionOrganizationGroup(group.id, 'Current work')?.label, 'Current work');
    assert.equal(setSessionOrganizationGroup(SUBJECT, group.id).groupId, group.id);
    assert.deepEqual(getSessionOrganizationGroups().map((item) => item.label), ['Current work']);

    deleteSessionOrganizationGroup(group.id);
    assert.equal(projectSessionOrganization(SUBJECT).groupId, undefined);
    assert.deepEqual(getSessionOrganizationGroups(), []);
  });
});
