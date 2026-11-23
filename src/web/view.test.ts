import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import Fastify from 'fastify'
import { Configuration } from '@/utils/config'
import { WebPush } from '@/utils/web-push'
import { ViewRouter } from './view'

describe('静的ファイルの配信', () => {
  it('リポジトリのルートからダッシュボードとサービスワーカーを取得できる', async () => {
    const app = Fastify()
    const router = new ViewRouter(
      app,
      {} as Configuration,
      {} as WebPush,
      'test-version'
    )
    await router.init()
    try {
      const index = await app.inject({ method: 'GET', url: '/' })
      assert.equal(index.statusCode, 200)
      assert.match(index.headers['content-type'] ?? '', /^text\/html/)
      assert.match(index.body, /test-version/)

      const serviceWorker = await app.inject({ method: 'GET', url: '/sw.js' })
      assert.equal(serviceWorker.statusCode, 200)
      assert.match(
        serviceWorker.headers['content-type'] ?? '',
        /^text\/javascript/
      )
      assert.ok(serviceWorker.body.length > 0)
    } finally {
      await app.close()
    }
  })
})
