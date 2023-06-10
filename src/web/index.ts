import fastify from 'fastify'
import cors from '@fastify/cors'
import { ApiRouter } from './api'
import { BaseRouter } from './base-router'
import { Configuration } from '@/utils/config'
import { WebPush } from '@/utils/web-push'
import { Logger } from '@book000/node-utils'
import { ViewRouter } from './view'
import fastifyBasicAuth from '@fastify/basic-auth'

export async function buildWebApp(config: Configuration, webPush: WebPush) {
  const logger = Logger.configure('buildWebApp')

  const app = fastify()
  app.register(cors, {
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
  })

  const basicAuthUsername = config.web?.auth?.username
  const basicAuthPassword = config.web?.auth?.password
  if (basicAuthUsername && basicAuthPassword) {
    app.register(fastifyBasicAuth, {
      validate: (username, password, _request, _reply, done) => {
        if (username === basicAuthUsername && password === basicAuthPassword) {
          done()
          return
        }
        done(new Error('Invalid username or password'))
      },
      authenticate: true,
    })
  }

  // routers
  const routers: BaseRouter[] = [
    new ApiRouter(app, config, webPush),
    new ViewRouter(app, config, webPush),
  ]

  for (const router of routers) {
    logger.info(`⏩ Initializing route: ${router.constructor.name}`)
    router.init()
  }

  return app
}
