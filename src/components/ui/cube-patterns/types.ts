/** One cell’s appearance in HSL space + vertical lift (px-ish scale). */
export type PatternSample = {
  lift: number
  hue: number
  sat: number
  light: number
}

export type PatternContext = {
  col: number
  row: number
  cols: number
  rows: number
  /** Seconds since pattern mount / global clock */
  t: number
  reduced: boolean
}

export type CubePattern = {
  /** Stable id for debugging */
  id: string
  /** Short label */
  title: string
  sample: (ctx: PatternContext) => PatternSample
}
