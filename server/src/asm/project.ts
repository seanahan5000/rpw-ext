
import * as fs from 'fs'
import { RpwProject, RpwSettings, RpwDefine, RpwBin } from "../shared/rpw_types"
import { Syntax, SyntaxMap } from "./syntaxes/syntax_types"
import { SyntaxDefs } from "./syntaxes/syntax_defs"
import { Statement } from "./statements"
import { Parser } from "./parser"
import { Assembler } from "./assembler"
import { Symbol, SymbolType, SymbolFrom } from "./symbols"
import { SymbolExpression, NumberExpression } from "./expressions"
import { ObjectDoc, DataRange, RangeMatch } from "./object_doc"
import { LspDebugger } from "../lsp_debugger"

function fixBackslashes(inString: string): string {
  return inString.replace(/\\/g, '/')
}

export type SymbolMap = Map<string, Symbol>

//------------------------------------------------------------------------------

export class SourceFile {

  public project: Project
  public fullPath: string     // fully specified path and name
  public isShared: boolean
  public modules: Module[] = []
  public lines: string[]
  public statements: Statement[] = []
  // TODO: displayName for progress/error messages?

  constructor(module: Module, fullPath: string, isShared: boolean, lines: string[]) {
    this.project = module.project
    this.fullPath = fullPath
    this.lines = lines
    this.isShared = isShared
    this.modules.push(module)
  }

  public getSymbolMap(): SymbolMap {
    // for now, just return the first module that references source file
    return this.modules[0].symbolMap
  }

  public parseStatements(syntaxStats: number[]): Statement[] {
    // only parse the statements the first time the file is included
    // TODO: This is intended for shared files but could be a problem
    //  for normal source files included multiple times.
    if (!this.statements.length) {
      const parser = new Parser()
      this.statements = parser.parseStatements(this, this.lines, syntaxStats)
    }
    return this.statements
  }
}

//------------------------------------------------------------------------------

export class Project {

  private rpwProject?: RpwProject
  private defaultSettings?: RpwSettings
  private inferredSyntax = Syntax.UNKNOWN

  public syntax = Syntax.UNKNOWN
  public syntaxDef = SyntaxDefs[Syntax.UNKNOWN]
  public upperCase: boolean = true
  public tabSize = 4
  public tabStops = [0, 16, 20, 40]
  public caseSensitive?: boolean    // overrides syntax definition

  public defines: RpwDefine[] = []
  public includes: string[] = []    // NOTE: shared files, not include paths
  public modules: Module[] = []

  public rootDir = "."
  public srcDir: string = ""
  public binDir: string = ""

  public includePaths: string[] = []
  public isTemporary = false
  public inWorkspace = false

  constructor(defaultSettings: RpwSettings) {
    this.defaultSettings = defaultSettings
    this.settingsChanged()
  }

  loadProject(extRootDir: string, rpwProject: RpwProject, isTemporary = false, inWorkspace = false): boolean {

    this.isTemporary = isTemporary
    this.inWorkspace = inWorkspace

    let rootDir = fixBackslashes(extRootDir)
    if (rootDir.endsWith("/")) {
      rootDir = rootDir.substring(0, rootDir.length - 1)
    }
    if (rootDir.length > 0) {
      this.rootDir = rootDir
    }

    this.rpwProject = rpwProject
    this.settingsChanged()

    // rootDir + / + rpwProject.srcDir
    this.srcDir = this.buildFullDirName(rpwProject.srcDir)
    this.binDir = this.buildFullDirName(rpwProject.binDir)

    if (rpwProject.defines) {
      for (let define of rpwProject.defines) {
        this.defines.push({ name: define.name, value: define.value })
      }
    }

    if (rpwProject.includes) {
      for (let include of rpwProject.includes) {
        let incName = fixBackslashes(include)
        if (incName[0] == "/") {
          incName = incName.substring(1)
        }
        let fullIncName = this.srcDir + "/" + incName
        // TODO: generalize for all platforms (this is merlin-only)
        // TODO: call through an overridable method
        if (!fs.existsSync(fullIncName)) {
          fullIncName = fullIncName + ".S"
          if (!fs.existsSync(fullIncName)) {
            continue
          }
        }
        this.includes.push(fullIncName)
      }
    }

    // Build a list of all directories in the workspace
    //  and use that as a fake include list for temporary projects.
    if (this.isTemporary && this.inWorkspace) {
      this.getDirectories(rootDir, this.includePaths)
    }

    if (!rpwProject.modules) {
      return false
    }
    for (let module of rpwProject.modules) {
      if (module.enabled ?? true) {
        if (module.src) {

          let srcPath = ""
          let srcName = fixBackslashes(module.src)

          const lastSlash = srcName.lastIndexOf("/")
          if (lastSlash != -1) {
            srcPath = srcName.substring(0, lastSlash)
            srcName = srcName.substring(lastSlash + 1)
            if (srcPath.indexOf("/") != 0) {
              srcPath = "/" + srcPath
            }
            if (srcPath == "/") {
              srcPath = ""
            }
          }

          // check for wildcards in src property
          // (only supported at beginning of name)
          if (srcName.startsWith("*")) {
            const suffix = srcName.substring(1)
            const dirPath = cleanPath(this.srcDir + srcPath)
            const dirList = fs.readdirSync(dirPath)
            for (let fileName of dirList) {
              if (fileName.endsWith(suffix)) {
                this.modules.push(new Module(this, srcPath, fileName))
              }
            }
          } else {
            const saveName = module.save
            this.modules.push(new Module(this, srcPath, srcName, saveName))
          }
        }
      }
    }
    return true
  }

  // TODO: This should be done once when the workspace directory
  //  is known, and only updated if workspace directory changes.
  private getDirectories(path: string, list: string[]) {
    const cleanPath = fixBackslashes(path)
    list.push(cleanPath)
    const files = fs.readdirSync(cleanPath)
    for (let file of files) {
      const fullName = cleanPath + "/" + file
      if (fs.lstatSync(fullName).isDirectory()) {
        this.getDirectories(fullName, list)
      }
    }
  }

  settingsChanged(newDefaultSettings?: RpwSettings) {

    if (newDefaultSettings) {
      this.defaultSettings = newDefaultSettings
    }

    const defaults = this.defaultSettings
    const settings = this.rpwProject?.settings

    const syntaxName = settings?.syntax ?? defaults?.syntax
    if (syntaxName) {
      const syntax = SyntaxMap.get(syntaxName.toUpperCase())
      if (!syntax) {
        throw new Error("Unknown syntax: " + syntaxName)
      }
      this.syntax = syntax
    } else {
      this.syntax = this.inferredSyntax
    }
    this.syntaxDef = SyntaxDefs[this.syntax]

    this.upperCase = settings?.upperCase ?? defaults?.upperCase ?? true
    this.tabSize = settings?.tabSize ?? defaults?.tabSize ?? 4
    this.tabStops = settings?.tabStops ?? defaults?.tabStops ?? [0, 16, 20, 40]
    if (this.tabStops[0] != 0) {
      this.tabStops.unshift(0)
    }

    // optional override, not a hard setting
    this.caseSensitive = settings?.caseSensitive
  }

  update() {
    while (true) {
      const syntaxStats = new Array(SyntaxDefs.length).fill(0)

      // build temporary module of shared/common headers and symbols
      const preMod = new Module(this, "", "precompiled")

      // turn external defines into symbols
      const settingsMap = new Map<string, Symbol>
      for (let define of this.defines) {
        const symExp = new SymbolExpression([], SymbolType.Simple, true)
        const numExp = new NumberExpression([], define.value ?? 1, false)
        symExp.symbol!.setValue(numExp, SymbolFrom.Define)
        symExp.fullName = define.name
        settingsMap.set(define.name, symExp.symbol!)
      }

      // precompile include files
      const precompFiles: string[] = []
      const pathLength = (this.srcDir + "/").length
      for (let incFile of this.includes) {
        precompFiles.push(incFile.substring(pathLength))
      }

      // disable includes mechanism while prepare includes files
      preMod.update_pass01(settingsMap, undefined, precompFiles, syntaxStats)
      preMod.update_pass2()

      // assemble first pass using precompiled files/symbols
      for (let module of this.modules) {
        module.update_pass01(preMod.symbolMap, preMod.sourceFiles, [module.srcName], syntaxStats)
      }

      // choose syntax based on number of keywords matched
      if (this.syntax == Syntax.UNKNOWN) {
        let bestMatch = Syntax.UNKNOWN
        let bestCount = -1
        for (let i = 1; i < syntaxStats.length; i += 1) {
          if (syntaxStats[i] > bestCount) {
            bestCount = syntaxStats[i]
            bestMatch = i
          } else if (syntaxStats[i] == bestCount) {
            if (bestMatch == Syntax.MERLIN && i == Syntax.LISA) {
              // ties between MERLIN and LISA go to MERLIN
            } else {
              // ignore ties
              bestMatch = Syntax.UNKNOWN
            }
          }
        }
        if (bestMatch != Syntax.UNKNOWN) {
          this.inferredSyntax = bestMatch
          this.settingsChanged()
          continue
        }
      }

      // build single map of exports from all modules, checking for dupes
      const fullExportMap = new Map<string, Symbol>
      for (let module of this.modules) {
        for (let [name, symbol] of module.exportMap) {
          const foundSym = fullExportMap.get(name)
          if (foundSym) {
            symbol.definition.setError("Duplicate export")
            symbol.definition.setIsReference(foundSym)
            continue
          }
          fullExportMap.set(name, symbol)
        }
      }

      // resolve all imports from fullExportMap, reporting unknown symbols
      for (let module of this.modules) {
        for (let [name, symbol] of module.importMap) {
          const foundSym = fullExportMap.get(name)
          if (!foundSym) {
            symbol.definition.setError("External symbol not found")
            continue
          }

          // relink all references on import symbol to exported symbol
          while (symbol.references.length) {
            const symExp = symbol.references.pop()
            symExp?.setIsReference(foundSym)
          }
          symbol.definition.setIsReference(foundSym)
        }
      }

      // complete final passes of assembly

      for (let module of this.modules) {
        // write all output data
        module.update_pass2()
      }

      for (let module of this.modules) {
        module.update_finalize()
      }

      break
    }
  }

  // overridden to get contents from elsewhere
  getFileContents(fullPath: string): string | undefined {
    if (fs.existsSync(fullPath)) {
      if (fs.lstatSync(fullPath).isFile()) {
        return fs.readFileSync(fullPath, 'utf8')
      }
    }
  }

  // path here is relative to the srcDir
  getFileLines(fullPath: string): string[] | undefined {
    let text = this.getFileContents(fullPath)
    if (text) {
      return text.split(/\r?\n/)
    }
  }

  // turn rpwProject.srcDir, for example, into /rootDir/srcDir
  private buildFullDirName(dirName: string | undefined): string {
    if (dirName) {
      dirName = fixBackslashes(dirName)
      if (dirName.startsWith("./")) {
        dirName = dirName.substring(2)
      } else if (dirName.startsWith(".")) {
        dirName = dirName.substring(1)
      }
      if (dirName.endsWith("/")) {
        dirName = dirName.substring(1, dirName.length)
      }
      if (dirName != "") {
        if (!dirName.startsWith("/")) {
          dirName = this.rootDir + "/" + dirName
        }
        return dirName
      }
    }
    return this.rootDir
  }

  // Called by module to create/open a shared or unique file.
  //
  //  If the same file is opened multiple times without being defined
  //  as a shared include file, multiple instances of the same file
  //  contents will be created.

  openSourceFile(module: Module, fullPath: string): SourceFile | undefined {
    const isShared = this.includes.indexOf(fullPath) != -1

    const lines = this.getFileLines(fullPath)
    if (!lines) {
      return
    }

    const sourceFile = new SourceFile(module, fullPath, isShared, lines)
    module.sourceFiles.push(sourceFile)

    return sourceFile
  }

  // NOTE: only returns first match
  public findSourceFile(fullPath: string): SourceFile | undefined {
    // NOTE: shared files are included in each module's files,
    //  so no need to search this.sharedFiles
    for (let module of this.modules) {
      for (let sourceFile of module.sourceFiles) {
        if (sourceFile.fullPath == fullPath) {
          return sourceFile
        }
      }
    }
  }

  //--------------------------------------------------------
  // Debugger-related functionality
  //--------------------------------------------------------

  // given an address, find best object file that contains the address
  public findSourceByAddress(address: number, dataRange?: DataRange): RangeMatch | undefined {
    const matchList: RangeMatch[] = []
    for (let module of this.modules) {
      for (let objectDoc of module.objectDocs) {
        matchList.push(...objectDoc.findRanges(address, dataRange))
      }
    }
    if (matchList.length > 0) {
      let bestMatch = matchList[0]
      if (matchList.length > 1 && dataRange) {
        for (let i = 1; i < matchList.length; i += 1) {
          const match = matchList[i]
          if (match.matchCount > bestMatch.matchCount) {
            // TODO: look at match.sourceFile.calcLoadedPercent(dataRange)?
            bestMatch = match
          }
        }
      }
      return bestMatch
    }
  }

  public async binLoadProject(dbg: LspDebugger) {

    let entryPoint: number | undefined

    // loadProject should have already set this
    if (!this.rpwProject) {
      return
    }

    // load disk images
    if (this.rpwProject.images) {
      for (let imageEntry of this.rpwProject.images) {
        if (imageEntry.enabled == undefined || imageEntry.enabled == true) {
          const fullPath = this.binDir + "/" + imageEntry.name
          const drive = imageEntry.drive ?? 1
          const writeProtected = imageEntry.readonly || false
          if (fs.existsSync(fullPath) && fs.lstatSync(fullPath).isFile()) {
            const binBytes = fs.readFileSync(fullPath)
            dbg.setDiskImage(fullPath, binBytes, drive - 1, writeProtected)
          } else {
            throw new Error(`Failed to open disk image: ${fullPath}`)
          }
        }
      }
    }

    // preload binaries
    if (this.rpwProject.preloads) {
      for (let preload of this.rpwProject.preloads) {
        if (preload.enabled == undefined || preload.enabled == true) {
          if (preload.entryPoint) {
            try {
              entryPoint = parseInt(preload.entryPoint)
            } catch (e: any) {
              throw new Error(`Invalid preload entryPoint value: ${preload.entryPoint}`)
            }
          }

          if (preload.bins) {
            for (let bin of preload.bins) {
              const rpwBin = this.processBinName(bin)
              const fullPath = this.binDir + "/" + rpwBin.name
              if (fs.existsSync(fullPath) && fs.lstatSync(fullPath).isFile()) {
                const binBytes = fs.readFileSync(fullPath)
                let binAddr
                try {
                  binAddr = parseInt(rpwBin.address!)
                } catch (e: any) {
                  throw new Error(`Invalid patch address: ${rpwBin.address!}`)
                }
                // if no entryPoint provided, default to address of first bin
                //  (but don't allow 0xD000 bank 2)
                if (!entryPoint) {
                  entryPoint = binAddr
                }
                if (binAddr >= 0xD000 && binAddr <= 0xDFFF && rpwBin.bank == 2) {
                  binAddr -= 0x1000
                }
                await dbg.writeRam(binAddr, binBytes)
              } else {
                throw new Error(`Missing preload binary: ${fullPath}`)
              }
            }
          }

          // load memory patches
          if (preload.patches) {
            for (let patch of preload.patches) {
              if (!patch.address) {
                throw new Error("Patch requires an address")
              }
              if (!patch.data) {
                throw new Error(`Patch at ${patch.address} requires data`)
              }

              let patchAddr
              try {
                patchAddr = parseInt(patch.address)
              } catch (e: any) {
                throw new Error(`Invalid patch address: ${patch.address}`)
              }

              const patchVals = []
              for (let patchValStr of patch.data) {
                try {
                  patchVals.push(parseInt(patchValStr))
                } catch (e: any) {
                  throw new Error(`Invalid patch ${patch.address} value ${patchValStr}`)
                }
              }
              await dbg.writeRam(patchAddr, patchVals)
            }
          }
        }
      }
    }

    if (entryPoint != undefined) {
      dbg.setEntryPoint(entryPoint)
    }
  }

  private processBinName(bin: string | RpwBin): RpwBin {
    let fullName: string
    let nameStr: string
    let addrStr: string | undefined
    let bankNum = 0

    if (typeof bin == "string") {
      fullName = bin
      nameStr = bin
    } else {
      if (!bin.name) {
        throw new Error("bin missing name")
      }
      fullName = bin.name
      nameStr = bin.name
      addrStr = bin.address
      bankNum = bin.bank ?? 0
    }

    // parse name suffixes
    if (addrStr == undefined) {

      // process <name>#<type><address>
      let n = nameStr.lastIndexOf("#")
      if (n > 0) {
        addrStr = nameStr.substring(n + 1)
        if (addrStr.length == 6) {
          const typeStr = addrStr.substring(0, 2)
          try {
            if (parseInt(typeStr, 16) != 6) {
              throw new Error(`bin suffix type ${typeStr} not supported -- only 06`)
            }
          } catch (e: any) {
            throw new Error(`Invalid bin suffix type: ${typeStr}`)
          }
          addrStr = addrStr.substring(2)
          nameStr = nameStr.substring(0, n)
        } else {
          addrStr = undefined
        }
      }

      // process <name>.<address>[.<bank>]
      if (addrStr == undefined) {
        n = nameStr.lastIndexOf(".")
        if (n > 0) {
          addrStr = nameStr.substring(n + 1)
          nameStr = nameStr.substring(0, n)
          if (addrStr.length == 1) {
            if (addrStr == "1" || addrStr == "2") {
              bankNum = parseInt(addrStr)
              n = nameStr.lastIndexOf(".")
              if (n > 0) {
                addrStr = nameStr.substring(n + 1)
                nameStr = nameStr.substring(0, n)
              }
            } else {
              throw new Error(`Invalid bank value ${addrStr}`)
            }
          }
        }
      }

      if (addrStr == undefined) {
        throw new Error("bin is missing address")
      }
      if (addrStr.length != 4) {
        throw new Error("bin has possibly bad address -- length should be 4")
      }
    }

    // prove that addrStr is a valid number
    if (!addrStr.startsWith("0x")) {
      addrStr = "0x" + addrStr
    }
    let addrNum: number
    try {
      addrNum = parseInt(addrStr)
    } catch (e: any) {
      throw new Error(`Invalid address value: ${addrStr}`)
    }

    if (addrNum == 0xd000 && !bankNum) {
      throw new Error("Address 0xD000 must have a bank number")
    }

    return { name: fullName, address: addrStr, bank: bankNum }
  }
}

//------------------------------------------------------------------------------

export class Module {

  public project: Project
  public srcPath: string      // always in the form "/path" or ""
  public srcName: string      // always just the file name (*** without suffix?)
  public saveName?: string

  private asm?: Assembler

  public symbolMap = new Map<string, Symbol>
  public importMap = new Map<string, Symbol>
  public exportMap = new Map<string, Symbol>

  // list of files used to assemble this module, in include order
  public sourceFiles: SourceFile[] = []

  // list of pseudo documents that map object data to source file lines
  public objectDocs: ObjectDoc[] = []

  constructor(project: Project, srcPath: string, srcName: string, saveName?: string) {
    this.project = project
    this.srcPath = srcPath
    this.srcName = srcName
    this.saveName = saveName
  }

  public update_pass01(startingMap: SymbolMap, startingFiles: SourceFile[] | undefined, fileNames: string[], syntaxStats: number[]) {

    this.sourceFiles = []
    if (startingFiles) {
      this.sourceFiles.push(...startingFiles)
    }

    this.symbolMap = new Map(startingMap)
    this.importMap = new Map<string, Symbol>
    this.exportMap = new Map<string, Symbol>
    this.objectDocs = []

    this.asm = new Assembler(this)
    this.asm.assemble_pass01(fileNames, syntaxStats)
  }

  public update_pass2() {

    this.asm?.assemble_pass2()
    this.asm = undefined

    // link up all symbols
    // TODO: move to assembler?
    // for (let i = 0; i < this.lineRecords.length; i += 1) {
    //   const statement = this.lineRecords[i].statement
    //   if (statement && statement.tokens) {
    //     for (let j = 0; j < statement.tokens.length; j += 1) {
    //       const token = statement.tokens[j]
    //       if (token.type == par.TokenType.Symbol && !token.symbol) {
    //         const str = statement.getTokenString(token)
    //         const symbol = this.symbols.find(str)
    //         if (symbol) {
    //           token.symbol = symbol
    //           // *** add reference in symbol to statement/token? ***
    //         }
    //       }
    //     }
    //   }
    // }
    // give OpStatement a chance to infer symbol types
    // for (let i = 0; i < this.lineRecords.length; i += 1) {
    //   this.lineRecords[i].statement?.postParse()
    // }
  }

  public update_finalize() {
    for (let objectDoc of this.objectDocs) {
      objectDoc.finalize()
    }
  }

  public getBinFilePath(extFileName: string): string {
    let binName = fixBackslashes(extFileName)
    if (binName[0] == "/") {
      binName = binName.substring(1)
    }
    return cleanPath(this.project.binDir + "/" + binName)
  }

  // <workspace-dir>/<srcDir>/<src>/<fileName>
  //  this.project.rootDir == <workspace-dir>
  //  this.project.srcDir == <workspace-dir>/<rpwProject.srcDir>/
  //  this.srcPath == <rpwProject.module.src> minus fileName

  // extFileName comes from any PUT/include statement in any source code
  openSourceFile(extFileName: string, currentFile?: SourceFile): SourceFile | undefined {

    const fileName = fixBackslashes(extFileName)
    const pathList: string[] = []
    let search = true

    // fileName that start with "/" is an "absolute-ish" path,
    //  which is always relative to <workspace-dir>/<rpwProject.srcDir>
    if (fileName[0] == "/") {
      pathList.push(cleanPath(this.project.srcDir))
      search = false
    } else {
      // first place to look is in the current directory
      if (currentFile) {
        let currentDir = currentFile.fullPath
        const n = currentDir.lastIndexOf("/")
        if (n >= 0) {
          currentDir = currentDir.substring(0, n)
          pathList.push(cleanPath(currentDir))
        }
      }

      // next, look relative to <workspace-dir>/<rpwProject.srcDir>/rpwModule.src
      pathList.push(cleanPath(this.project.srcDir + this.srcPath))

      // next, look relative to <workspace-dir>/<rpwProject.srcDir>
      pathList.push(cleanPath(this.project.srcDir))
    }

    let sourceFile = this.findFile(fileName, pathList)
    if (!sourceFile) {
      if (search) {
        sourceFile = this.findFile(fileName, this.project.includePaths)
      }

      if (!sourceFile && !currentFile) {
        // *** this is not getting reported -- extension just fails ***
        // throw new Error(`File ${extFileName} not found`)
      }
    }
    return sourceFile
  }

  private findFile(fileName: string, pathList: string[]): SourceFile | undefined {
    for (let path of pathList) {
      let fullPath = cleanPath(path + "/" + fileName)
      if (!fs.existsSync(fullPath)) {
        // TODO: allow for default suffix override in project?
        fullPath = fullPath + ".S"
        if (!fs.existsSync(fullPath)) {
          continue
        }
      }
      return this.project.openSourceFile(this, fullPath)
    }
  }

  public getFileByIndex(fileIndex: number): SourceFile {
    return this.sourceFiles[fileIndex]
  }

  public getFileIndex(sourceFile: SourceFile): number {
    for (let i = 0; i < this.sourceFiles.length; i += 1) {
      if (this.sourceFiles[i] == sourceFile) {
        return i
      }
    }
    return -1
  }

  public findObjectDoc(sourceFile: SourceFile): ObjectDoc | undefined {
    for (let objectDoc of this.objectDocs) {
      if (objectDoc.sourceFile == sourceFile) {
        return objectDoc
      }
    }
  }
}

// flatten out path, removing "//", "./" and "../"
function cleanPath(path: string): string {
  const leadingSlash = path[0] == "/"
  let result = ""
  while (path != "") {
    let subDir: string
    const n = path.indexOf("/")
    if (n == -1) {
      subDir = path
      path = ""
    } else {
      subDir = path.substring(0, n)
      path = path.substring(n + 1)
    }
    if (subDir != "") {
      if (subDir == "..") {
        const n = result.lastIndexOf("/")
        if (n != -1) {
          result = result.substring(0, n)
        }
      } else if (subDir != "." && subDir != "") {
        result += "/" + subDir
      }
    }
  }
  if (!leadingSlash) {
    result = result.substring(1)
  }
  return result
}

//------------------------------------------------------------------------------
