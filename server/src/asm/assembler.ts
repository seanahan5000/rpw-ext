
import * as fs from 'fs'
import { Module, SourceFile, LineRecord } from "./project"
import { Statement, ConditionalStatement, TypeDefBeginStatement, DefineDefStatement, MacroInvokeStatement } from "./statements"
import { ClosingBraceStatement } from "./statements"
import { Syntax, SyntaxDef } from "./syntaxes/syntax_types"
import { Symbol, ScopeState } from "./symbols"
import { SymbolExpression } from "./expressions"
import { SymbolType, SymbolFrom } from "./symbols"

// just for the CA65 macro invoke work-around
import { Parser } from "./parser"

//------------------------------------------------------------------------------
// MARK: FileReader

type FileStateEntry = {
  file: SourceFile | undefined
  startLineIndex: number
  curLineIndex: number
  endLineIndex: number      // exclusive
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
      isMacro: false
    }
  }

  // push copy of current state (used for looping)
  repush() {
    this.stateStack.push(this.state)
    this.state = {...this.state}
    // NOTE: curLineIndex has already been incremented,
    //  so startLineIndex points to the first line of the
    //  repeated lines.
    this.state.startLineIndex = this.state.curLineIndex
  }

  pop() {
    const nextState = this.stateStack.pop()
    if (nextState) {
      this.state = nextState
    }
  }
}

//------------------------------------------------------------------------------
// MARK: Conditional

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
// MARK: Nesting

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
// MARK: TypeDef

export class TypeDef {

  public endLineIndex: number
  private size?: number

  constructor(
      public nestingType: NestingType,
      public fileIndex: number,
      public startLineIndex: number,
      public params: string[]) {
    this.endLineIndex = startLineIndex
  }

  public endDefinition(endLineIndex: number, size: number) {
    this.endLineIndex = endLineIndex
    this.size = size
  }

  public getSize(): number | undefined {
    return this.size
  }
}

//------------------------------------------------------------------------------
// MARK: LoopState

export type LoopVar = {
  symExp: exp.SymbolExpression
  numExp: exp.NumberExpression
  shared: boolean
}

type LoopState = {
  curVal: number
  endVal: number
  deltaVal: number
  loopVar?: LoopVar
}

//------------------------------------------------------------------------------

type MacroInvokeState = {
  line: LineRecord
  varMap: Map<string, string>
}

//------------------------------------------------------------------------------
// MARK: Segment

export class Segment {

  public name: string
  public addressing: string
  public isInitialized: boolean
  public startPC?: number
  public curPC?: number
  public nextPC?: number
  public fileBytes: (number | undefined)[] = []

  constructor(name: string, addressing: string, isInitialized: boolean, startPC?: number) {
    this.name = name
    this.addressing = addressing
    this.isInitialized = isInitialized
    this.startPC = startPC
    if (startPC !== undefined) {
      this.curPC = startPC
    }
  }
}

//------------------------------------------------------------------------------
// MARK: Assembler

export class Assembler {

  public module: Module

  private fileReader = new FileReader()
  public conditional = new Conditional()
  public scopeState: ScopeState
  private syntaxStats: number[] = []
  public symUtils = new SymbolUtils()

  private nestingStack: NestingEntry[] = []
  private nestingCounts: number[] = new Array(NestingType.Count).fill(0)

  private typeDef?: TypeDef
  private typeStart?: Statement

  private macroInvokeStack: MacroInvokeState[] = []
  public macroInvokeState?: MacroInvokeState

  private loopStateStack: LoopState[] = []
  private loopState?: LoopState

  private parser = new Parser()

  private segStateStack: (Segment | undefined)[] = []
  private segMap = new Map<string, Segment>()
  private curSeg?: Segment

  private curLine?: LineRecord

  private statementBytes: (number | undefined)[] = []

  private pass: number = -1

  //---------------------------------------------------

  constructor(module: Module) {
    this.module = module
    this.scopeState = new ScopeState(
      module.project.caseSensitive ?? this.syntaxDef.caseSensitiveSymbols,
      this.syntaxDef.scopeSeparator)
  }

  public get syntax(): Syntax {
    return this.module.project.syntax
  }

  public get syntaxDef(): SyntaxDef {
    return this.module.project.syntaxDef
  }

  private checkPass(pass: number) {
    if (pass != this.pass) {
      throw "ASSERT: Pass check failed"
    }
  }

  //---------------------------------------------------
  // #region Pass 01
  //---------------------------------------------------

  public assemble_pass01(fileName: string, syntaxStats: number[]): LineRecord[] {

    const lineRecords: LineRecord[] = []
    this.syntaxStats = syntaxStats

    this.segMap = new Map<string, Segment>()
    this.segStateStack = []
    this.curSeg = undefined

    this.curLine = undefined

    this.macroInvokeStack = []
    this.macroInvokeState = undefined

    this.loopStateStack = []
    this.loopState = undefined

    this.pass = 0

    this.setSegment("code", "absolute", true, this.module.project.syntaxDef.defaultOrg)
    this.curSeg = this.curSeg!

    // parse all the statements of the initial file and set fileReader state
    if (!this.includeFile(fileName)) {
      // *** error messaging?
      return lineRecords
    }

    // NOTE: All vars/params must be resolved/set by end of preprocess (pass 0).
    //  At assembly pass 1 time, each statement must have all the
    //  all the information it needs from vars/params.

    while (this.fileReader.state.file) {

      while (this.fileReader.state.curLineIndex < this.fileReader.state.endLineIndex) {

        this.pass = 0

        const line: LineRecord = {
          sourceFile: this.fileReader.state.file,
          lineNumber: this.fileReader.state.curLineIndex,
          statement: undefined
        }

        this.curLine = line
        line.statement = this.fileReader.state.file.statements[line.lineNumber]

        // must advance before parsing statement that may include a different file
        this.fileReader.state.curLineIndex += 1

        // TODO: skip statements that have errors?
        if (this.inMacroExpand()) {
          const sourceLine = line.statement ? this.expandStatement(line.statement) : ""
          line.statement = this.parser.reparseStatement(sourceLine, this.syntax)
          // TODO: expand line again? (macros and defines)
          line.isHidden = true

        } else if (this.inLoop()) {
          if (line.statement.repeated) {
            line.statement = this.parser.reparseStatement(line.statement.sourceLine, this.syntax)
            line.isHidden = true
          } else {
            line.statement.repeated = true
          }
        }

        line.statement.segment = this.curSeg
        // TODO: size of PC could be determined by curSeg addressing
        line.statement.PC = this.curSeg?.curPC

        let isConditional = false
        if (line.statement instanceof ConditionalStatement) {
          isConditional = true

          // determine if ClosingBraceStatement actually a conditional operation
          if (line.statement instanceof ClosingBraceStatement) {
            if (this.nestingStack.length > 0) {
              isConditional = (this.nestingStack[this.nestingStack.length - 1].type == NestingType.Conditional)
            }
          }

          if (isConditional) {
            line.statement.applyConditional(this, this.conditional)
          }
        }

        if (!isConditional) {
          const enabled = this.conditional.isEnabled()
          if (enabled) {

            // TODO: Find a better location for this and
            //  a less-brittle solution for the problem.
            if (this.module.project.syntax == Syntax.CA65) {

              // CA65 allows macro invokes in the first column,
              //  so if the label of this statement matches a
              //  known macro name, convert it to a macro invoke
              //  statement and reparse.
              if (line.statement.labelExp) {
                const labelName = line.statement.labelExp.getString()
                const foundSym = this.module.symbolMap.get(labelName)
                if (foundSym && foundSym.type == SymbolType.TypeName) {
                  const newStatement = this.parser.reparseAsMacroInvoke(line.statement, this.module.project.syntax)
                  if (newStatement) {
                    line.statement = newStatement
                    this.fileReader.state.file.statements[line.lineNumber] = newStatement
                  }
                }
              }
            }

            // NOTE: need to push zone before processing named params
            line.statement.preprocess(this)

            // force a popScope after a DefineDefStatement because its scope
            //  only last for that line until its symbols have been processed
            if (line.statement instanceof DefineDefStatement) {
              line.statement.endPreprocess(this)
            }

          } else {
            line.statement.enabled = false
          }
        }

        if (line.statement.enabled) {
          this.pass = 1

          const advancePC = line.statement.pass1(this) ?? 0

          if (this.curSeg) {
            if (this.curSeg.nextPC !== undefined) {
              this.curSeg.curPC = this.curSeg.nextPC
              this.curSeg.nextPC = undefined
            } else {
              // Once statements start trying to use the current PC
              //  default to 0 and advance that.  (This shows up when
              //  a new segment is created and then immediately used.)
              if (this.curSeg.curPC === undefined) {
                this.curSeg.curPC = 0
                line.statement.PC = 0
              }
              this.curSeg.curPC += advancePC
            }
          } else {
            // TODO: error if advancePC != 0 but no segment?
          }
        }

        // // don't add new statement if shared file already has one
        // if (line.sourceFile.statements.length == line.lineNumber) {
        //   if (line.statement) {
        //     line.sourceFile.statements.push(line.statement)
        //   }
        // }

        lineRecords.push(this.curLine)

        // if macroInvoke active, also attach new lines to invoker
        if (this.macroInvokeState?.line) {
          if (this.macroInvokeState.line.children) {
            this.macroInvokeState.line.children.push(line)
          } else {
            this.macroInvokeState.line.children = []
          }
        }
      }

      this.fileReader.state.curLineIndex = this.fileReader.state.startLineIndex

      if (this.fileReader.state.isMacro) {
        this.macroInvokeState = this.macroInvokeStack.pop()
      }

      this.fileReader.pop()
    }

    this.curLine = undefined

    while (true) {
      const entry = this.nestingStack.pop()
      if (!entry) {
        break
      }
      // TODO: more descriptive error message
      entry.statement.setError("Dangling " + entry.statement.opNameLC)
    }

    if (this.segStateStack.length > 0) {
      // TODO: report dangling segment stack error?
    }

    if (this.macroInvokeStack.length > 0) {
      // TODO: report dangling macro invoke state error?
    }

    // process all remaining symbols
    // const symUtils = new SymbolUtils()
    // for (let line of lineRecords) {
    //   const statement = line.statement
    //   if (statement) {
    //     this.finalizeSymbols_new(statement)
    // //     statement.postProcessSymbols(symUtils)
    //   }
    // }

    this.pass = -1
    return lineRecords
  }

  // #endregion
  //---------------------------------------------------
  // #region Pass 2
  //---------------------------------------------------

  public assemble_pass2(lineRecords: LineRecord[]) {
    this.pass = 2

    this.statementBytes = []

    for (let line of lineRecords) {

      if (!line.statement) {
        continue
      }

      // *** would linking of forward references still be needed?
      // *** maybe still process symbol references (not definitions)
      if (!line.statement.enabled) {
        continue
      }

      // resolve remaining references -- no definitions
      line.statement.forEachExpression((expression) => {
        const symExp = expression
        if (symExp instanceof exp.SymbolExpression) {

          if (symExp.hasError()) {
            return
          }

          // skip definitions and resolved references
          if (symExp.symbol) {
            return
          }
          // should never happen at this point
          if (!symExp.fullName) {
            return
          }

          const foundSym = this.findSymbol_pass2(symExp)
          if (foundSym) {
            symExp.symbol = foundSym
            symExp.symbolType = foundSym.type
            symExp.fullName = foundSym.fullName
            foundSym.addReference(symExp)
          } else {

            if (line.statement?.segment?.name == "_macro_" ||
                line.statement instanceof DefineDefStatement) {
              symExp.isWeak = true
            }

            // TODO: make temporary project check a setting
            if (!symExp.isWeak && !this.module.project.isTemporary) {
              symExp.setError("Symbol not found")
            }
          }
        }
      })

      // *** error on final resolve failure ***

      // only call write pass if current segment is initialized (has data)
      if (line.statement?.segment?.isInitialized) {

        line.statement.pass2(this)

        if (this.statementBytes.length) {
          line.bytes = this.statementBytes
          this.statementBytes = []
        }
      }
    }

    // walk each macro invoke statement and collect errors from their children
    for (let line of lineRecords) {
      if (!line.isHidden && line.statement?.enabled) {
        if (line.statement instanceof MacroInvokeStatement) {
          this.collectErrors(line)
        }
      }
    }

    if (this.module.saveName) {
      this.writeFile(this.module.saveName)
    }

    this.pass = -1
  }

  // #endregion
  //--------------------------------------------------------
  // #region Writing
  // write callbacks for pass 2
  //--------------------------------------------------------

  public writeByte(value: number | undefined) {
    if (!this.curSeg?.fileBytes) {
      throw "ASSERT: writeByte called without a segment"
    }
    this.checkPass(2)
    this.curSeg.fileBytes.push(value)
    this.statementBytes.push(value)
  }

  public writeBytes(values: (number | undefined)[]) {
    if (!this.curSeg?.fileBytes) {
      throw "ASSERT: writeBytes called without a segment"
    }
    this.checkPass(2)
    this.curSeg.fileBytes.push(...values)
    this.statementBytes.push(...values)
  }

  public writeBytePattern(value: number | undefined, count: number) {
    if (!this.curSeg?.fileBytes) {
      throw "ASSERT: writeBytePattern called without a segment"
    }
    this.checkPass(2)
    const bytes = new Array(count).fill(value)
    this.curSeg.fileBytes.push(...bytes)
    this.statementBytes.push(...bytes)
  }

  //--------------------------------------------------------

  // replace named parameters with their current values
  private expandStatement(statement: Statement): string {
    this.checkPass(0)

    let result = statement.sourceLine
    if (this.macroInvokeState) {
      statement.forEachExpressionBack((expression: exp.Expression) => {
        if (expression instanceof exp.SymbolExpression) {
          if (expression.symbolType == SymbolType.NamedParam) {
            const range = expression.getRange()
            if (range) {
              const newStr = this.macroInvokeState!.varMap.get(expression.getSimpleName().asString)
              if (newStr !== undefined) {
                result = result.slice(0, range.start) + newStr + result.slice(range.end)
              }
            }
          }
        }
      })
    }
    return result
  }

  //--------------------------------------------------------
  // #endregion
  //--------------------------------------------------------
  // #region Symbols
  //--------------------------------------------------------

  public processSymbol_pass0(symExp: SymbolExpression) {
    this.checkPass(0)

    if (symExp.hasError()) {
      return
    }

    // exit if symbol has already been processed
    if (symExp.fullName) {
      return
    }

    symExp.fullName = this.scopeState.setSymbolExpression(symExp)
    if (!symExp.fullName) {
      symExp.setError("Unable to resolve symbol")
      return
    }

    if (symExp.isDefinition) {

      // definitions always have symbol created
      symExp.symbol = symExp.symbol!

      const foundSym = this.module.symbolMap.get(symExp.fullName)
      if (foundSym) {

        // On a duplicate variable definition, change the owner of the
        //  symbol to the newer expression.  This is desirable in macro
        //  definitions too.
        if (symExp.isVariableType()) {
          this.module.symbolMap.set(symExp.fullName, symExp.symbol)
          if (!this.inMacroDef()) {
            if (this.curSeg?.curPC !== undefined) {
              symExp.setPCValue(this.curSeg.curPC)
            }
            symExp.captureValue()
          }
          return
        }

        let reportError = true

        if (this.inMacroDef()) {

          // If symbol exists and it's a namedParam and a macro is being
          //  defined, demote the expression to a reference, from the
          //  definition it will become when the macro is expanded.
          //
          // All other symbols will be scoped to the macro definition,
          //  so report duplicates as normal.
          if (foundSym.type == SymbolType.NamedParam) {
            reportError = false
            symExp.symbolType = foundSym.type
          }
          // If symbol exists and it's mutable and it's inside a macroDef,
          //  link it back to the first definition
          else if (foundSym.isMutable) {
            reportError = false
          }

        } else { // !this.inMacroDef()

          // On a duplicate mutable definition, change the owner of the
          //  symbol to the newer expression.
          if (foundSym.isMutable) {
            this.module.symbolMap.set(symExp.fullName, symExp.symbol)
            symExp.captureValue()
            return
          }
        }

        if (/*symExp.symbolFrom == SymbolFrom.Import ||*/ symExp.isWeak) {
         reportError = false
        }

        if (reportError) {
          symExp.setError("Duplicate symbol (use Go To Definition)")
        }

        // turn symExp into a reference to the original symbol
        symExp.symbol = foundSym
        symExp.isDefinition = false
        // *** if in macro expansion, still add references?
        foundSym.addReference(symExp)
      } else {

        const sharedSym = this.module.project.sharedSymbols.get(symExp.fullName)
        if (symExp.symbol.isEntryPoint) {
          if (sharedSym) {
            symExp.setError("Duplicate entrypoint (use Go To Definition)")
            // turn symExp into a reference to the original symbol
            symExp.symbol = sharedSym
            symExp.isDefinition = false
            sharedSym.addReference(symExp)
            return
          }
          symExp.symbol.fullName = symExp.fullName
          this.module.project.sharedSymbols.set(symExp.fullName, symExp.symbol)
          this.module.symbolMap.set(symExp.fullName, symExp.symbol)
        } else {
          if (sharedSym) {
            // this definition matches a shared symbol, so it's probably from an EXT file
            if (symExp.symbol.from != SymbolFrom.Equate) {
              symExp.setError("Symbol conflict with entrypoint (use Go To Definition)")
              // turn symExp into a reference to the original symbol
              symExp.symbol = sharedSym
              symExp.isDefinition = false
              sharedSym.addReference(symExp)
              return
            }
            if (sharedSym.fullName) {
              this.module.symbolMap.set(sharedSym.fullName, sharedSym)
            }
          } else {
            symExp.symbol.fullName = symExp.fullName
            this.module.symbolMap.set(symExp.fullName, symExp.symbol)
          }
        }

        if (!this.inMacroDef()) {
          if (this.curSeg?.curPC !== undefined) {
            symExp.setPCValue(this.curSeg.curPC)
          }
          if (symExp.isVariableType() || symExp.symbol?.isMutable) {
            symExp.captureValue()
          }
        }
      }
    } else { // references

      const foundSym = this.findSymbol_pass0(symExp)
      if (foundSym) {
        symExp.symbol = foundSym
        symExp.symbolType = foundSym.type
        symExp.fullName = foundSym.fullName
        foundSym.addReference(symExp)

        if (!this.inMacroDef()) {
          if (symExp.isVariableType() || symExp.symbol?.isMutable) {
            symExp.captureValue()
          }
        }
      } else {
        // TODO: For now, don't report any missing symbols within
        //  a macro definition.  This should eventually look at
        //  named macro parameters and match against those. (ca65-only?)
        if (this.inTypeDef()) {
          symExp.isWeak = true
        }
        if (!symExp.isWeak) {
          // TODO: make temporary project check a setting
          if (!this.module.project.isTemporary) {
            if (symExp.symbolType == SymbolType.TypeName) {
              symExp.setError("Unknown macro or opcode")
            }
          }
        }
      }
    }
  }

  private findSymbol_pass0(symExp: SymbolExpression): Symbol | undefined {
    // only pass 0 because scope state won't be valid in other passes
    this.checkPass(0)

    let firstPass = true
    let changedScope = false
    for (let i = this.scopeState.getScopeDepth(symExp); --i >= 0; ) {
      if (!firstPass) {
        symExp.fullName = this.scopeState.setSymbolExpression(symExp, i)
        changedScope = true
      }
      const foundSym = this.module.symbolMap.get(symExp.fullName!)
      if (foundSym) {
        return foundSym
      }
      firstPass = false
    }
    if (changedScope) {
      // if no match found, revert to full scope name
      symExp.fullName = this.scopeState.setSymbolExpression(symExp)
    }
  }

  private findSymbol_pass2(symExp: SymbolExpression): Symbol | undefined {
    this.checkPass(2)

    let foundSym = this.module.symbolMap.get(symExp.fullName!)
    if (!foundSym) {
      // If a scoped forward reference to the symbol was not found,
      //  try looking in the global scope.  The scope stack cannot
      //  be searched because it is no longer valid in pass 2.
      // NOTE: This is mainly used to resolve forward references inside
      //  a .define or .macro.  If this causes problems elsewhere,
      //  restrict it to just .define/.macro.
      symExp.fullName = this.scopeState.setSymbolExpression(symExp, 0)
      foundSym = this.module.symbolMap.get(symExp.fullName!)
    }
    return foundSym
  }

  // #endregion
  //--------------------------------------------------------
  // #region Segments
  //--------------------------------------------------------

  public setSegment(name: string, addressing: string, isInitialized: boolean, startPC?: number) {
    this.checkPass(0)

    const segNameLC = name.toLowerCase()
    let nextSeg = this.segMap.get(segNameLC)
    if (!nextSeg) {
      nextSeg = new Segment(name, addressing, isInitialized, startPC)
      this.segMap.set(segNameLC, nextSeg)
    } else {
      // TODO: check addressing and initialized against existing segment
    }

    this.curSeg = nextSeg
  }

  public pushAndSetMacroSegment() {
    this.checkPass(0)

    this.pushSegment()
    // NOTE: This is temporary and not added to segMap
    this.curSeg = new Segment("_macro_", "absolute", false, 0)
  }

  public pushAndSetStructSegment(startPC: number) {
    this.checkPass(0)

    this.pushSegment()
    // NOTE: This is temporary and not added to segMap
    this.curSeg = new Segment("_struct_", "implicit", false, startPC)
  }

  public pushAndSetDummySegment(startPC: number) {
    this.checkPass(0)

    this.pushSegment()
    // NOTE: This is temporary and not added to segMap
    this.curSeg = new Segment("_dummy_", "implicit", false, startPC)
  }

  public pushSegment() {
    this.checkPass(0)

    this.segStateStack.push(this.curSeg)
  }

  public popSegment(): number {
    this.checkPass(0)

    if (!this.curSeg) {
      return 0
    }
    const size = (this.curSeg.curPC ?? 0) - (this.curSeg.startPC ?? 0)
    this.curSeg = this.segStateStack.pop()

    // handle nested struct segments
    if (this.curSeg?.name == "_struct_") {
      if (this.curSeg.curPC !== undefined) {
        this.curSeg.curPC += size
      }
    }
    return size
  }

  public setNextOrg(nextOrg: number, isVirtual: boolean): number {
    this.checkPass(0)

    let fillAmount = 0
    if (!this.curSeg) {
      // TODO: is it correct to create default segment here?
      this.curSeg = new Segment("code", "absolute", true, nextOrg)
    } else {
      if (!isVirtual && this.curSeg.curPC !== undefined) {
        fillAmount = Math.max(nextOrg - this.curSeg.curPC, 0)
      }
      this.curSeg.nextPC = nextOrg
    }
    return fillAmount
  }

  // #endregion
  //--------------------------------------------------------
  // #region Macro Invoke
  //--------------------------------------------------------

  public invokeMacro(macroDef: TypeDef) {
    this.checkPass(0)

    if (!(this.curLine?.statement instanceof MacroInvokeStatement)) {
      throw "ASSERT: invokeMacro called on wrong statement type"
    }

    this.fileReader.push(this.module.getFileByIndex(macroDef.fileIndex))
    this.fileReader.state.startLineIndex = macroDef.startLineIndex
    this.fileReader.state.curLineIndex = macroDef.startLineIndex
    this.fileReader.state.endLineIndex = macroDef.endLineIndex
    this.fileReader.state.isMacro = true

    // handle macro var nesting
    if (this.macroInvokeState) {
      this.macroInvokeStack.push(this.macroInvokeState)
    }
    this.macroInvokeState = {
      line: this.curLine,
      varMap: new Map<string, string>()
    }
  }

  // Collect all errors into the invoked macro line from the
  //  children of that line.
  private collectErrors(invokeLine: LineRecord) {
    if (invokeLine.children) {
      let errorMsg = ""
      for (let child of invokeLine.children) {
        if (child.statement && child.statement.enabled) {
          // recurse depth first to handle nested macro invokes
          if (child.statement instanceof MacroInvokeStatement) {
            // recurse depth first
            this.collectErrors(child)
          }
          child.statement.forEachExpression((expression) => {
            if (!errorMsg) {
              if (expression.hasError()) {
                const trimmedSource = child.statement!.sourceLine.trimStart()
                errorMsg = trimmedSource
                const range = expression.getRange()
                if (range) {
                  const delta = child.statement!.sourceLine.length - trimmedSource.length
                  range.start -= delta
                  range.end -= delta
                  errorMsg += "\n" + "".padStart(range.start, " ").padEnd(range.end, "^")
                }
                if (expression.errorMessage) {
                  errorMsg += "\n" + expression.errorMessage
                }
              }
            }
          })
          if (!errorMsg) {
            if (child.statement.hasError()) {
              errorMsg = child.statement.errorMessage ?? "ERROR"
            }
          }
          if (errorMsg) {
            invokeLine.statement?.setError(errorMsg)
          }
        }
      }
    }
  }

  // #endregion
  //--------------------------------------------------------
  // #region Looping
  //--------------------------------------------------------

  public inLoop(): boolean {
    return this.loopState !== undefined
  }

  public initLoopVar(loopExp: exp.SymbolExpression): LoopVar | undefined {
    this.checkPass(0)

    let shared: boolean
    let numExp: exp.NumberExpression

    const varName = loopExp.getSimpleName().asString
    let loopSym = this.module.symbolMap.get(varName)
    if (loopSym) {
      if (loopSym.type != SymbolType.Variable) {
        loopExp.setError("Duplicate conflicting symbol")
        return
      }
      loopExp.symbol = loopSym
      loopExp.isDefinition = false
      loopExp.fullName = this.scopeState.setSymbolExpression(loopExp)
      loopSym.addReference(loopExp)
      numExp = <exp.NumberExpression>loopSym.getValue()
      shared = true
    } else {
      numExp = new exp.NumberExpression([], 0, false)
      loopExp.symbol!.setValue(numExp, SymbolFrom.Unknown)
      loopExp.fullName = this.scopeState.setSymbolExpression(loopExp)
      this.module.symbolMap.set(varName, loopExp.symbol!)
      shared = false
    }

    return { symExp: loopExp, numExp, shared }
  }

  public startLoop(startVal: number, endVal: number, loopVar?: LoopVar) {
    this.checkPass(0)

    // TODO: skip if inMacroDef?

    this.fileReader.repush()

    if (this.loopState) {
      this.loopStateStack.push(this.loopState)
    }

    if (startVal <= endVal) {
      this.loopState = {
        curVal: startVal,
        endVal: endVal,
        deltaVal: 1
      }
    } else {
      this.loopState = {
        curVal: endVal,
        endVal: startVal,
        deltaVal: -1
      }
    }

    if (loopVar) {
      this.loopState.loopVar = loopVar
      this.loopState.loopVar.numExp.setNumber(this.loopState.curVal)
    }
  }

  public endLoop(): boolean {
    this.checkPass(0)

    // TODO: skip if inMacroDef?

    if (!this.loopState) {
      return true
    }

    this.loopState.curVal += this.loopState.deltaVal
    this.loopState.loopVar?.numExp.setNumber(this.loopState.curVal)
    if (this.loopState.deltaVal > 0) {
      if (this.loopState.curVal <= this.loopState.endVal) {
        this.fileReader.state.curLineIndex = this.fileReader.state.startLineIndex
        return false
      }
    } else {
      if (this.loopState.curVal >= this.loopState.endVal) {
        this.fileReader.state.curLineIndex = this.fileReader.state.startLineIndex
        return false
      }
    }

    const nextIndex = this.fileReader.state.curLineIndex
    this.fileReader.pop()
    this.fileReader.state.curLineIndex = nextIndex

    const loopVar = this.loopState.loopVar
    if (loopVar && !loopVar.shared) {
      this.module.symbolMap.delete(loopVar.symExp.getSimpleName().asString)
    }

    this.loopState = this.loopStateStack.pop()
    return true
  }

  // TODO: breakLoop, continueLoop, gotoLoop, etc.

  // #endregion
  //------------------------------------
  // #region Files
  //------------------------------------

  public includeFile(fileName: string): boolean {
    this.checkPass(0)

    const currentFile = this.fileReader.state.file
    const sourceFile = this.module.openSourceFile(fileName, currentFile)
    if (!sourceFile) {
      return false
    }
    sourceFile.parseStatements(this.syntaxStats)
    this.fileReader.push(sourceFile)
    return true
  }

  static verifyOnWrite: boolean = false

  public writeFile(fileName: string): boolean {
    this.checkPass(2)

    // unlikely but remotely possible to attempt write with no segment
    if (!this.curSeg) {
      return false
    }

    const binFileName = this.module.getBinFilePath(fileName)

    if (Assembler.verifyOnWrite) {
      console.log(`Checking ${binFileName}`)

      for (let i = 0; i < this.curSeg.fileBytes.length; i += 1) {
        if (this.curSeg.fileBytes[i] === undefined) {
          const addrStr = i.toString(16).padStart(4, "0").toUpperCase()
          this.curSeg.fileBytes[i] = 0xEE
          console.log(`Undefined data at ${addrStr}`)
        }
      }
    }

    const buffer = new Uint8Array(<number[]>this.curSeg.fileBytes)

    // TODO: eventually write out final data
    // fs.writeFileSync(binFileName + "_new", buffer, { encoding: null, flag: "w" })

    // TODO: debug code, to be removed
    if (Assembler.verifyOnWrite) {
      if (fs.existsSync(binFileName)) {
        // compare file results with previously written data
        const refData = fs.readFileSync(binFileName)
        if (refData) {
          if (refData.length != buffer.length) {
            console.log(`size mismatch (${refData.length} vs ${buffer.length}`)
          }
          const size = Math.min(refData.length, buffer.length)
          for (let i = 0; i < size; i += 1) {
            if (refData[i] != buffer[i]) {
              const addrStr = i.toString(16).padStart(4, "0").toUpperCase()
              const refStr = refData[i].toString(16).padStart(2, "0").toUpperCase()
              const fileStr = buffer[i]?.toString(16).padStart(2, "0").toUpperCase()
              console.log(`${addrStr}: ref: ${refStr} != file: ${fileStr}`)
            }
          }
        }
      } else {
        console.log("File missing: " + binFileName)
      }
    }

    this.curSeg.fileBytes = []
    return true
  }

  // #endregion
  //------------------------------------
  // #region Nesting
  //------------------------------------

  public topNestingType(): NestingType | undefined {
    this.checkPass(0)

    const length = this.nestingStack.length
    return length > 0 ? this.nestingStack[length - 1].type : undefined
  }

  public isNested(type: NestingType): boolean {
    this.checkPass(0)

    return this.nestingCounts[type] != 0
  }

  public pushNesting(type: NestingType, bracePopProc?: () => void) {
    this.checkPass(0)

    if (this.curLine!.statement) {
      this.nestingStack.push({ type, statement: this.curLine!.statement, bracePopProc})
      this.nestingCounts[type] += 1
    }
  }

  // NOTE: Caller will have already verified there's an entry
  //  to pop and that it's the correct one.
  // *** why is bracePop param here? ***
  public popNesting(bracePop = false): boolean {
    this.checkPass(0)

    const entry = this.nestingStack.pop()
    if (entry) {
      if (this.nestingCounts[entry.type]) {
        this.nestingCounts[entry.type] -= 1
        // *** always call proc for now, until need for check is proven ***
        if (bracePop && entry.bracePopProc) {
          entry.bracePopProc()
        }
        entry.statement.foldEnd = this.curLine!.statement
        return true
      } else {
        this.nestingStack.push(entry)
      }
    }
    return false
  }

  // #endregion
  //------------------------------------
  // #region TypeDef
  //------------------------------------

  public inTypeDef(): boolean {
    this.checkPass(0)

    return this.typeDef != undefined
  }

  public inMacroDef(): boolean {
    this.checkPass(0)

    return this.inTypeDef() && this.isNested(NestingType.Macro)
  }

  public inMacroExpand(): boolean {
    this.checkPass(0)

    return this.fileReader.state.isMacro
  }

  // *** what about nesting these? .define instead .macro, for example ***
    // *** are structs within macros allowed?

  public startTypeDef(nestingType: NestingType, typeName: SymbolExpression, typeParams?: string[]) {
    this.checkPass(0)

    // NOTE: caller should have checked this and flagged an error
    if (!this.typeDef) {

      const statement = this.curLine!.statement
      if (statement instanceof TypeDefBeginStatement || statement instanceof DefineDefStatement) {

        this.typeStart = statement
        const fileIndex = this.module.getCurrentFileIndex()
        const startLineIndex = this.curLine!.lineNumber + 1
        this.typeDef = new TypeDef(nestingType, fileIndex, startLineIndex, typeParams ?? [])

        // attach typeDef to typeName symbol
        if (typeName?.symbol) {
          const anySym = (typeName.symbol as any)
          anySym.typeDef = this.typeDef
        }

        // NOTE: Scope state management handled in the statement
        //  so it can be done differently based on syntax.
      }
    }
  }

  public endTypeDef(size: number) {
    this.checkPass(0)

    // NOTE: caller should have checked this and flagged an error
    if (this.typeDef) {

      const statement = this.curLine!.statement!

      if (this.typeStart) {
        this.typeStart.foldEnd = statement
        this.typeStart = undefined
      }

      const endLineIndex = this.curLine!.lineNumber
      this.typeDef.endDefinition(endLineIndex, size)
      this.typeDef = undefined

      // NOTE: Scope state management handled in the statement
      //  so it can be done differently based on syntax.
    }
  }
  // #endregion
  //------------------------------------
}

//------------------------------------------------------------------------------
// #region SymbolUtils
//------------------------------------------------------------------------------

import * as exp from "./expressions"
import { Op } from "./syntaxes/syntax_types"

export class SymbolUtils {

  markData(expression: exp.Expression) {
    const symExps: exp.SymbolExpression[] = []
    this.recurseSyms(expression, symExps)
    if (symExps.length == 1) {
      const symbol = symExps[0].symbol
      if (symbol) {
        const value = symbol.resolve()
        // *** do something special with Apple hardware addresses ***
        if (value && value >= 0xC000 && value <= 0xCFFF) {
          return
        }
        if (symbol.isConstant) {
          symExps[0].setWarning("Symbol used as both data address and constant")
        } else {
          symbol.isData = true
        }
      }
    }
  }

  markCode(expression: exp.Expression) {
    if (expression instanceof exp.SymbolExpression) {
      if (expression.symbol) {
        if (expression.symbol.isConstant) {
          expression.setWarning("Symbol used as both constant and code label")
        } else {
          expression.symbol.isCode = true
        }
      }
    }
  }

  markSubroutine(expression: exp.Expression) {
    if (expression instanceof exp.SymbolExpression) {
      if (expression.symbol) {
        if (expression.symbol.isConstant) {
          expression.setWarning("Symbol used as both constant and JSR target")
        } else {
          expression.symbol.isSubroutine = true
        }
      }
    }
  }

  markZPage(expression: exp.Expression) {
    const symExps: exp.SymbolExpression[] = []
    this.recurseSyms(expression, symExps)
    if (symExps.length == 1) {
      const symbol = symExps[0].symbol
      if (symbol) {
        const size = symbol.getSize() ?? 0
        if (size == 1) {
          if (symbol.isConstant) {
            symExps[0].setWarning("Symbol used as both ZP and constant")
          } else {
            symbol.isZPage = true
          }
        }
      }
    }
  }

  recurseSyms(expression: exp.Expression, symExps: exp.SymbolExpression[]) {
    if (expression instanceof exp.SymbolExpression) {
      symExps.push(expression)
      return
    }
    if (expression instanceof exp.UnaryExpression) {
      return
    }
    for (let i = 0; i < expression.children.length; i += 1) {
      const node = expression.children[i]
      if (node instanceof exp.Expression) {
        this.recurseSyms(node, symExps)
      }
    }
  }

  markConstants(expression: exp.Expression) {
    if (expression instanceof exp.SymbolExpression) {
      if (expression.symbol) {
        const size = expression.symbol.getSize() ?? 0
        if (size == 1) {
          if (expression.symbol.isZPage) {
            expression.setWarning("Symbol used as both ZPAGE and constant")
          } else if (expression.symbol.isSubroutine) {
            expression.setWarning("Symbol used as both JSR target and constant")
          } else {
            expression.symbol.isConstant = true
            // if this symbol is a constant, each expression of its value
            //  (excluding unary byte high/low) must also be a constant
            const value = expression.symbol.getValue()
            if (value) {
              this.markConstants(value)
            }
          }
        }
      }
      return
    }

    if (expression instanceof exp.UnaryExpression) {
      const opType = expression.opType
      if (opType == Op.LowByte
          || opType == Op.HighByte
          || opType == Op.BankByte) {
        return
      }
    }
    for (let i = 0; i < expression.children.length; i += 1) {
      const node = expression.children[i]
      if (node instanceof exp.Expression) {
        this.markConstants(node)
      }
    }
  }
}

// #endregion
//------------------------------------------------------------------------------
