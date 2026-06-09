import { toolRegistry } from './tool-registry'
import {
  executeImageEdit,
  executeImageGenerate,
  executeImageVariation,
  type ImageEditArgs,
  type ImageGenerateArgs,
  type ImageVariationArgs
} from './image-tools'

// requiresApproval is false, but these tools DO gate: each carries the
// `network` risk, and the dispatcher (see descriptorNeedsApproval) routes any
// tool with a network/destructive/secret risk through the approval service.
// So an image call prompts for approval (or matches a persisted `network`
// policy) before it runs. The handler additionally returns
// `Error: No image generation provider configured` when no key is present, so
// an unconfigured install fails informatively instead of dispatching.
const SIZE_ENUM = ['1024x1024', '1024x1536', '1536x1024', 'auto'] as const
const QUALITY_ENUM = ['low', 'medium', 'high', 'auto'] as const

toolRegistry.registerNative(
  {
    id: 'image_generate',
    name: 'image_generate',
    title: 'Image: Generate',
    description:
      'Generate a new image from a text prompt using the configured image provider (default: OpenAI gpt-image-1). The PNG bytes are written into the userData artifacts/images directory and the absolute path is returned. Requires an image generation provider configured in Settings -> Image Generation.',
    providerKind: 'native',
    providerId: 'internal',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'Text description of the image to generate.'
        },
        size: {
          type: 'string',
          enum: [...SIZE_ENUM],
          description:
            'Output canvas size. Defaults to "1024x1024". "auto" lets the provider pick.'
        },
        quality: {
          type: 'string',
          enum: [...QUALITY_ENUM],
          description:
            'Optional render quality hint for gpt-image-1. Defaults to provider default.'
        }
      },
      required: ['prompt'],
      additionalProperties: false
    },
    risks: ['network', 'write'],
    requiresApproval: false,
    enabled: true
  },
  async (args) => executeImageGenerate(args as unknown as ImageGenerateArgs)
)

toolRegistry.registerNative(
  {
    id: 'image_edit',
    name: 'image_edit',
    title: 'Image: Edit',
    description:
      'Edit an existing image with a text prompt and an optional mask. The input image (and mask, if provided) must be a local PNG/JPG/WEBP file no larger than 25 MB. The edited result is saved into userData artifacts/images and its absolute path is returned. Requires an image generation provider configured in Settings.',
    providerKind: 'native',
    providerId: 'internal',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'Text describing the edit to apply to the image.'
        },
        image_path: {
          type: 'string',
          description:
            'Absolute path to the source image. PNG, JPG, or WEBP up to 25 MB.'
        },
        mask_path: {
          type: 'string',
          description:
            'Optional path to a mask PNG. Transparent pixels mark the region to edit.'
        },
        size: {
          type: 'string',
          enum: [...SIZE_ENUM],
          description: 'Output canvas size. Defaults to "1024x1024".'
        }
      },
      required: ['prompt', 'image_path'],
      additionalProperties: false
    },
    risks: ['network', 'write', 'read'],
    requiresApproval: false,
    enabled: true
  },
  async (args, ctx) =>
    executeImageEdit(args as unknown as ImageEditArgs, ctx.workspacePath ?? process.cwd())
)

toolRegistry.registerNative(
  {
    id: 'image_variation',
    name: 'image_variation',
    title: 'Image: Variation',
    description:
      "Generate variation(s) of an existing image. Uses OpenAI's dall-e-2 model (the only OpenAI model with a variations endpoint). Up to 4 variations per call. Each variation is saved into userData artifacts/images and the absolute paths are returned comma-separated. Requires an image generation provider configured in Settings.",
    providerKind: 'native',
    providerId: 'internal',
    inputSchema: {
      type: 'object',
      properties: {
        image_path: {
          type: 'string',
          description:
            'Absolute path to the source image. PNG, JPG, or WEBP up to 25 MB.'
        },
        size: {
          type: 'string',
          enum: [...SIZE_ENUM],
          description: 'Output canvas size. Defaults to "1024x1024".'
        },
        n: {
          type: 'number',
          description: 'Number of variations to produce. Default 1, max 4.'
        }
      },
      required: ['image_path'],
      additionalProperties: false
    },
    risks: ['network', 'write', 'read'],
    requiresApproval: false,
    enabled: true
  },
  async (args, ctx) =>
    executeImageVariation(
      args as unknown as ImageVariationArgs,
      ctx.workspacePath ?? process.cwd()
    )
)
