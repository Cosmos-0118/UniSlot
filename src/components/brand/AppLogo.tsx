import { cn } from '@/shared/utils/cn'
import { BRAND_ASSET } from '@/shared/brand/paths'

const SIZES = {
  sm: { px: 24, src: BRAND_ASSET.icon48 },
  md: { px: 32, src: BRAND_ASSET.icon48 },
  nav: { px: 36, src: BRAND_ASSET.icon192 },
  lg: { px: 48, src: BRAND_ASSET.icon192 },
  hero: { px: 56, src: BRAND_ASSET.icon192 },
} as const

export type AppLogoSize = keyof typeof SIZES

type AppLogoProps = {
  size?: AppLogoSize
  className?: string
  /**
   * `squircle` matches exported brand PNGs (~22% radius). Use `2xl` for a softer UI-only clip.
   */
  rounded?: 'none' | 'squircle' | '2xl'
}

export function AppLogo({ size = 'md', className, rounded = 'squircle' }: AppLogoProps) {
  const { px, src } = SIZES[size]
  const roundedClass =
    rounded === 'none' ? '' : rounded === '2xl' ? 'rounded-2xl' : 'rounded-[22%]'

  return (
    <img
      src={src}
      width={px}
      height={px}
      alt="UniSlot"
      decoding="async"
      draggable={false}
      className={cn('shrink-0 object-contain select-none', roundedClass, className)}
    />
  )
}
