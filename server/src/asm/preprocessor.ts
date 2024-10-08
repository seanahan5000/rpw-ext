
import { SourceFile, Module, LineRecord } from "./project"
import { Statement, ConditionalStatement, GenericStatement, ClosingBraceStatement, EquStatement, MacroDefStatement, RepeatStatement, MacroInvokeStatement } from "./statements"
import { ScopeState, SymbolType, SymbolFrom } from "./symbols"
import { SymbolExpression } from "./expressions"

// just for the CA65 macro invoke work-around
import { Parser } from "./parser"
import { Syntax } from "./syntax"

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

class MacroDef {

  // TODO: fill in guts

  constructor(name: SymbolExpression) {
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
  Count
}

type NestingEntry = {
  type: NestingType
  statement: Statement
  bracePopProc?: () => void
}

export class Preprocessor {

  public module: Module
  private fileReader = new FileReader()
  public conditional = new Conditional()
  public scopeState = new ScopeState()
  private curLine?: LineRecord
  private macroDef?: MacroDef
  private macroStart?: Statement
  private syntaxStats: number[] = []

  private nestingStack: NestingEntry[] = []
  private nestingCounts: number[] = new Array(NestingType.Count).fill(0)

  constructor(module: Module) {
    this.module = module
  }

  // (pass 1)
    // parse all statements in all connected source files (no symbol linkage)
  // (pass 2)
    // walk each line, tracking conditional state
      // enable/disable line
      // Statement.preprocess(enabled)
        // handle file includes and state push/pop
      // Preprocessor.processSymbols(firstPass = true)
        // symbol scope tracking
        // create symbol definitions
        // some symbol reference linking
    // rewalk each line
      // Preprocessor.processSymbols(firstPass = false)
        // remaining symbol reference linking
      // statement.postProcessSymbols()
        // mark symbols as constants/code/etc.

  preprocess(fileName: string, syntaxStats: number[]): LineRecord[] | undefined {
    const lineRecords: LineRecord[] = []
    this.syntaxStats = syntaxStats

    // NOTE: this causes each source line of each source file to be parsed first
    if (!this.includeFile(fileName)) {
      // *** error messaging?
      return
    }

    while (this.fileReader.state.file) {
      do {
        while (this.fileReader.state.curLineIndex < this.fileReader.state.endLineIndex) {

          const line: LineRecord = {
            sourceFile: this.fileReader.state.file,
            lineNumber: this.fileReader.state.curLineIndex,
            statement: undefined
          }

          this.curLine = line

          line.statement = this.fileReader.state.file.statements[line.lineNumber]
          // *** mark statement as used to detect multiple references? ***

          // must advance before parsing that may include a different file
          this.fileReader.state.curLineIndex += 1

          let conditional = false
          if (line.statement instanceof ConditionalStatement) {
            conditional = true

            // determine if ClosingBraceStatement actually a conditional operation
            if (line.statement instanceof ClosingBraceStatement) {
              if (this.nestingStack.length > 0) {
                conditional = (this.nestingStack[this.nestingStack.length - 1].type == NestingType.Conditional)
              }
            }

            if (conditional) {
              // need symbol references hooked up before resolving conditional expression
              this.processSymbols(line.statement, true)
              // TODO: consider folding applyConditional into preprocess
              line.statement.applyConditional(this)
            }
          }

          if (!conditional) {
            const enabled = this.conditional.isEnabled()
            if (enabled) {
              // CA65 allows macro invokes in the first column,
              //  so if the label of this statement matches a
              //  known macro name, convert it to a macro invoke
              //  statement and reparse.
              //
              // TODO: Find a better location for this and
              //  a less-brittle solution for the problem.
              if (this.module.project.syntax == Syntax.CA65) {
                if (line.statement.labelExp) {
                  const labelName = line.statement.labelExp.getString()
                  const foundSym = this.module.symbolMap.get(labelName)
                  if (foundSym && foundSym.type == SymbolType.MacroName) {
                    const parser = new Parser()
                    const newStatement = parser.reparseAsMacroInvoke(line.statement, this.module.project.syntax)
                    if (newStatement) {
                      line.statement = newStatement
                      this.fileReader.state.file.statements[line.lineNumber] = newStatement
                    }
                  }
                }
              }
              line.statement.preprocess(this, enabled)
              this.processSymbols(line.statement, true)
            } else {
              line.statement.preprocess(this, enabled)
              // TODO: reconcile lineRecord and statement use on disabled lines
              line.statement.enabled = false
              line.statement = new GenericStatement()
            }
          }

          // don't add new statement if shared file already has one
          if (line.sourceFile.statements.length == line.lineNumber) {
            if (line.statement) {
              line.sourceFile.statements.push(line.statement)
            }
          }

          lineRecords.push(line)
        }
        this.fileReader.state.curLineIndex = this.fileReader.state.startLineIndex;
      } while (--this.fileReader.state.loopCount > 0)
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

    // process all remaining symbols
    const symUtils = new SymbolUtils()
    for (let line of lineRecords) {
      const statement = line.statement
      if (statement) {
        this.processSymbols(statement, false)
        statement.postProcessSymbols(symUtils)
      }
    }

    return lineRecords
  }

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

  public inMacroDef(): boolean {
    return this.macroDef != undefined
  }

  // TODO: pass in parameter list too?
  public startMacroDef(macroName: SymbolExpression) {
    // NOTE: caller should have checked this and flagged an error
    if (!this.macroDef) {
      this.macroStart = this.curLine!.statement
      this.macroDef = new MacroDef(macroName)

      // TODO: does this scope handling make sense for all syntaxes?
      this.scopeState.pushScope(macroName.getString())
    }
  }

  public endMacroDef() {
    // NOTE: caller should have checked this and flagged an error
    if (this.macroDef) {

      if (this.macroStart) {
        this.macroStart.foldEnd = this.curLine!.statement
        this.macroStart = undefined
      }

      // TODO: does this scope handling make sense for all syntaxes?
      this.scopeState.popScope()

      this.macroDef = undefined
    }
  }

  public topNestingType(): NestingType | undefined {
    const length = this.nestingStack.length
    return length > 0 ? this.nestingStack[length - 1].type : undefined
  }

  public isNested(type: NestingType): boolean {
    return this.nestingCounts[type] != 0
  }

  public pushNesting(type: NestingType, bracePopProc?: () => void) {
    if (this.curLine!.statement) {
      this.nestingStack.push({ type, statement: this.curLine!.statement, bracePopProc})
      this.nestingCounts[type] += 1
    }
  }

  // NOTE: Caller will have already verified there's an entry
  //  to pop and that it's the correct one.
  public popNesting(bracePop = false): boolean {
    const entry = this.nestingStack.pop()
    if (entry) {
      if (this.nestingCounts[entry.type]) {
        this.nestingCounts[entry.type] -= 1
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

  // *** put in module instead? ***
  // *** later, when scanning disabled lines, still process references ***
  private processSymbols(statement: Statement, firstPass: boolean) {
    // *** maybe just stop on error while walking instead of walking twice
    if (!statement.hasAnyError()) {
      statement.forEachExpression((expression) => {
        if (expression instanceof SymbolExpression) {
          const symExp = expression

          // look for symbol references that should be converted to variables
          if (firstPass && !symExp.isDefinition) {
            // NOTE: if this changes, also change setSymbolExpression
            const variableName = symExp.getString()
            const foundVar = this.module.variableMap.get(variableName)
            if (foundVar) {
              symExp.symbol = foundVar
              symExp.symbolType = foundVar.type
              symExp.fullName = foundVar.fullName
            }
          }

          // must do this in the first pass while scope is being tracked
          if (!symExp.fullName) {
            symExp.fullName = this.scopeState.setSymbolExpression(symExp)
          }
          if (symExp.fullName) {
            if (symExp.isDefinition) {
              if (firstPass) {
                if (!symExp.isVariableType()) {
                  const foundSym = this.module.symbolMap.get(symExp.fullName)
                  if (foundSym) {
                    if (symExp.symbolFrom != SymbolFrom.Import) {
                      symExp.setError("Duplicate symbol (use Go To Definition)")
                    }
                    // turn symExp into a reference to the original symbol
                    symExp.symbol = foundSym
                    symExp.isDefinition = false
                    foundSym.addReference(symExp)
                    return
                  }
                }
                if (symExp.symbol) {
                  if (symExp.isVariableType()) {
                    // only add the first reference to a variable
                    const foundVar = this.module.variableMap.get(symExp.fullName)
                    if (!foundVar) {
                      this.module.variableMap.set(symExp.fullName, symExp.symbol)
                    }
                    return
                  }

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
                }
              }
            } else if (!symExp.symbol) {
              const foundSym = this.module.symbolMap.get(symExp.fullName)
              if (foundSym) {
                if (foundSym == statement.labelExp?.symbol && statement instanceof EquStatement) {
                  symExp.setError("Circular symbol reference")
                } else {
                  symExp.symbol = foundSym
                  symExp.symbolType = foundSym.type
                  symExp.fullName = foundSym.fullName
                  foundSym.addReference(symExp)
                }
              } else {
                // TODO: For now, don't report any missing symbols within
                //  a macro definition.  This should eventually look at
                //  named macro parameters and match against those. (ca65-only?)
                if (firstPass && this.inMacroDef()) {
                  // TODO: be smarter about scoping locals
                  if (!symExp.isLocalType()) {
                    symExp.suppressUnknown = true
                  }
                }
                if (!symExp.suppressUnknown) {
                  // TODO: make temporary project check a setting
                  if (symExp.isLocalType() || !this.module.project.isTemporary) {
                    if (symExp.symbolType == SymbolType.MacroName) {
                      symExp.setError("Unknown macro or opcode")
                    } else if (!firstPass) {
                      symExp.setError("Symbol not found")
                    }
                  }
                }
              }
            }
          }
        }
      })
    }
  }
}

//------------------------------------------------------------------------------

import * as exp from "./expressions"
import { Op } from "./syntax"

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
            symExps[0].setWarning("Symbol used as both ZPAGE and constant")
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

//------------------------------------------------------------------------------
