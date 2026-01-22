import { TTSEngine, TtsOptions } from '../types'
import WebSocket from 'ws'
import { Readable, PassThrough } from 'stream'
import { randomUUID } from 'crypto'
import { logger } from '../../utils/logger'
import { createWriteStream } from 'fs'

export class CosyVoiceEngine implements TTSEngine {
  name = 'cosyvoice'
  private apiKey: string
  private url = 'wss://dashscope.aliyuncs.com/api-ws/v1/inference'

  constructor(apiKey: string) {
    if (!apiKey) {
      throw new Error('CosyVoice requires an API key.')
    }
    this.apiKey = apiKey
  }

  async synthesize(text: string, options: TtsOptions): Promise<Buffer | Readable> {
    const {
      voice = 'longwan',
      format = 'mp3',
      speed = 1.0,
      volume = 1.0,
      pitch = 1.0,
      stream = false,
      outputType,
      output,
    } = options

    // CosyVoice parameters mapping
    // speed: 0.5 - 2.0
    const cosySpeed = Math.max(0.5, Math.min(2.0, speed))

    // volume: 0 - 100
    // options.volume is usually 0.0-1.0.
    const cosyVolume = Math.round(Math.max(0, Math.min(100, volume * 100))) || 50

    // pitch: 0.5 - 2.0
    // options.pitch is usually -1.0 to 1.0? 
    // We'll just use default 1.0 for now as mapping is unclear and often not needed for high quality TTS.
    const cosyPitch = 1.0

    const outputStream = new PassThrough()
    const audioChunks: Buffer[] = []
    let fileStream: any

    if (outputType === 'file' && output) {
      fileStream = createWriteStream(output)
    }

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'X-DashScope-DataInspection': 'enable',
        },
      })

      const taskId = randomUUID().replace(/-/g, '')

      ws.on('open', () => {
        const runTaskCmd = {
          header: {
            action: 'run-task',
            task_id: taskId,
            streaming: 'duplex',
          },
          payload: {
            task_group: 'audio',
            task: 'tts',
            function: 'SpeechSynthesizer',
            model: 'cosyvoice-v3-plus',
            parameters: {
              text_type: 'PlainText',
              voice: voice.replace('zh-CN-', ''),
              format: format === 'mp3' ? 'mp3' : 'wav',
              sample_rate: 22050,
              volume: cosyVolume,
              rate: cosySpeed,
              pitch: cosyPitch,
            },
            input: {},
          },
        }
        // Monitor: Log run-task command
        logger.info(`[CosyVoice Monitor] Sending run-task command: ${JSON.stringify(runTaskCmd)}`)
        ws.send(JSON.stringify(runTaskCmd))
      })

      ws.on('message', (data, isBinary) => {
        if (isBinary) {
          const buffer = Buffer.from(data as Buffer)
          // Monitor: Log binary data receipt (summary)
          // logger.debug(`[CosyVoice Monitor] Received audio chunk: ${buffer.length} bytes`)
          if (fileStream) {
            fileStream.write(buffer)
          } else if (stream) {
            outputStream.write(buffer)
          } else {
            audioChunks.push(buffer)
          }
        } else {
          try {
            const msg = JSON.parse(data.toString())
            // Monitor: Log received event
            logger.info(
              `[CosyVoice Monitor] Received event: ${msg.header.event}, task_id: ${msg.header.task_id}`
            )
            
            if (msg.header.event === 'task-started') {
              const continueTaskCmd = {
                header: {
                  action: 'continue-task',
                  task_id: taskId,
                  streaming: 'duplex',
                },
                payload: {
                  input: {
                    text: text,
                  },
                },
              }
              // Monitor: Log continue-task command
              logger.info(
                `[CosyVoice Monitor] Sending continue-task command: ${JSON.stringify(continueTaskCmd)}`
              )
              ws.send(JSON.stringify(continueTaskCmd))

              const finishTaskCmd = {
                header: {
                  action: 'finish-task',
                  task_id: taskId,
                  streaming: 'duplex',
                },
                payload: {
                  input: {},
                },
              }
              // Monitor: Log finish-task command
              logger.info(
                `[CosyVoice Monitor] Sending finish-task command: ${JSON.stringify(finishTaskCmd)}`
              )
              ws.send(JSON.stringify(finishTaskCmd))
            } else if (msg.header.event === 'result-generated') {
                // Monitor: Log result generated
                logger.info(`[CosyVoice Monitor] Result generated.`)
            } else if (msg.header.event === 'task-finished') {
              logger.info(`[CosyVoice Monitor] Task finished.`)
              ws.close()
              if (fileStream) {
                fileStream.end()
                resolve(Buffer.alloc(0)) // Return empty buffer when writing to file
              } else if (stream) {
                outputStream.end()
              } else {
                resolve(Buffer.concat(audioChunks))
              }
            } else if (msg.header.event === 'task-failed') {
              ws.close()
              const errorMsg = msg.header.error_message || 'CosyVoice task failed'
              // Monitor: Log task failure details
              logger.error(
                `[CosyVoice Monitor] Task failed! Code: ${msg.header.error_code}, Message: ${errorMsg}`
              )
              const error = new Error(errorMsg)
              if (fileStream) {
                fileStream.destroy(error)
                reject(error)
              } else if (stream) {
                outputStream.emit('error', error)
              } else {
                reject(error)
              }
            }
          } catch (e) {
            logger.error('[CosyVoice Monitor] Error parsing WebSocket message', e)
          }
        }
      })

      ws.on('error', (err) => {
        logger.error('[CosyVoice Monitor] WebSocket error', err)
        if (fileStream) {
          fileStream.destroy(err)
          reject(err)
        } else if (stream) {
          outputStream.emit('error', err)
        } else {
          reject(err)
        }
      })

      if (stream && !fileStream) {
        resolve(outputStream)
      }
    })
  }

  async getSupportedLanguages(): Promise<string[]> {
    return ['zh-CN', 'en-US', 'ja-JP', 'ko-KR', 'yue-CN']
  }

  async getVoiceOptions(): Promise<string[]> {
    return [
      'zh-CN-longwan',
      'zh-CN-longcheng',
      'zh-CN-longhua',
      'zh-CN-longxia',
      'zh-CN-longye',
      'zh-CN-longjue',
      'zh-CN-longshuo',
      'zh-CN-longmiao',
      'zh-CN-longyue',
      'zh-CN-longanyang',
      'zh-CN-longanhuan',
    ]
  }
}
