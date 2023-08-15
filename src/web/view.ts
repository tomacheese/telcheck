import { FastifyRequest, FastifyReply } from 'fastify'
import { BaseRouter } from './base-router'
import fs from 'node:fs'
import { Logger } from '@book000/node-utils'

export class ViewRouter extends BaseRouter {
  init(): void {
    this.fastify.register((fastify, _, done) => {
      fastify.get('/*', this.routeGet.bind(this))
      done()
    })
  }

  private routeGet(
    request: FastifyRequest<{
      Params: { path: string }
    }>,
    reply: FastifyReply,
  ) {
    let path = request.url
    if (path.includes('?')) {
      path = path.split('?')[0]
    }
    if (path === '') {
      path = 'index.html'
    }
    if (path.includes('..')) {
      reply.code(404).send()
      return
    }
    if (path.endsWith('/')) {
      path += 'index.html'
    }
    const logger = Logger.configure('routeGet')
    logger.info(`⏩ Serving file: ${path}`)
    if (!fs.existsSync(`./public/${path}`)) {
      reply.code(404).send()
      return
    }

    const extension = path.split('.').pop() || ''
    const contentTypes: {
      [key: string]: string
    } = {
      html: 'text/html',
      js: 'text/javascript',
      css: 'text/css',
      png: 'image/png',
      jpg: 'image/jpeg',
      icon: 'image/x-icon',
      json: 'application/json',
    }
    reply.header('Content-Type', contentTypes[extension] || 'text/plain')
    if (extension === 'html') {
      reply.send(
        fs
          .readFileSync(`./public/${path}`)
          .toString()
          .replaceAll('{{VERSION}}', this.version),
      )
      return
    }
    reply.send(fs.readFileSync(`./public/${path}`))
  }
}
