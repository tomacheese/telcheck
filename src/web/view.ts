import { FastifyRequest, FastifyReply } from 'fastify'
import { BaseRouter } from './base-router'
import fs from 'node:fs'
import pathModule from 'node:path'
import { Logger } from '@book000/node-utils'

export class ViewRouter extends BaseRouter {
  async init(): Promise<void> {
    await this.fastify.register((fastify, _, done) => {
      fastify.get('/*', this.routeGet.bind(this))
      done()
    })
  }

  private async routeGet(
    request: FastifyRequest<{
      Params: { path: string }
    }>,
    reply: FastifyReply
  ) {
    let path = request.url
    if (path.includes('?')) {
      path = path.split('?', 1)[0]
    }
    if (path === '') {
      path = 'index.html'
    }
    if (path.includes('..')) {
      await reply.code(404).send()
      return
    }
    if (path.endsWith('/')) {
      path += 'index.html'
    }
    const logger = Logger.configure('routeGet')
    logger.info(`⏩ Serving file: ${path}`)
    // tsx は package.json の設定に従って CommonJS として実行する。
    // eslint-disable-next-line unicorn/prefer-module
    const filePath = pathModule.join(__dirname, '../public', path)
    if (!fs.existsSync(filePath)) {
      await reply.code(404).send()
      return
    }

    const extension = path.split('.').pop() ?? ''
    const contentTypes: Record<string, string> = {
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
      await reply.send(
        fs
          .readFileSync(filePath)
          .toString()
          .replaceAll('{{VERSION}}', () => this.version)
      )
      return
    }
    await reply.send(fs.readFileSync(filePath))
  }
}
