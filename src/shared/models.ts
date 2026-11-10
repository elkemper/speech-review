import type { ModelId } from './types'

export interface ModelSpec {
  id: ModelId
  label: string
  shortLabel: string
  file: string
  size: number
  sha256: string
  url: string
  note: string
}

const BASE = 'https://huggingface.co/audio-cpp/audio.cpp-gguf/resolve/main/CrisperWhisper2.0-GGUF'

export const MODEL_SPECS: Record<ModelId, ModelSpec> = {
  q8_0: {
    id: 'q8_0',
    label: 'CrisperWhisper 2.0 Large · Q8_0',
    shortLabel: 'Q8_0',
    file: 'crisperwhisper-2-large-q8_0.gguf',
    size: 1716306528,
    sha256: '392e636876d6d5ae8716f0f98b78480b61bb8c199d63f20523e95308b3425c2e',
    url: `${BASE}/crisperwhisper-2-large-q8_0.gguf`,
    note: 'Рекомендуемый баланс качества и скорости'
  },
  bf16: {
    id: 'bf16',
    label: 'CrisperWhisper 2.0 Large · BF16',
    shortLabel: 'BF16',
    file: 'crisperwhisper-2-large-bf16.gguf',
    size: 3092563712,
    sha256: '7f2ddc0fc5a419441fcf2be713696cc5d6bcd8a8db65b4acbea4879534e47c1b',
    url: `${BASE}/crisperwhisper-2-large-bf16.gguf`,
    note: 'Максимальное качество, больше памяти и места'
  },
  q4_k: {
    id: 'q4_k',
    label: 'CrisperWhisper 2.0 Large · Q4_K',
    shortLabel: 'Q4_K',
    file: 'crisperwhisper-2-large-q4_k.gguf',
    size: 982302624,
    sha256: '13399e818dfe966e613dc0ba3db73d27bf9dd23ff63d7d946c77c75dd0ee1913',
    url: `${BASE}/crisperwhisper-2-large-q4_k.gguf`,
    note: 'Самый лёгкий вариант, качество ниже'
  }
}

export const MODEL_ORDER: ModelId[] = ['q8_0', 'bf16', 'q4_k']

export function getModelSpec(id: ModelId): ModelSpec {
  return MODEL_SPECS[id]
}
