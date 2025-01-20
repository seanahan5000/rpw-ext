// NOTE: duplicated in rpw-ext/server/src

export type RpwSettings = {
  syntax: string
  upperCase: boolean
  tabSize: number
  tabStops: number[]
}

export const RpwSettingsDefaults = {
  syntax: "merlin",
  upperCase: true,
  tabSize: 4,
  tabStops: [16,20,40]
}

export type RpwModule = {
  src?: string
  lst?: string
  dis65?: string
}

export type RpwImage = {
  name: string
  drive: number
  enabled?: boolean
  readonly?: boolean
}

export type RpwPatch = {
  address: string
  bank?: number
  data: string[]
}

export type RpwBin = {
  name: string
  address?: string              // NOTE: string to allow 0x values
  bank?: number                 // 1 or 2
}

export type RpwPreload = {
  enabled?: boolean             // default: true
  entryPoint?: string           // default: first bin address
  bins: (string | RpwBin)[]
  patches?: RpwPatch[]
}

export type RpwProject = {
  settings?: RpwSettings        // default: RpwSettings defaults
  projectName?: string          // default: <name>.rpw-project
  srcDir?: string
  binDir?: string
  includes?: string[]
  modules?: RpwModule[]
  images?: RpwImage []
  preloads?: RpwPreload[]
}

// TODO: add default fileSuffix? ".S" for merlin, for example
