import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, before, beforeEach, describe, it, mock } from 'node:test'
import webpush, { WebPushError } from 'web-push'
import { Subscription, WebPush } from './web-push'

const DESTINATION = 'test-destination'

function createSubscription(name: string): Subscription {
  return {
    destinationName: DESTINATION,
    endpoint: `https://push.example.com/${name}`,
    expirationTime: null,
    keys: { p256dh: 'p256dh', auth: 'auth' },
  }
}

function createPushError(statusCode: number): WebPushError {
  return new WebPushError(
    'push failed',
    statusCode,
    {},
    '',
    'https://push.example.com/'
  )
}

function createNetworkError(code: string): Error {
  return Object.assign(new Error(code), { code })
}

/**
 * web-push の sendNotification を、呼び出しごとに指定した結果で差し替える。
 * 結果が Error なら reject、数値ならそのステータスコードで resolve する。
 */
function mockSend(results: (number | Error)[]) {
  let index = 0
  return mock.method(webpush, 'sendNotification', () => {
    const result = results[Math.min(index, results.length - 1)]
    index++
    return result instanceof Error
      ? Promise.reject(result)
      : Promise.resolve({ statusCode: result, body: '', headers: {} })
  })
}

function writeSubscriptions(names: string[]) {
  fs.writeFileSync(
    process.env.WEB_PUSH_SUBSCRIPTIONS_PATH ?? '',
    JSON.stringify(
      names.map((name) => createSubscription(name)),
      null,
      2
    )
  )
}

describe('WebPush', () => {
  let directory: string
  let subscriptionsPath: string
  let webPush: WebPush
  const body = 'body'

  before(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'telcheck-web-push-'))
    process.env.WEB_PUSH_KEY_PATH = path.join(directory, 'web-push-key.json')
    subscriptionsPath = path.join(directory, 'subscriptions.json')
    process.env.WEB_PUSH_SUBSCRIPTIONS_PATH = subscriptionsPath
    process.env.WEB_PUSH_EMAIL = 'test@example.com'
    webPush = WebPush.getInstance()
  })

  beforeEach(() => {
    fs.writeFileSync(
      subscriptionsPath,
      JSON.stringify([createSubscription('a')], null, 2)
    )
  })

  afterEach(() => {
    mock.restoreAll()
  })

  describe('sendNotifications', () => {
    it('201 の場合は正常終了する', async () => {
      mockSend([201])
      await webPush.sendNotifications(DESTINATION, 'title', body)
    })

    it('5xx の場合は reject する', async () => {
      mockSend([createPushError(503)])
      await assert.rejects(
        webPush.sendNotifications(DESTINATION, 'title', body),
        /Failed to send web push notification/
      )
    })

    it('429 の場合は reject する', async () => {
      mockSend([createPushError(429)])
      await assert.rejects(
        webPush.sendNotifications(DESTINATION, 'title', body)
      )
    })

    it('通信エラーの場合は reject する', async () => {
      for (const code of ['ECONNRESET', 'EHOSTUNREACH', 'UND_ERR_SOCKET']) {
        mockSend([createNetworkError(code)])
        await assert.rejects(
          webPush.sendNotifications(DESTINATION, 'title', body)
        )
        mock.restoreAll()
      }
    })

    it('5xx の後に再試行が成功した場合は正常終了する', async () => {
      mockSend([createPushError(500), 201])
      await assert.rejects(
        webPush.sendNotifications(DESTINATION, 'title', body)
      )
      await webPush.sendNotifications(DESTINATION, 'title', body)
    })

    it('404 / 410 の場合は購読を削除して正常終了する', async () => {
      for (const statusCode of [404, 410]) {
        fs.writeFileSync(
          subscriptionsPath,
          JSON.stringify([createSubscription('a')], null, 2)
        )
        mockSend([createPushError(statusCode)])
        await webPush.sendNotifications(DESTINATION, 'title', body)
        assert.deepEqual(webPush.getSubscriptions(), [])
        mock.restoreAll()
      }
    })

    it('恒久的な 4xx の場合は正常終了し、購読は削除しない', async () => {
      mockSend([createPushError(400)])
      await webPush.sendNotifications(DESTINATION, 'title', body)
      assert.equal(webPush.getSubscriptions().length, 1)
    })

    it('通信と無関係なエラーの場合は正常終了する', async () => {
      mockSend([new Error('Vapid subject is not a valid URL')])
      await webPush.sendNotifications(DESTINATION, 'title', body)
      mock.restoreAll()
      mockSend([createNetworkError('ERR_INVALID_ARG_TYPE')])
      await webPush.sendNotifications(DESTINATION, 'title', body)
    })

    it('複数購読のうち 1 つが一時的に失敗しても、全購読へ送信してから reject する', async () => {
      writeSubscriptions(['a', 'b', 'c'])
      const send = mockSend([201, createPushError(502), 201])
      await assert.rejects(
        webPush.sendNotifications(DESTINATION, 'title', body)
      )
      assert.equal(send.mock.callCount(), 3)
    })

    it('再送時は送信済みの購読へ重複して送信しない', async () => {
      writeSubscriptions(['a', 'b', 'c'])
      const endpoints: string[] = []
      mock.method(
        webpush,
        'sendNotification',
        (subscription: { endpoint: string }) => {
          endpoints.push(subscription.endpoint)
          return subscription.endpoint.endsWith('/b') && endpoints.length <= 3
            ? Promise.reject(createPushError(503))
            : Promise.resolve({ statusCode: 201, body: '', headers: {} })
        }
      )
      const delivered = new Set<string>()
      await assert.rejects(
        webPush.sendNotifications(DESTINATION, 'title', body, delivered)
      )
      await webPush.sendNotifications(DESTINATION, 'title', body, delivered)
      // 1 回目: a, b, c / 2 回目: 失敗した b のみ
      assert.deepEqual(
        endpoints.map((endpoint) => endpoint.slice(-1)),
        ['a', 'b', 'c', 'b']
      )
    })

    it('同じ内容でも、別の通話 (別の送信済み Set) の通知は全購読へ送信する', async () => {
      writeSubscriptions(['a', 'b'])
      const endpoints: string[] = []
      mock.method(
        webpush,
        'sendNotification',
        (subscription: { endpoint: string }) => {
          endpoints.push(subscription.endpoint)
          return subscription.endpoint.endsWith('/b') && endpoints.length <= 2
            ? Promise.reject(createPushError(503))
            : Promise.resolve({ statusCode: 201, body: '', headers: {} })
        }
      )
      // 通話 A: a は成功、b は一時的に失敗し、そのまま再送されずに終わる
      await assert.rejects(
        webPush.sendNotifications(DESTINATION, 'title', body, new Set())
      )
      // 通話 B: 同じタイトル・本文でも a・b の両方へ送信される
      await webPush.sendNotifications(DESTINATION, 'title', body, new Set())
      assert.deepEqual(
        endpoints.map((endpoint) => endpoint.slice(-1)),
        ['a', 'b', 'a', 'b']
      )
    })

    it('購読が 0 件の場合は何も送信せず正常終了する', async () => {
      fs.writeFileSync(subscriptionsPath, '[]')
      const send = mockSend([201])
      await webPush.sendNotifications(DESTINATION, 'title', body)
      assert.equal(send.mock.callCount(), 0)
    })
  })

  describe('sendNotification', () => {
    const subscription = createSubscription('a')

    it('成功時は実際のステータスコードを返す', async () => {
      mockSend([201])
      assert.equal(await webPush.sendNotification(subscription, '{}'), 201)
    })

    it('404 / 410 はそのステータスコードを返す', async () => {
      mockSend([createPushError(410)])
      assert.equal(await webPush.sendNotification(subscription, '{}'), 410)
    })

    it('その他の失敗は 500 を返す', async () => {
      mockSend([createPushError(400)])
      assert.equal(await webPush.sendNotification(subscription, '{}'), 500)
      mock.restoreAll()
      mockSend([createNetworkError('ETIMEDOUT')])
      assert.equal(await webPush.sendNotification(subscription, '{}'), 500)
    })
  })
})
