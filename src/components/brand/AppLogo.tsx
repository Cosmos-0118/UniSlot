import { cn } from '@/shared/utils/cn'
import { BRAND_ASSET } from '@/shared/brand/paths'

const SIZES = {
  sm: { px: 24, src: BRAND_ASSET.logo48 },
  md: { px: 32, src: BRAND_ASSET.logo48 },
  nav: { px: 36, src: BRAND_ASSET.logo96 },
  lg: { px: 48, src: BRAND_ASSET.logo96 },
  hero: { px: 56, src: BRAND_ASSET.logo192 },
} as const

export type AppLogoSize = keyof typeof SIZES

type AppLogoProps = {
  size?: AppLogoSize
  className?: string
  /**
   * UI logos are pre-clipped squircles with transparent corners.
   * Use `squircle` only if you need an extra CSS clip on a non-brand asset.
   */
  rounded?: 'none' | 'squircle' | '2xl'
}

export function AppLogo({ size = 'md', className, rounded = 'none' }: AppLogoProps) {
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
      className={cn(
        'app-logo shrink-0 object-contain select-none',
        roundedClass,
        className,
      )}
    />
  )
}
