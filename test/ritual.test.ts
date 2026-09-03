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

test('no phase row tells the human to run approve or forbids the assistant', () => {
  const body = protocolBody('unslopped');
  const rows = body.split('\n').filter((l) => l.startsWith('| deploy') || l.startsWith('| release'));
  const joined = rows.join('\n');
  assert.doesNotMatch(joined, /tell the human to run/);
  assert.doesNotMatch(joined, /Never run approve yourself/);
  assert.doesNotMatch(joined, /ask the human to run `unslopped approve/);
  assert.match(joined, /run `unslopped approve deploy/);
});
