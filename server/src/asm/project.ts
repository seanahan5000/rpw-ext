
import * as fs from 'fs'
import { RpwProject, RpwSettings, RpwDefine } from "../shared/rpw_types"
import { Syntax, SyntaxMap } from "./syntaxes/syntax_types"
import { SyntaxDefs } from "./syntaxes/syntax_defs"
import { Statement } from "./statements"
import { Parser } from "./parser"
import { Assembler } from "./assembler"
import { Symbol, SymbolType, SymbolFrom } from "./symbols"
import { SymbolExpression, NumberExpression } from "./expressions"

function fixBackslashes(inString: string): string {
  return inString.replace(/\\/g, '/')
}

export type SymbolMap = Map<string, Symbol>

//------------------------------------------------------------------------------

export type LineRecord = {
  sourceFile: SourceFile,
  lineNumber: number,
  // TODO: startColumn? endColumn?
  statement: Statement
  isHidden?: boolean
  bytes?: (number | undefined)[]

  // lines records generate from this macroInvoke statement
  children?: LineRecord[]
}


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
    this.includePaths = rpwProject.includePaths?.map((dir) => this.buildFullDirName(dir)) ?? []

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
          let lstFilePath: string | undefined

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

      // complete final pass of assembly
      for (let module of this.modules) {
        module.update_pass2()
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
  findSourceFile(fullPath: string): SourceFile | undefined {
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

  // list of all statements for the module, in assembly order, including macro expansions
  public lineRecords: LineRecord[] = []

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

    this.lineRecords = []

    this.symbolMap = new Map(startingMap)
    this.importMap = new Map<string, Symbol>
    this.exportMap = new Map<string, Symbol>

    this.asm = new Assembler(this)
    this.lineRecords = this.asm.assemble_pass01(fileNames, syntaxStats)
  }

  static dumpFile = false

  public update_pass2() {

    this.asm?.assemble_pass2(this.lineRecords)

    // TODO: debug code, to be removed
    if (Module.dumpFile) {

      console.log(this.srcName)

      // if (this.srcName == "xxx")
      {
        for (let line of this.lineRecords) {
          let str = "  "
          if (!line.statement?.enabled) {
            str = "X "
          } else if (line.isHidden) {
            str = "* "
          }

          if (line.bytes?.length) {

            str += line.statement?.PC?.toString(16).padStart(4, "0").toUpperCase() + ": "

            for (let i = 0; i < 3; i += 1) {
              if (!line.bytes || i >= line.bytes.length) {
                str += "  "
              } else {
                if (line.bytes[i] === undefined) {
                  str += "??"
                } else {
                  str += line.bytes[i]!.toString(16).padStart(2, "0").toUpperCase()
                }
              }
              if (line.bytes.length <= 3 || i < 2) {
                str += " "
              } else {
                str += "+"
              }
            }
          } else {
            str = str.padEnd(2 + 6 + 9, " ")
          }
          str += line.statement?.sourceLine ?? ""
          console.log(str)
        }
      }
    }

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
