import { FastifyReply, FastifyRequest } from 'fastify'
import { BaseRouter } from './base-router'

export class ApiRouter extends BaseRouter {
  init(): void {
    this.fastify.register(
      (fastify, _, done) => {
        fastify
          .get('/vapidPublicKey', this.routeGetVapidPublicKey.bind(this))
          .addHook('onRequest', fastify.basicAuth)
        fastify
          .get('/destinations', this.routeGetDestinations.bind(this))
          .addHook('onRequest', fastify.basicAuth)
        fastify
          .post('/subscribe', this.routePostSubscribe.bind(this))
          .addHook('onRequest', fastify.basicAuth)
        fastify
          .delete('/subscribe', this.routeDeleteSubscribe.bind(this))
          .addHook('onRequest', fastify.basicAuth)
        done()
      },
      { prefix: '/api' }
    )
  }

  private routeGetVapidPublicKey() {
    return {
      vapidPublicKey: this.webPush.getBase64PublicKey(),
    }
  }

  private routeGetDestinations() {
    const destinations = this.config.destinations
      .filter((d) => d.type === 'web-push')
      .map((d) => d.name)
    return {
      destinations,
    }
  }

  private async routePostSubscribe(
    request: FastifyRequest<{
      Body: {
        destinationName: string
        endpoint: string
        expirationTime: number | null
        keys: {
          p256dh: string
          auth: string
        }
      }
    }>,
    reply: FastifyReply
  ) {
    const subscription = request.body
    await this.webPush.addSubscription(subscription)

    const statusCode = await this.webPush.sendNotification(
      subscription,
      JSON.stringify({
        title: '購読完了',
        body: `購読が完了しました。${subscription.destinationName} の通知をお届けします。`,
      })
    )
    reply.code(statusCode).send()
  }

  private async routeDeleteSubscribe(
    request: FastifyRequest<{
      Body: {
        destinationName: string
        endpoint: string
        expirationTime: number | null
        keys: {
          p256dh: string
          auth: string
        }
      }
    }>,
    reply: FastifyReply
  ) {
    const subscription = request.body
    const result = await this.webPush.removeSubscription(subscription)
    reply.code(result ? 200 : 404).send()
  }
}
