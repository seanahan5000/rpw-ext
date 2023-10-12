
import * as fs from 'fs'
import { Syntax, SyntaxMap } from "./syntax"
import { Statement } from "./statements"
import { Assembler } from "./assembler"
import { Symbol } from "./symbols"

//------------------------------------------------------------------------------

export type RpwModule = {
  // *** fix these ***
  srcbase: string,
  start: string
}

export type RpwProject = {
  // *** fix these ***
  syntax?: string,
  modules: RpwModule[]
}

export type LineRecord = {
  sourceFile: SourceFile,
  lineNumber: number,
  statement?: Statement
  // TODO: isVisible?
}

//------------------------------------------------------------------------------

export class SourceFile {

  public module: Module
  public path: string
  public lines: string[]
  public isShared: boolean

  // statements for just this file, one per line
  public statements: Statement[] = []

  constructor(module: Module, path: string, lines: string[]) {
    this.module = module
    this.path = path
    this.lines = lines
    this.isShared = false
  }
}

//------------------------------------------------------------------------------

export class Project {

  public rootDir: string
  protected syntax = Syntax.UNKNOWN
  protected modules: Module[] = []

  constructor(rootDir: string) {
    this.rootDir = rootDir
  }

  loadProject(rpwProject: RpwProject): boolean {
    if (!rpwProject.modules) {
      return false
    }
    for (let i = 0; i < rpwProject.modules.length; i += 1) {
      if (!this.loadModule(rpwProject.modules[i])) {
        return false
      }
    }

    if (rpwProject.syntax) {
      this.syntax = SyntaxMap.get(rpwProject.syntax.toUpperCase()) ?? Syntax.UNKNOWN
      // TODO: error if syntax match not found?
    }
    return true
  }

  loadModule(rpwModule: RpwModule): boolean {
    if (!rpwModule.start) {
      // *** error handling ***
      return false
    }
    this.modules.push(new Module(this, rpwModule))
    return true
  }

  update() {
    for (let i = 0; i < this.modules.length; i += 1) {
      this.modules[i].update()
    }
  }

  // can be overridden to get contents from elsewhere
  getFileContents(path: string): string | undefined {
    if (fs.existsSync(path)) {
      return fs.readFileSync(path, 'utf8')
    }
  }

  getFileLines(path: string): string[] | undefined {
    let text = this.getFileContents(path)
    if (text) {
      return text.split(/\r?\n/)
    }
  }

  // NOTE: only returns first match
  findSourceFile(path: string): SourceFile | undefined {
    for (let i = 0; i < this.modules.length; i += 1) {
      const sourceFile = this.modules[i].findSourceFile(path)
      if (sourceFile) {
        return sourceFile
      }
    }
  }
}

//------------------------------------------------------------------------------

export class Module {

  public project: Project
  private sourceDir: string
  private startFile: string
  public symbolMap = new Map<string, Symbol>

  //*** separate list of exported symbols (also in this.symbols)
  //*** when creating xxx = $ffff symbols, search all other module exports and link
    //*** linked symbol needs file/line information or linkage
  //*** list of imported symbols, linked to this.symbols from import file

  // TODO: vars list?

  // list of files used to assemble this module, in include order,
  //  possibly containing multiple SourceFiles that reference the same text document
  // *** maintain list of unique files ***
  public sourceFiles: SourceFile[] = []

  // list of all statements for the module, in assembly order, including macro expansions
  public lineRecords: LineRecord[] = []

  constructor(project: Project, rpwModule: RpwModule) {
    this.project = project
    // *** sanitize these paths ***
    this.sourceDir = rpwModule.srcbase
    this.startFile = rpwModule.start
  }

  update() {
    this.sourceFiles = []
    this.lineRecords = []
    this.symbolMap = new Map<string, Symbol>
    let asm = new Assembler(this)
    asm.parse(this.startFile)

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

  private buildFullSourcePath(fileName: string): string {
    let fullPath = this.project.rootDir
    // TODO: bother with both?
    if (fileName[0] != "\\" && fileName[0] != "/") {
      if (this.sourceDir != "") {
        fullPath += "/" + this.sourceDir
      }
    }
    if (fileName[0] != "\\" && fileName[0] != "/") {
      fullPath += "/"
    }

    fullPath += fileName
    // TODO: normalize slashes?
    return fullPath
  }

  openSourceFile(fileName: string): SourceFile | undefined {
    let basePath = this.buildFullSourcePath(fileName)
    let fullPath = basePath + ".S"
    let lines = this.project.getFileLines(fullPath)
    if (!lines) {
      fullPath = basePath
      lines = this.project.getFileLines(fullPath)
      if (!lines) {
        // *** error handling ***
        return
      }
    }
    const sourceFile = new SourceFile(this, fullPath, lines)
    // *** skip duplicates? ***
    this.sourceFiles.push(sourceFile)
    return sourceFile
  }

  // NOTE: only returns first match
  // *** shared? ***
  findSourceFile(path: string): SourceFile | undefined {
    for (let i = 0; i < this.sourceFiles.length; i += 1) {
      if (this.sourceFiles[i].path == path) {
        return this.sourceFiles[i]
      }
    }
  }
}

//------------------------------------------------------------------------------
