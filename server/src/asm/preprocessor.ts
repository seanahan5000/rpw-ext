
import { SourceFile, Module, LineRecord } from "./project"
import { Statement, ConditionalStatement, GenericStatement, IncludeStatement } from "./statements"
import { ScopeState, SymbolFrom } from "./symbols"
import { SymbolExpression } from "./expressions"

//------------------------------------------------------------------------------

type ConditionalState = {
  enableCount: number,
  satisfied: boolean,
  statement?: ConditionalStatement
}

export class Conditional {
  private enableCount = 1
  private satisfied = true
  public statement?: ConditionalStatement
  private stack: ConditionalState[] = []

  public push(): boolean {
    // set an arbitrary limit on stack size to catch infinite recursion
    if (this.stack.length > 255) {
      return false
    }
    this.stack.push({ enableCount: this.enableCount, satisfied: this.satisfied, statement: this.statement})
    this.enableCount -= 1
    this.satisfied = false
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
      this.satisfied = state.satisfied
      this.statement = state.statement
    }
    return true
  }

  public setSatisfied(satisfied: boolean) {
    this.satisfied = satisfied
  }

  public isSatisfied(): boolean {
    return this.satisfied
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

export class Preprocessor {

  public module: Module
  private fileReader = new FileReader()
  private conditional = new Conditional()
  private scopeState = new ScopeState()

  constructor(module: Module) {
    this.module = module
  }

  preprocess(fileName: string): LineRecord[] | undefined {
    const lineRecords: LineRecord[] = []

    if (!this.includeFile(fileName)) {
      // *** error messaging?
      return
    }

    while (this.fileReader.state.file) {
      do {
        while (this.fileReader.state.curLineIndex < this.fileReader.state.endLineIndex) {

          const lineRecord: LineRecord = {
            sourceFile: this.fileReader.state.file,
            lineNumber: this.fileReader.state.curLineIndex,
            statement: undefined
          }

          lineRecord.statement = this.fileReader.state.file.statements[lineRecord.lineNumber]
          // *** mark statement as used to detect multiple references? ***

          // must advance before parsing that may include a different file
          this.fileReader.state.curLineIndex += 1

          if (lineRecord.statement instanceof ConditionalStatement) {
            // need symbol references hooked up before resolving conditional expression
            this.processSymbols(lineRecord.statement, true)
            lineRecord.statement.applyConditional(this.conditional)
          } else {
            if (!this.conditional.isEnabled()) {
              // TODO: reconcile lineRecord and statement use on disabled lines
              lineRecord.statement.enabled = false
              lineRecord.statement = new GenericStatement()
            } else {
              if (lineRecord.statement instanceof IncludeStatement) {
                lineRecord.statement.preprocess(this)
              }
              this.processSymbols(lineRecord.statement, true)
            }
          }

          // don't add new statement if shared file already has one
          if (lineRecord.sourceFile.statements.length == lineRecord.lineNumber) {
            if (lineRecord.statement) {
              lineRecord.sourceFile.statements.push(lineRecord.statement)
            }
          }

          lineRecords.push(lineRecord)
        }
        this.fileReader.state.curLineIndex = this.fileReader.state.startLineIndex;
      } while (--this.fileReader.state.loopCount > 0)
      this.fileReader.pop()
    }

    // process all remaining symbols
    const symUtils = new SymbolUtils()
    for (let lineRecord of lineRecords) {
      const statement = lineRecord.statement
      if (statement) {
        this.processSymbols(statement, false)
        statement.postProcessSymbols(symUtils)
      }
    }

    return lineRecords
  }

  includeFile(fileName: string): boolean {
    const sourceFile = this.module.openSourceFile(fileName)
    if (!sourceFile) {
      return false
    }
    sourceFile.parseStatements()
    this.fileReader.push(sourceFile)
    return true
  }

  // *** put in module instead? ***
  // *** later, when scanning disabled lines, still process references ***
  private processSymbols(statement: Statement, firstPass: boolean) {
    // *** maybe just stop on error while walking instead of walking twice
    if (!statement.hasAnyError()) {
      statement.forEachExpression((expression) => {
        if (expression instanceof SymbolExpression) {
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
                  const sharedSym = this.module.project.sharedSymbols.get(symExp.fullName)
                  if (symExp.symbol.isEntryPoint) {
                    if (sharedSym) {
                      symExp.setError("Duplicate entrypoint")
                      sharedSym.definition.setError("Duplicate entrypoint")
                      return
                    }
                    symExp.symbol.fullName = symExp.fullName
                    this.module.project.sharedSymbols.set(symExp.fullName, symExp.symbol)
                    this.module.symbolMap.set(symExp.fullName, symExp.symbol)
                  } else {
                    if (sharedSym) {
                      // this definition matches a shared symbol, so it's probably from an EXT file
                      if (symExp.symbol.from != SymbolFrom.Equate) {
                        symExp.setError("Label conflict with entrypoint")
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
                symExp.symbol = foundSym
                symExp.symbolType = foundSym.type
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