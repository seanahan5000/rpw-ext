
import { Module, SourceFile, LineRecord } from "./project"
import { Statement, GenericStatement, ConditionalStatement, MacroDefStatement } from "./statements"
import { Syntax, SyntaxDef } from "./syntaxes/syntax_types"
import { Symbol, ScopeState } from "./symbols"
import { SymbolExpression } from "./expressions"

// - update while typing

// - DS \,$EE

// - "DENIBBLE_TABLE  =   *-$96" not resolving

// - ignore macro body
// - org $00/ds 1 not treated as zpage
// - Dummy and SEG.U not working
// - DASM: "SEG" without name gives error
// - line with errors should give ??
// - restore PC after dummy

// - macro invoke
// - compare against .lst data

//------------------------------------------------------------------------------

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

//------------------------------------------------------------------------------

type ConditionalState = {
  enableCount: number,
  satisfiedCount: number,
  statement?: ConditionalStatement
}

export class Conditional {
  private enableCount = 1
  private satisfiedCount = 0
  public statement?: ConditionalStatement
  private stack: ConditionalState[] = []

  public push(): boolean {
    // set an arbitrary limit on stack size to catch infinite recursion
    if (this.stack.length > 255) {
      return false
    }
    this.stack.push({ enableCount: this.enableCount, satisfiedCount: this.satisfiedCount, statement: this.statement})
    this.enableCount -= 1
    this.satisfiedCount = 0
    this.statement = undefined
    return true
  }

  public pull(): boolean {
    if (this.stack.length == 0) {
      return false
    }
    const state = this.stack.pop()
    if (state) {
      this.enableCount = state.enableCount
      this.satisfiedCount = state.satisfiedCount
      this.statement = state.statement
    }
    return true
  }

  // True when a previous conditional clause was true,
  //  used to determine if the "else" clause should be enabled.
  public wasSatisfied(): boolean {
    return this.satisfiedCount > 0
  }

  // Called for each clause, used to control
  //  enable/disable across clauses.
  public setSatisfied(isSatisfied: boolean) {
    if (isSatisfied) {
      this.satisfiedCount = 1
      this.enable()
    } else if (this.satisfiedCount > 0) {
      // if the previous clause was satisifed,
      //  disable all remaining clauses
      if (this.satisfiedCount == 1) {
        this.disable()
      }
      this.satisfiedCount += 1
    }
  }

  public enable() {
    this.enableCount += 1
  }

  public disable() {
    this.enableCount -= 1
  }

  public isEnabled(): boolean {
    return this.enableCount > 0
  }

  public isComplete(): boolean {
    return this.stack.length == 0
  }
}

//------------------------------------------------------------------------------

export enum NestingType {
  Conditional = 0,
  Macro       = 1,
  Repeat      = 2,
  Struct      = 3,    // CA65, Dummy for MERLIN
  Enum        = 4,    // CA65
  Union       = 5,    // CA65
  Scope       = 6,    // CA65
  Proc        = 7,    // CA65
  Zone        = 8,    // ACME
  PseudoPc    = 9,    // ACME
  Cpu         = 10,   // ACME
  Xor         = 11,   // ACME
  Addr        = 12,   // ACME
  ConvTab     = 13,   // ACME
  Count
}

type NestingEntry = {
  type: NestingType
  statement: Statement
  bracePopProc?: () => void
}

//------------------------------------------------------------------------------

// *** StructDef
// *** EnumDef

export class MacroDef {

  public name: string
  private paramMap?: Map<string, Symbol>
  private startStatement: MacroDefStatement
  private endStatement?: Statement

  constructor(startStatement: MacroDefStatement) {
    this.startStatement = startStatement
    this.name = startStatement.macroName?.getString() ?? ""
  }

  public endDefinition(endStatement: Statement) {
    this.endStatement = endStatement
  }

  public getParamMap(): Map<string, Symbol> {
    // NOTE: Must build this on-demand because symbol
    //  information is not available at construction time.
    if (!this.paramMap) {
      this.paramMap = new Map<string, Symbol>()
      for (let arg of this.startStatement.args) {
        if (arg.name == "macro-param") {
          if (arg instanceof SymbolExpression) {
            if (arg.symbol) {
              this.paramMap.set(arg.getString(), arg.symbol)
            }
          }
        }
      }
    }
    return this.paramMap
  }
}

//------------------------------------------------------------------------------

export class Assembler {

  public module: Module

  // TODO: protected -> private once Preprocessor consumed

  protected fileReader = new FileReader()
  public conditional = new Conditional()
  public scopeState = new ScopeState()
  protected syntaxStats: number[] = []

  protected nestingStack: NestingEntry[] = []
  protected nestingCounts: number[] = new Array(NestingType.Count).fill(0)

  protected macroDef?: MacroDef
  private macroStart?: Statement

  //---------------------------------------------------

  // TODO: during preprocess only?

  protected currentPC: number = -1
  protected nextPC?: number

  public getCurrentPC(): number {
    return this.currentPC
  }

  public setNextPC(nextPC: number) {
    this.nextPC = nextPC
  }

  //---------------------------------------------------

  protected currentLine?: LineRecord

  constructor(module: Module) {
    this.module = module
  }

  public get syntax(): Syntax {
    return this.module.project.syntax
  }

  public get syntaxDef(): SyntaxDef {
    return this.module.project.syntaxDef
  }

  public assemble(lineRecords: LineRecord[]) {

    // pass 1

    for (let line of lineRecords) {
      const statement = line.statement
      if (!statement || !statement.enabled) {
        continue
      }

      if (statement.hasAnyError()) {
        // *** mark org as not valid?
        continue
      }

      // *** skip macro body lines ***

      this.currentLine = line
      // if (this.currentPCX >= 0) {
      //   line.address = this.currentPCX
      //   if (statement instanceof GenericStatement) {
      //     if (!statement.labelExp) {
      //       line.address = undefined
      //     }
      //   }
      // }
      line.size = statement.pass1(this)
      if (line.size === undefined) {
        // *** mark org as not valid?
      } else if (line.size == 0) {
        line.address = undefined
      // } else if (this.currentPCX >= 0) {
      //   this.currentPCX += line.size
      }
    }

    // pass 2

    for (let line of lineRecords) {

      const statement = line.statement
      if (!statement || !statement.enabled || statement.hasAnyError()) {
        continue
      }

      // *** skip macro body lines ***

      this.currentLine = line
      // this.currentPCX = line.address ?? -1
      // always create an array so statement doesn't have to check for undefined
      // *** maybe statement.pass2 shouldn't be called if line.size undefined???
      line.bytes = new Array(line.size ?? 0).fill(undefined)
      statement.pass2(this, line.bytes)
      // throw away array if size was undefined
      if (line.size === undefined) {
        line.bytes = undefined
      }
      // *** maybe remove line.size once line.bytes is present ***
    }
  }

  //------------------------------------
  // File management
  // *** TODO: comment/enforce which pass these are called in ***
  //------------------------------------

  includeFile(fileName: string): boolean {
    const currentFile = this.fileReader.state.file
    const sourceFile = this.module.openSourceFile(fileName, currentFile)
    if (!sourceFile) {
      return false
    }
    sourceFile.parseStatements(this.syntaxStats)
    this.fileReader.push(sourceFile)
    return true
  }

  //------------------------------------
  // Nesting management
  // *** TODO: comment/enforce which pass these are called in ***
  //------------------------------------

  public topNestingType(): NestingType | undefined {
    const length = this.nestingStack.length
    return length > 0 ? this.nestingStack[length - 1].type : undefined
  }

  public isNested(type: NestingType): boolean {
    return this.nestingCounts[type] != 0
  }

  public pushNesting(type: NestingType, bracePopProc?: () => void) {
    if (this.currentLine!.statement) {
      this.nestingStack.push({ type, statement: this.currentLine!.statement, bracePopProc})
      this.nestingCounts[type] += 1
    }
  }

  // NOTE: Caller will have already verified there's an entry
  //  to pop and that it's the correct one.
  // *** why is bracePop param here? ***
  public popNesting(bracePop = false): boolean {
    const entry = this.nestingStack.pop()
    if (entry) {
      if (this.nestingCounts[entry.type]) {
        this.nestingCounts[entry.type] -= 1
        // *** always call proc for now, until need for check is proven ***
        if (bracePop && entry.bracePopProc) {
          entry.bracePopProc()
        }
        entry.statement.foldEnd = this.currentLine!.statement
        return true
      } else {
        this.nestingStack.push(entry)
      }
    }
    return false
  }

  //------------------------------------
  // Macro management
  // *** TODO: comment/enforce which pass these are called in ***
  //  *** preprocess-only ***
  //------------------------------------

  public inMacroDef(): boolean {
    return this.macroDef != undefined
  }

  public startMacroDef() {
    // NOTE: caller should have checked this and flagged an error
    if (!this.macroDef) {

      const statement = this.currentLine!.statement
      if (statement instanceof MacroDefStatement) {

        const macroName = statement.macroName?.getString() ?? ""
        if (this.module.macroMap.get(macroName) !== undefined) {
          statement.macroName?.setError("Duplicate macro name (use Go To Definition)")
          return
        }

        this.macroStart = statement
        this.macroDef = new MacroDef(statement)

        // NOTE: Scope state management handled in the statement
        //  so it can be done differently based on syntax.
      }
    }
  }

  public endMacroDef() {
    // NOTE: caller should have checked this and flagged an error
    if (this.macroDef) {

      const statement = this.currentLine!.statement!

      if (this.macroStart) {
        this.macroStart.foldEnd = statement
        this.macroStart = undefined
      }

      this.macroDef.endDefinition(statement)
      this.module.macroMap.set(this.macroDef.name, this.macroDef)
      this.macroDef = undefined

      // NOTE: Scope state management handled in the statement
      //  so it can be done differently based on syntax.
    }
  }
}

//------------------------------------------------------------------------------
