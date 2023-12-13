
export type RpwSettings = {
  syntax?: string
  upperCase?: boolean
  tabSize?: number
  tabStops?: number[]
}

export type RpwBin = {
  fileName: string
  addr?: number
}

export type RpwModule = {
  src?: string
  lst?: string
  bins?: RpwBin
}

export type RpwDbug = {
  start: number
  preloads?: RpwBin[]
}

export type RpwProject = {
  settings: RpwSettings
  srcDir?: string
  binDir?: string
  includes?: string[]
  modules?: RpwModule[]
  dbug?: RpwDbug
}

// TODO: add default fileSuffix? ".S" for merlin, for example
