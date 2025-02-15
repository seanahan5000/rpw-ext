
import * as fs from 'fs'
import * as base64 from 'base64-js'
import { RpwProject, RpwSettings, RpwSettingsDefaults } from "../shared/rpw_types"
import { Syntax, SyntaxMap } from "./syntaxes/syntax_types"
import { SyntaxDefs } from "./syntaxes/syntax_defs"
import { Statement } from "./statements"
import { Parser } from "./parser"
import { Preprocessor } from "./assembler"
import { TypeDef } from "./assembler"
import { Symbol } from "./symbols"

import { ObjectDocBuilder, ObjectDoc } from "../code/lst_parser"

function fixBackslashes(inString: string): string {
  return inString.replace(/\\/g, '/')
}

//------------------------------------------------------------------------------

// Convert encode data buffers coming in from breakpoints
//  and stack traces into a utility class object.

export class DataRange {
  public address: number
  public bytes: Uint8Array

  public static create(obj: any): DataRange | undefined {
    if (obj.dataAddress && obj.dataBytes) {
      return new DataRange(obj.dataAddress, obj.dataBytes)
    }
  }

  constructor(dataAddress: number, dataBytes: string) {
    this.address = dataAddress
    this.bytes = base64.toByteArray(dataBytes)
  }

  public compare(inAddress: number, inBytes: number[] | Uint8Array, inOffset = 0, inCount?: number): number {
    if (inCount === undefined) {
      inCount = inBytes.length
    }
    if (inAddress < this.address) {
      inOffset = this.address - inAddress
      inCount -= inOffset
      inAddress = this.address
    }

    let thisOffset = 0
    if (inAddress > this.address) {
      thisOffset = inAddress - this.address
    }

    const overhang = thisOffset + inCount - this.bytes.length
    if (overhang > 0) {
      inCount -= overhang
    }

    let matches = 0
    for (let i = 0; i < inCount; i += 1) {
      if (inBytes[inOffset + i] == this.bytes[thisOffset + i]) {
        matches += 1
      }
    }
    return matches
  }
}

//------------------------------------------------------------------------------

export type LineRecord = {
  sourceFile: SourceFile,
  lineNumber: number,
  statement?: Statement
  // TODO: isVisible?

  address?: number
  size?: number       // *** use bytes.length instead separate size?
                      // *** only valid from pass1 to pass2?
  bytes?: number[]
}


export class SourceFile {

  public module: Module
  public fullPath: string     // fully specified path and name
  public lines: string[]
  public statements: Statement[] = []
  // TODO: displayName for progress/error messages?

  constructor(module: Module, fullPath: string, lines: string[]) {
    this.module = module
    this.fullPath = fullPath
    this.lines = lines
  }

  parseStatements(syntaxStats: number[]): Statement[] {
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

  public includes: string[] = []    // NOTE: shared files, not include paths
  public modules: Module[] = []

  public rootDir = "."
  public srcDir: string = ""
  public binDir: string = ""

  public includePaths: string[] = []
  public isTemporary = false
  public inWorkspace = false

  // state that needs to be reset upon update
  public sharedFiles: SourceFile[] = []
  public sharedSymbols = new Map<string, Symbol>()

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
      if (module.src) {
        let srcPath = ""
        let srcName = fixBackslashes(module.src)
        let lstFilePath: string | undefined

        // TODO: is this all really needed? just use cleanPath?
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

        if (module.lst) {
          lstFilePath = fixBackslashes(module.lst)
          // TODO: add a base path from project? lstDir?
          // TODO: other cleanup on lstFilePath?
        }

        this.modules.push(new Module(this, srcPath, srcName, lstFilePath))
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

    // *** this or caller should send syntax changed notification to client ***
  }

  update() {
    while (true) {
      const syntaxStats = new Array(SyntaxDefs.length).fill(0)

      this.sharedFiles = []
      this.sharedSymbols = new Map<string, Symbol>()
      for (let module of this.modules) {
        module.update(syntaxStats)
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
    if (isShared) {
      for (let sourceFile of this.sharedFiles) {
        if (sourceFile.fullPath == fullPath) {
          return sourceFile
        }
      }
    }

    let lines = this.getFileLines(fullPath)
    if (!lines) {
      return
    }

    const sourceFile = new SourceFile(module, fullPath, lines)
    if (isShared) {
      this.sharedFiles.push(sourceFile)
    }

    module.sourceFiles.push(sourceFile)
    // *** should the sourceFile be parsed right away, here? ***
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

  // given an address, find best object file that contains the address
  public findSourceByAddress(address: number, dataRange?: DataRange): { objectDoc: ObjectDoc, line: number } | undefined {
    const matchList = []
    for (let module of this.modules) {
      if (module.objectDocs) {
        for (let objectDoc of module.objectDocs) {
          const line = objectDoc.findLineByAddress(address, dataRange)
          if (line >= 0) {
            matchList.push({ objectDoc, line})
          }
        }
      }
    }

    if (matchList.length > 0) {
      let objectDoc = matchList[0].objectDoc
      let objectLine = matchList[0].line

      if (matchList.length > 1 && dataRange) {
        let matchPercent = -1
        for (let match of matchList) {
          const percent = match.objectDoc.calcLoadedPercent(dataRange)
          if (percent > matchPercent) {
            matchPercent = percent
            objectDoc = match.objectDoc
            objectLine = match.line
          }
        }
      }

      return { objectDoc, line: objectLine }
    }
  }
}

//------------------------------------------------------------------------------

export class Module {

  public project: Project
  public srcPath: string     // always in the form "/path" or ""
  private srcName: string     // always just the file name (*** without suffix?)
  private lstFilePath?: string
  public lstModTime = 0
  public symbolMap = new Map<string, Symbol>
  public variableMap = new Map<string, Symbol>

  // *** split by type ***
  public macroMap = new Map<string, TypeDef>

  //*** separate list of exported symbols (also in this.symbols)
  //*** when creating xxx = $ffff symbols, search all other module exports and link
    //*** linked symbol needs file/line information or linkage
  //*** list of imported symbols, linked to this.symbols from import file

  // TODO: vars list?

  // list of files used to assemble this module, in include order
  public sourceFiles: SourceFile[] = []

  // list of all statements for the module, in assembly order, including macro expansions
  public lineRecords: LineRecord[] = []

  // documents loaded from .lst file
  public objectDocs?: ObjectDoc[]

  constructor(project: Project, srcPath: string, srcName: string, lstName?: string) {
    this.project = project
    this.srcPath = srcPath
    this.srcName = srcName

    if (lstName) {

      this.lstFilePath = cleanPath(this.project.binDir + "/" + lstName)
      if (!fs.existsSync(this.lstFilePath)) {
        // TODO: throw error?
        return
      }

      this.lstModTime = fs.statSync(this.lstFilePath).mtime.getTime()
      this.scanLstFile()

      // watch for changes in .lst file
      // TODO: change to fs.watch to monitor the entire bin directory
      fs.watchFile(this.lstFilePath, { interval: 1000 }, (curStat, prevStat) => {
        if (curStat.mtime.getTime() != prevStat.mtime.getTime()) {
          this.lstModTime = curStat.mtime.getTime()
          this.scanLstFile()
        }
      })
    }
  }

  private scanLstFile() {
    if (this.lstFilePath) {
      const lstText = fs.readFileSync(this.lstFilePath, 'utf8')
      const lstLines = lstText.split(/\r?\n/)
      this.objectDocs = ObjectDocBuilder.buildDocs(this, lstLines)
      // *** builder needs to throw errors ***
      // *** link SourceDocs to modules sources
    }
  }

  update(syntaxStats: number[]) {
    this.sourceFiles = []
    this.lineRecords = []
    this.symbolMap = new Map<string, Symbol>
    this.variableMap = new Map<string, Symbol>
    this.macroMap = new Map<string, TypeDef>

    const asm = new Preprocessor(this)
    const lineRecords = asm.preprocess(this.srcName, syntaxStats)
    if (!lineRecords) {
      // *** error handling ***
      return
    }

    this.lineRecords = lineRecords

    asm.assemble(this.lineRecords)

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

      // next, look relative to <workspace-dir>/<rpwProject.srcDir>
      pathList.push(cleanPath(this.project.srcDir + this.srcPath))
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
