import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { IDestination } from './config'
import { DeliveryTracker } from './delivery'
import { getDestination, sanitizeErrorMessage } from './destination'

describe('sanitizeErrorMessage', () => {
  it('設定の文字列値と URL 形式の文字列を伏せ字にする', () => {
    const config = {
      type: 'discord-bot',
      token: 'FAKE-BOT-TOKEN',
      channel_id: '123456789',
      name: 'D',
      condition: {},
    } as unknown as IDestination

    const message = sanitizeErrorMessage(
      new Error(
        'failed with FAKE-BOT-TOKEN at https://example.invalid/hook/OTHER-SECRET?x=1'
      ),
      config
    )

    assert.equal(message, 'failed with [REDACTED] at [REDACTED_URL]')
  })

  it('短い設定値 (チャンネル ID など) は秘密値として扱わず、伏せ字にしない', () => {
    const config = {
      type: 'discord-bot',
      token: 'FAKE-BOT-TOKEN',
      channel_id: '1234',
      name: 'D',
      condition: {},
    } as unknown as IDestination

    assert.equal(
      sanitizeErrorMessage(new Error('channel 1234 not found'), config),
      'channel 1234 not found'
    )
  })

  it('name / type は伏せ字にしない', () => {
    const config = {
      type: 'slack',
      webhook_url: 'https://example.invalid/secret',
      name: 'MyDestination',
      condition: {},
    } as unknown as IDestination

    assert.equal(
      sanitizeErrorMessage(new Error('MyDestination slack failed'), config),
      'MyDestination slack failed'
    )
  })

  it('Error 以外の値も文字列にして扱う', () => {
    const config = {
      type: 'slack',
      webhook_url: 'https://example.invalid/secret',
      name: 'S',
      condition: {},
    } as unknown as IDestination

    assert.equal(
      sanitizeErrorMessage('https://example.invalid/secret', config),
      '[REDACTED]'
    )
  })
})

describe('getDestination', () => {
  it('実際の URL 解析エラーでも、Webhook URL の秘密値をエラーに含めない', async () => {
    const config = {
      type: 'slack',
      // ポート番号が不正で、fetch() が URL 全体を含む解析エラーを投げる
      webhook_url: 'https://hooks.slack.com:bad/services/FAKE-SECRET-TOKEN',
      name: 'S',
      condition: {},
    } as unknown as IDestination

    await assert.rejects(
      getDestination(config).send('message'),
      (error: Error) => {
        assert.ok(!error.message.includes('FAKE-SECRET-TOKEN'))
        assert.ok(!(error.stack ?? '').includes('FAKE-SECRET-TOKEN'))
        assert.equal(error.cause, undefined)
        return true
      }
    )
  })

  it('DeliveryTracker 経由で失敗しても、投げられるエラーに秘密値を含めない', async () => {
    const config = {
      type: 'slack',
      webhook_url: 'https://hooks.slack.com:bad/services/FAKE-SECRET-TOKEN',
      name: 'S',
      condition: {},
    } as unknown as IDestination

    await assert.rejects(
      new DeliveryTracker().deliver('call', [getDestination(config)], () =>
        Promise.resolve('message')
      ),
      (error: Error) => !error.message.includes('FAKE-SECRET-TOKEN')
    )
  })
})
