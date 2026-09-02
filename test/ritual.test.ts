import { test } from 'node:test';
import assert from 'node:assert/strict';
import { protocolBody } from '../src/protocol.ts';

test('the protocol pins the named approval shapes', () => {
  const body = protocolBody('unslopped');
  assert.match(body, /approve commit --subject="<the proposed title>"/);
  assert.match(body, /approve deploy --for="<cycle id and goal>"/);
});

test('the protocol pins the show-then-prompt ritual', () => {
  const body = protocolBody('unslopped');
  assert.match(body, /last thing in your message/);
  assert.match(body, /first action of the following turn/);
});
