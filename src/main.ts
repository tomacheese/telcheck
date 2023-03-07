import { Checked } from './utils/checked'
import {
  CallDetail,
  Configuration,
  IDestination,
  loadConfig,
} from './utils/config'
import { getDestination } from './utils/destination'
import { Logger } from '@book000/node-utils'
import { NVR510, SyslogCall } from './utils/nvr510'
import {
  GoogleSearchResult,
  isGoogleSearchResult,
  isPhoneDetail,
  PhoneDetailResult,
  searchNumber,
} from './utils/search-number'

function getDirectionText(direction: SyslogCall['direction']): string {
  switch (direction) {
    case 'incoming': {
      return '着信'
    }
    case 'outgoing': {
      return '発信'
    }
    default: {
      return 'UNKNOWN'
    }
  }
}

function getStatusText(
  status: SyslogCall['status'],
  direction: SyslogCall['direction']
): string {
  switch (status) {
    case 'connected': {
      return '通話中'
    }
    case 'disconnected': {
      return '切断'
    }
    case 'connecting': {
      return direction === 'incoming' ? '着信中' : '発信中'
    }
    default: {
      return 'UNKNOWN'
    }
  }
}

function getCallerName(callerResult: PhoneDetailResult) {
  if (!callerResult || !isPhoneDetail(callerResult)) {
    return '不明'
  }
  return callerResult.name
}

function getIDestination(
  config: Configuration,
  detail: CallDetail
): IDestination | null {
  const destination = config.destinations.find((d) =>
    Object.entries(d.condition).every(
      // @ts-ignore
      ([key, value]) => new RegExp(value).test(detail[key])
    )
  )
  if (destination) {
    return destination
  }
  return null
}

function getSelfName(config: Configuration, detail: CallDetail): string {
  const self = config.selfs.find((d) =>
    Object.entries(d.condition).every(
      // @ts-ignore
      ([key, value]) => new RegExp(value).test(detail[key])
    )
  )
  if (self) {
    return self.name
  }
  return 'UNKNOWN'
}

function getNotGoogleSearchMessage(
  connectedText: string,
  directionText: string,
  callerNumber: string,
  callerName: string,
  source: string,
  selfName: string
): string {
  return [
    `☎ **【${connectedText}】${directionText} \`${callerName}\` (\`${callerNumber}\`)**`,
    '',
    `**ソース**: ${source}`,
    `**対象名**: ${selfName}`,
  ].join('\n')
}

function getGoogleSearchMessage(
  connectedText: string,
  directionText: string,
  callerNumber: string,
  callerName: string,
  source: string,
  selfName: string,
  googleResult: GoogleSearchResult
) {
  const googleResults = googleResult.items.map(
    (item, index) => `#${index + 1} \`${item.title}\` ${item.url}`
  )
  return [
    `☎ **【${connectedText}】${directionText} \`${callerName}\` (\`${callerNumber}\`)**`,
    '',
    ...googleResults,
    '',
    `**ソース**: \`${source}\``,
    `**対象名**: \`${selfName}\``,
  ].join('\n')
}

async function main() {
  const logger = Logger.configure('main')
  logger.info('✨ main()')
  const config = loadConfig()
  const isFirst = Checked.isFirst()

  const nvr510 = new NVR510(
    config.router.ip,
    config.router.username,
    config.router.password
  )

  const calls = await nvr510.getCallsFromSyslog()
  const filteredCalls = calls.filter(
    (call) => !Checked.isChecked(call.date, call.time)
  )
  logger.info(
    `📞 calls: ${calls.length}, filteredCalls: ${filteredCalls.length}`
  )
  for (const call of filteredCalls.reverse()) {
    const directionText = getDirectionText(call.direction)
    const connectedText = getStatusText(call.status, call.direction)

    logger.info(
      `📞 ${directionText} ${call.fromNumber} -> ${call.toNumber} (${connectedText})`
    )

    // 着信だったら、toNumber、発信だったら、fromNumber がこっち側の番号
    const selfNumber =
      call.direction === 'incoming' ? call.toNumber : call.fromNumber
    // 着信だったら、fromNumber、発信だったら、toNumber が相手側の番号
    const callerNumber =
      call.direction === 'incoming' ? call.fromNumber : call.toNumber

    const callerResult = await searchNumber(config, callerNumber)

    const callDetail = {
      direction: call.direction,
      selfNumber,
      callerNumber,
      status: call.status,
    }
    const selfName = getSelfName(config, callDetail)
    const destinationConfig = getIDestination(config, callDetail)
    const destination = destinationConfig
      ? getDestination(destinationConfig)
      : null

    const callerName = getCallerName(callerResult)
    const source = callerResult ? callerResult.source : '不明'

    const message = isGoogleSearchResult(callerResult)
      ? getGoogleSearchMessage(
          connectedText,
          directionText,
          callerNumber,
          callerName,
          source,
          selfName,
          callerResult
        )
      : getNotGoogleSearchMessage(
          connectedText,
          directionText,
          callerNumber,
          callerName,
          source,
          selfName
        )

    if (!isFirst && destination) {
      await destination.send(message)
    }

    Checked.check(call.date, call.time)
  }
}

;(async () => {
  await main()
})()
