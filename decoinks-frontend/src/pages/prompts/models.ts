// The models the studio can be pointed at.
//
// A registry rather than a table: the parameters a provider takes, their ranges
// and what each one is good for are facts about the provider, not about this
// shop, so they belong with the code that renders them. Adding a provider is
// one entry here — the version stores whatever it holds in a JSON bag, so no
// migration is needed for a model with parameters nobody has met yet.

export type ParamKey =
  | 'guidance_scale' | 'inference_steps' | 'reference_strength'
  | 'seed_mode' | 'temperature' | 'safety_mode'
  | 'image_size' | 'num_outputs' | 'quality'
  | 'use_lora' | 'lora_model' | 'lora_weight'

export interface ModelSpec {
  id: string
  type: string
  maxResolution?: string
  supportsLora: boolean
  bestFor: string
  /** Which parameter groups this model actually takes. */
  params: ParamKey[]
  imageSizes?: string[]
  loraModels?: string[]
  recommended: string[]
  defaults: Record<string, unknown>
}

export interface ProviderSpec {
  name: string
  models: ModelSpec[]
}

export const PROVIDERS: ProviderSpec[] = [
  {
    name: 'Flux',
    models: [
      {
        id: 'Flux.1-dev',
        type: 'Image Generation',
        maxResolution: '1536 × 1536',
        supportsLora: true,
        bestFor: 'High quality, detailed artwork with strong reference similarity.',
        params: ['use_lora', 'lora_model', 'lora_weight', 'image_size', 'num_outputs', 'quality',
                 'guidance_scale', 'inference_steps', 'reference_strength', 'seed_mode',
                 'temperature', 'safety_mode'],
        imageSizes: ['1024 × 1024 (Square)', '1024 × 1536 (Vertical)', '1536 × 1024 (Horizontal)', '1536 × 1536 (Large Square)'],
        loraModels: ['Decoinks-Portrait-v6'],
        recommended: [
          'Use high reference strength for accurate reconstruction.',
          'Keep temperature low (0.1 – 0.3) for consistency.',
          'Use LoRA for faces and detailed artwork.',
          'Generate multiple outputs (3–4) for best results.',
          'Use 1024 × 1536 for vertical artwork.',
        ],
        defaults: {
          image_size: '1024 × 1536 (Vertical)', num_outputs: 4, quality: 'High',
          guidance_scale: 7.5, inference_steps: 28, reference_strength: 0.8,
          seed_mode: 'Random', safety_mode: 'Standard', use_lora: false, lora_weight: 0.75,
        },
      },
    ],
  },
  {
    name: 'OpenAI',
    models: [
      {
        id: 'GPT-5.5',
        type: 'Text Generation',
        supportsLora: false,
        bestFor: 'Reading a brief, planning a job and writing structured instructions.',
        params: ['temperature'],
        recommended: [
          'Keep temperature low (0.1 – 0.3) when the output is parsed by the system.',
          'Set a max token limit so a runaway answer cannot stall a job.',
        ],
        defaults: {},
      },
    ],
  },
]

export const QUALITY_LEVELS = ['Draft', 'Standard', 'High', 'Maximum']
export const SEED_MODES = ['Random', 'Fixed']
export const SAFETY_MODES = ['Off', 'Standard', 'Strict']

export const providerNamed = (name?: string | null) =>
  PROVIDERS.find(p => p.name === name) ?? PROVIDERS[0]

export const modelNamed = (provider?: string | null, model?: string | null) => {
  const p = providerNamed(provider)
  return p.models.find(m => m.id === model) ?? p.models[0]
}

export const takes = (spec: ModelSpec, key: ParamKey) => spec.params.includes(key)
