
import { Module, SourceFile, LineRecord } from "./project"
import { Statement, ConditionalStatement, TypeDefBeginStatement, DefineDefStatement } from "./statements"
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
  Define      = 8,    // CA65
  Zone        = 9,    // ACME
  PseudoPc    = 10,   // ACME
  Cpu         = 11,   // ACME
  Xor         = 12,   // ACME
  Addr        = 13,   // ACME
  ConvTab     = 14,   // ACME
  Count
}

type NestingEntry = {
  type: NestingType
  statement: Statement
  bracePopProc?: () => void
}

//------------------------------------------------------------------------------

export class TypeDef {

  public name: string
  private paramMap?: Map<string, Symbol>
  private startStatement: TypeDefBeginStatement | DefineDefStatement
  private endStatement?: Statement

  constructor(nestingType: NestingType, startStatement: TypeDefBeginStatement | DefineDefStatement) {
    this.startStatement = startStatement
    this.name = startStatement.typeName?.getString() ?? ""
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
        if (arg.name == "type-param" || arg.name == "define-param") {
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
  public scopeState: ScopeState
  protected syntaxStats: number[] = []

  protected nestingStack: NestingEntry[] = []
  protected nestingCounts: number[] = new Array(NestingType.Count).fill(0)

  protected typeDef?: TypeDef
  private typeStart?: Statement

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
    this.scopeState = new ScopeState(this.syntaxDef.scopeSeparator)
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
      line.size = statement.pass1(this)
      if (line.size === undefined) {
        // *** mark org as not valid?
      } else if (line.size == 0) {
        line.address = undefined
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

  public inTypeDef(): boolean {
    return this.typeDef != undefined
  }

  public startTypeDef(nestingType: NestingType) {

    // NOTE: caller should have checked this and flagged an error
    if (!this.typeDef) {

      const statement = this.currentLine!.statement
      if (statement instanceof TypeDefBeginStatement || statement instanceof DefineDefStatement) {

        // *** used fully scoped name
        // const typeName = statement.typeName?.getString() ?? ""
        // if (this.module.macroMap.get(typeName) !== undefined) {
        //   statement.typeName?.setError("Duplicate macro name (use Go To Definition)")
        //   return
        // }

        this.typeStart = statement
        this.typeDef = new TypeDef(nestingType, statement)

        // NOTE: Scope state management handled in the statement
        //  so it can be done differently based on syntax.
      }
    }
  }

  public endTypeDef() {
    // NOTE: caller should have checked this and flagged an error
    if (this.typeDef) {

      const statement = this.currentLine!.statement!

      if (this.typeStart) {
        this.typeStart.foldEnd = statement
        this.typeStart = undefined
      }

      this.typeDef.endDefinition(statement)
      // *** split by type ***
      // this.module.macroMap.set(this.typeDef.name, this.typeDef)
      this.typeDef = undefined

      // NOTE: Scope state management handled in the statement
      //  so it can be done differently based on syntax.
    }
  }
}

//------------------------------------------------------------------------------
