import { ttsPluginManager } from '../pluginManager'
import { EdgeTtsEngine } from './edgeTts'
import { OpenAITtsEngine } from './openaiTts'
import { KokoroTtsEngine } from './kokoroTts'
import { CosyVoiceEngine } from './cosyVoice'
import {
  REGISTER_KOKORO,
  REGISTER_OPENAI_TTS,
  TTS_KOKORO_URL,
  REGISTER_COSYVOICE,
  COSYVOICE_API_KEY,
} from '../../config'

export function registerEngines() {
  ttsPluginManager.registerEngine(new EdgeTtsEngine())
  if (REGISTER_OPENAI_TTS) {
    ttsPluginManager.registerEngine(new OpenAITtsEngine(process.env.OPENAI_API_KEY!))
  }
  if (REGISTER_KOKORO) {
    ttsPluginManager.registerEngine(new KokoroTtsEngine(TTS_KOKORO_URL))
  }
  if (REGISTER_COSYVOICE && COSYVOICE_API_KEY) {
    ttsPluginManager.registerEngine(new CosyVoiceEngine(COSYVOICE_API_KEY))
  }
}
