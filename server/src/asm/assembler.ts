
import * as fs from 'fs'
import * as par from "./parser"
import * as stm from "./statements"
import * as exp from "./expressions"
import { Symbol, ScopeState } from "./symbols"

export type RpwModule = {
  srcbase: string,
  start: string
}

export type RpwProject = {
  modules: RpwModule[]
}

export type LineRecord = {
  sourceFile: SourceFile,
  lineNumber: number,
  statement?: stm.Statement
  // TODO: isVisible?
}


// *** where are vscode column markers? ***
// *** check my keyboard shortcuts ***


// *** Project class should hold all Modules for entire project, in build order
  // also tracks ENT linkage between them

export class Project {

  public rootDir: string
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

// *** Module class should hold all files and symbols for one ASM.* module

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

  // addSymbol(symbol: Symbol): boolean {

  //   if (!this.symbols.add(symbol)) {
  //     if (!symbol.sourceFile.isShared) {
  //   //   token.setError("Duplicate symbol")
  //       return false
  //     }
  //     // *** shared symbol -- should use existing symbol? ***
  //     return true
  //   }

  //   // if (!this.symbols.add(symbol)) {
  //   //   token.setError("Duplicate symbol")
  //   //   *** remove symbol from token? ***
  //   //   // *** somehow link this symbol to the previous definition?
  //   // } else {

  //   // ***
  //   return true
  // }

  // findSymbol(name: string, scope: string): Symbol | undefined {
  //   // ***
  //   return
  // }
}

export class SourceFile {

  public module: Module
  public path: string
  public lines: string[]
  public isShared: boolean

  // statements for just this file, one per line
  public statements: stm.Statement[] = []

  constructor(module: Module, path: string, lines: string[]) {
    this.module = module
    this.path = path
    this.lines = lines
    this.isShared = false
  }
}

type FileStateEntry = {
  file: SourceFile | undefined
  startLineIndex: number
  curLineIndex: number
  endLineIndex: number      // exclusive
  loopCount: number         // includes first pass
  isMacro: boolean
}

class FileReader {
  public state: FileStateEntry
  private stateStack: FileStateEntry[] = []

  constructor() {
    this.state = {
      file: undefined,
      startLineIndex: 0,
      curLineIndex: 0,
      endLineIndex: 0,
      loopCount: 1,
      isMacro: false
    }
  }

  push(file: SourceFile) {
    this.stateStack.push(this.state)
    this.state = {
      file: file,
      startLineIndex: 0,
      curLineIndex: 0,
      endLineIndex: file.lines.length,
      loopCount: 1,
      isMacro: false
    }
  }

  pop() {
    const nextState = this.stateStack.pop()
    if (nextState) {
      this.state = nextState
    }
  }
}

// *** guess syntax by watching keywords? ***

export class Assembler {

  public module: Module
  private scopeState: ScopeState

  //*** more default file handling behavior ***
  private fileReader: FileReader = new FileReader()

  constructor(module: Module) {
    this.module = module
    this.scopeState = new ScopeState()
  }

  // pass 0: parse all source files

  parse(fileName: string) {

    if (!this.includeFile(fileName)) {
      // *** handle error ***
    }

    // *** this is ugly ***
    const parser = new par.Parser(this)
    while (this.fileReader.state.file) {
      do {
        while (this.fileReader.state.curLineIndex < this.fileReader.state.endLineIndex) {

          const lineRecord: LineRecord = {
            sourceFile: this.fileReader.state.file,
            lineNumber: this.fileReader.state.curLineIndex,
            statement: undefined
          }

          // must advance before parsing that may include a different file
          this.fileReader.state.curLineIndex += 1

          // *** different parse behavior if handling macros or loops ***

          const sourceLine = this.fileReader.state.file.lines[lineRecord.lineNumber]
          parser.parseStatement(lineRecord, sourceLine)

          // process all possible symbols immediately
          if (lineRecord.statement) {
            this.processSymbols(lineRecord.statement, true)
          }

          // *** error handling ***
          if (lineRecord.sourceFile.statements.length == lineRecord.lineNumber) {
            if (lineRecord.statement) {
              lineRecord.sourceFile.statements.push(lineRecord.statement)
            } else {
              // *** filler? ***
            }
          }

          lineRecord.sourceFile.module.lineRecords.push(lineRecord)
        }
        this.fileReader.state.curLineIndex = this.fileReader.state.startLineIndex;
      } while (--this.fileReader.state.loopCount > 0)
      this.fileReader.pop()
    }

    // *** parser and fileReader no longer needed ***

    // process all remaining symbols
    for (let i = 0; i < this.module.lineRecords.length; i += 1) {
      const statement = this.module.lineRecords[i].statement
      if (statement) {
        this.processSymbols(statement, false)
      }
    }
  }

  // *** put in module instead? ***
  // *** later, when scanning disabled lines, still process references ***
  private processSymbols(statement: stm.Statement, firstPass: boolean) {
    // *** maybe just stop on error while walking instead of walking twice
    if (!statement.hasError()) {
      statement.forEachExpression((expression) => {
        if (expression instanceof exp.SymbolExpression) {
          const symExp = expression

          // must do this in the first pass while scope is being tracked
          if (!symExp.fullName) {
            symExp.fullName = this.scopeState.setSymbolExpression(symExp)
          }
          if (symExp.fullName) {
            if (symExp.isDefinition) {
              if (firstPass) {
                const foundSym = this.module.symbolMap.get(symExp.fullName)
                if (foundSym) {
                  symExp.setError("Duplicate label")
                  foundSym.definition.setError("Duplicate label")
                  return
                }
                if (symExp.symbol) {
                  this.module.symbolMap.set(symExp.fullName, symExp.symbol)
                }
              }
            } else if (!symExp.symbol) {
              const foundSym = this.module.symbolMap.get(symExp.fullName)
              if (foundSym) {
                symExp.symbol = foundSym
                symExp.fullName = foundSym.fullName
                // *** don't add reference if line is in macro def?
                foundSym.addReference(symExp)
              } else if (!firstPass) {
                // *** should also set error if this is part of a project
                //  *** but not a standalone file
                if (symExp.isLocalType()) {
                  symExp.setError("Label not found")
                }
              }
            }
          }
        }
      })
    }
  }

  // *** should file reader be part of parser instead? ***

  includeFile(fileName: string): boolean {
    const sourceFile = this.module.openSourceFile(fileName)
    if (!sourceFile) {
      // *** error handling ***
      return false
    }
    this.fileReader.push(sourceFile)
    return true
  }
}
