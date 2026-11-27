import test from 'node:test';
import assert from 'node:assert/strict';
import { describeEmailActionFailure, readEmailAction, submitEmailAction } from '../../services/emailActions';

test('reconhece links de ação sem usar destinos ou configurações da URL', () => {
  assert.equal(readEmailAction(''), null);
  assert.equal(readEmailAction('?mode=compact'), null);
  assert.deepEqual(readEmailAction('?mode=verifyEmail&oobCode=test-code&continueUrl=https://example.invalid&apiKey=test'), { mode: 'verifyEmail', code: 'test-code' });
  assert.deepEqual(readEmailAction('?mode=verifyEmail'), { mode: 'invalid' });
  assert.deepEqual(readEmailAction('?mode=unknown&oobCode=test-code'), { mode: 'invalid' });
  assert.deepEqual(readEmailAction('?mode=verifyEmail&oobCode=A&oobCode=B'), { mode: 'invalid' });
});

const email = 'test@example.invalid';
function mockAction(operation: string, address = email) {
  const calls: string[] = [];
  return {
    calls,
    services: {
      async inspect(code: string) { calls.push('inspect:' + code); return { operation, data: { email: address } }; },
      isAllowedEmail: (value: string | null | undefined) => value === email,
      async apply(code: string) { calls.push('apply:' + code); },
      async reset(code: string) { calls.push('reset:' + code); },
    },
  };
}

test('abrir o link não aplica o código, que só é enviado após a confirmação', async () => {
  const { services, calls } = mockAction('VERIFY_EMAIL');
  const action = readEmailAction('?mode=verifyEmail&oobCode=A');
  assert.deepEqual(calls, []);
  assert.ok(action && action.mode !== 'invalid');
  await submitEmailAction(action, services);
  assert.deepEqual(calls, ['inspect:A', 'apply:A']);
});

test('bloqueia códigos de outra operação ou de outra conta antes de aplicar', async () => {
  for (const { services, calls } of [mockAction('PASSWORD_RESET'), mockAction('VERIFY_EMAIL', 'another@example.invalid')]) {
    await assert.rejects(submitEmailAction({ mode: 'verifyEmail', code: 'A' }, services), { code: 'pilotis/wrong-email-action' });
    assert.deepEqual(calls, ['inspect:A']);
  }
});

test('o manipulador compartilhado mantém redefinição e recuperação', async () => {
  const reset = mockAction('PASSWORD_RESET');
  await submitEmailAction({ mode: 'resetPassword', code: 'A' }, reset.services, 'a-test-password');
  assert.deepEqual(reset.calls, ['inspect:A', 'reset:A']);
  const recover = mockAction('RECOVER_EMAIL');
  await submitEmailAction({ mode: 'recoverEmail', code: 'B' }, recover.services);
  assert.deepEqual(recover.calls, ['inspect:B', 'apply:B']);
});

test('distingue erro de link e falha que permite outra tentativa', () => {
  const expired = describeEmailActionFailure({ code: 'auth/expired-action-code' });
  const invalid = describeEmailActionFailure({ code: 'auth/invalid-action-code' });
  const network = describeEmailActionFailure({ code: 'auth/network-request-failed' });
  assert.match(expired.message, /expirou/);
  assert.match(invalid.message, /já foi usado/);
  assert.equal(expired.checkVerification, true);
  assert.equal(invalid.checkVerification, true);
  assert.equal(network.retryable, true);
});
