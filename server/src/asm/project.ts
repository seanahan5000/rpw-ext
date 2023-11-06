
import * as fs from 'fs'
import { Syntax, SyntaxMap } from "./syntax"
import { Statement } from "./statements"
import { Preprocessor } from "./preprocessor"
import { Parser } from "./parser"
import { Symbol } from "./symbols"

function fixBackslashes(inString: string): string {
  return inString.replace(/\\/g, '/')
}

//------------------------------------------------------------------------------

export type RpwModule = {
  src?: string
}

export type RpwProject = {
  syntax?: string,
  upperCase?: boolean,
  tabSize?: number,
  tabStops?: number[],
  srcDir?: string,
  includes?: string[],
  modules?: RpwModule[]
}

// *** add fileSuffix? ".S" for merlin, for example ***

//------------------------------------------------------------------------------

export type LineRecord = {
  sourceFile: SourceFile,
  lineNumber: number,
  statement?: Statement
  // TODO: isVisible?
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

  parseStatements(): Statement[] {
    if (!this.statements.length) {
      const parser = new Parser()
      this.statements = parser.parseStatements(this, this.lines)
    }
    return this.statements
  }
}

//------------------------------------------------------------------------------

export class Project {

  public syntax = Syntax.UNKNOWN
  public upperCase: boolean = false
  public tabSize = 4
  public tabStops = [0, 16, 20, 40]
  public includes: string[] = []

  public modules: Module[] = []

  public rootDir = "."
  public srcDir: string = ""

  public temporary = false

  // state that needs to be reset upon update
  public sharedFiles: SourceFile[] = []
  public sharedSymbols = new Map<string, Symbol>()

  loadProject(extRootDir: string, rpwProject: RpwProject, temporary = false): boolean {

    this.temporary = temporary

    let rootDir = fixBackslashes(extRootDir)
    if (rootDir.endsWith("/")) {
      rootDir = rootDir.substring(0, rootDir.length - 1)
    }
    if (rootDir.length > 0) {
      this.rootDir = rootDir
    }

    if (rpwProject.syntax) {
      this.syntax = SyntaxMap.get(rpwProject.syntax.toUpperCase()) ?? Syntax.UNKNOWN
      // TODO: error if syntax match not found?
    }

    this.upperCase = rpwProject.upperCase ?? false
    this.tabSize = rpwProject.tabSize ?? 4

    // process tabStops
    if (rpwProject.tabStops && rpwProject.tabStops.length) {
      const tabStops = [0]
      let prevStop = 0
      for (let nextStop of rpwProject.tabStops) {
        if (nextStop > prevStop) {
          tabStops.push(nextStop)
        }
        prevStop = nextStop
      }
      if (tabStops.length >= 4) {
        this.tabStops = tabStops
      }
    }

    // rootDir + / + rpwProject.srcDir
    this.srcDir = this.buildFullDirName(rpwProject.srcDir)

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

    if (!rpwProject.modules) {
      return false
    }
    for (let module of rpwProject.modules) {
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
        }

        this.modules.push(new Module(this, srcPath, srcName))
      }
    }

    return true
  }

  update() {
    this.sharedFiles = []
    this.sharedSymbols = new Map<string, Symbol>()
    for (let module of this.modules) {
      module.update()
    }
  }

  // overridden to get contents from elsewhere
  getFileContents(fullPath: string): string | undefined {
    if (fs.existsSync(fullPath)) {
      return fs.readFileSync(fullPath, 'utf8')
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
    if (!fs.existsSync(fullPath)) {
      fullPath = fullPath + ".S"
      if (!fs.existsSync(fullPath)) {
        return
      }
    }

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
}

//------------------------------------------------------------------------------

export class Module {

  public project: Project
  private srcPath: string     // always in the form "/path" or ""
  private srcName: string     // always just the file name (*** without suffix?)
  public symbolMap = new Map<string, Symbol>

  //*** separate list of exported symbols (also in this.symbols)
  //*** when creating xxx = $ffff symbols, search all other module exports and link
    //*** linked symbol needs file/line information or linkage
  //*** list of imported symbols, linked to this.symbols from import file

  // TODO: vars list?

  // list of files used to assemble this module, in include order
  public sourceFiles: SourceFile[] = []

  // list of all statements for the module, in assembly order, including macro expansions
  public lineRecords: LineRecord[] = []

  constructor(project: Project, srcPath: string, srcName: string) {
    this.project = project
    this.srcPath = srcPath
    this.srcName = srcName
  }

  update() {
    this.sourceFiles = []
    this.lineRecords = []
    this.symbolMap = new Map<string, Symbol>

    // let asm = new Assembler(this)
    // asm.parse(this.srcName)

    let prep = new Preprocessor(this)
    const lineRecords = prep.preprocess(this.srcName)
    if (!lineRecords) {
      // *** error handling ***
      return
    }
    this.lineRecords = lineRecords

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

  // extFileName comes from any PUT/include statement in any source code
  openSourceFile(extFileName: string): SourceFile | undefined {
    let fileName = fixBackslashes(extFileName)
    if (fileName[0] != "/") {
      fileName = this.srcPath + "/" + fileName
    }
    let fullPath = this.project.srcDir + fileName
    return this.project.openSourceFile(this, fullPath)
  }
}

//------------------------------------------------------------------------------
