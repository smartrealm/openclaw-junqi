import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import {
  __resetSessionOrganizationForTests,
  projectSessionOrganization,
  setSessionOrganizationTopic,
} from './sessionOrganization';

const SUBJECT = { key: 'agent:main:conversation', sessionId: 'conversation-id' };

afterEach(() => __resetSessionOrganizationForTests());

describe('session title repository', () => {
  it('binds a renderer-only title cache to the Gateway session identity', () => {
    setSessionOrganizationTopic(SUBJECT, 'Current topic');

    assert.deepEqual(projectSessionOrganization(SUBJECT), { topic: 'Current topic' });
    assert.deepEqual(projectSessionOrganization({ ...SUBJECT, sessionId: 'replacement-id' }), {});
  });

  it('migrates only the legacy title cache once an identity is available', () => {
    localStorage.setItem('aegis:session-pin-prefs', JSON.stringify({ [SUBJECT.key]: true }));
    localStorage.setItem('aegis:session-archive-prefs', JSON.stringify({ [SUBJECT.key]: true }));
    localStorage.setItem('aegis:session-topic-prefs', JSON.stringify({ [SUBJECT.key]: 'Legacy topic' }));

    assert.deepEqual(projectSessionOrganization(SUBJECT), { topic: 'Legacy topic' });
    assert.deepEqual(JSON.parse(localStorage.getItem('aegis:session-topic-prefs') ?? '{}'), {});
    assert.equal(JSON.parse(localStorage.getItem('aegis:session-pin-prefs') ?? '{}')[SUBJECT.key], true);
    assert.equal(JSON.parse(localStorage.getItem('aegis:session-archive-prefs') ?? '{}')[SUBJECT.key], true);
  });

  it('does not persist a title before Gateway provides a session identity', () => {
    const unidentified = { key: SUBJECT.key };
    setSessionOrganizationTopic(unidentified, 'Untitled cache');

    assert.deepEqual(projectSessionOrganization(unidentified), {});
    assert.deepEqual(projectSessionOrganization({ ...unidentified, sessionId: 'later-id' }), {});
  });
});
