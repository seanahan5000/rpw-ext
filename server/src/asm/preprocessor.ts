
import { LineRecord } from "./project"
import { Assembler, NestingType } from "./assembler"
import { Statement, ConditionalStatement, GenericStatement, ClosingBraceStatement, EquStatement, ContinuedStatement } from "./statements"
import { DefineDefStatement } from "./statements"
import { SymbolType, SymbolFrom } from "./symbols"
import { SymbolExpression } from "./expressions"

// just for the CA65 macro invoke work-around
import { Parser } from "./parser"
import { Syntax } from "./syntaxes/syntax_types"

//------------------------------------------------------------------------------

export class Preprocessor extends Assembler {

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

    // *** might be undefined for some syntaxes?
    this.currentPC = this.module.project.syntaxDef.defaultOrg
    this.nextPC = undefined

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

          this.currentLine = line
          line.statement = this.fileReader.state.file.statements[line.lineNumber]

          // must advance before parsing that may include a different file
          this.fileReader.state.curLineIndex += 1

          // assign PC to "*" expressions now that it's known
          if (!(line.statement instanceof ContinuedStatement)) {
            line.statement.forEachExpression((expression) => {
              if (expression instanceof exp.PcExpression) {
                expression.setValue(this.currentPC)
              }
            })
          }

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

              // *** maybe call processSymbolRefs instead ***?

              // need symbol references hooked up before resolving conditional expression
              this.processSymbols(line.statement, true)
              // *** TODO: consider folding applyConditional into preprocess
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
                  if (foundSym && foundSym.type == SymbolType.TypeName) {
                    const parser = new Parser()
                    const newStatement = parser.reparseAsMacroInvoke(line.statement, this.module.project.syntax)
                    if (newStatement) {
                      line.statement = newStatement
                      this.fileReader.state.file.statements[line.lineNumber] = newStatement
                    }
                  }
                }
              }

              // NOTE: need to push zone before processing named params
              line.statement.preprocess(this, enabled)
              this.processSymbols(line.statement, true)

              // force a popScope after a DefineDefStatement because its scope
              //  only last for that line until its symbols have been processed
              if (line.statement instanceof DefineDefStatement) {
                line.statement.endPreprocess(this, enabled)
              }
            } else {
              // NOTE: no need to process symbols here because line is disabled
              line.statement.preprocess(this, enabled)
              // TODO: reconcile lineRecord and statement use on disabled lines
              line.statement.enabled = false
              line.statement = new GenericStatement()
            }
          }

          line.statement.PC = this.currentPC
          if (this.nextPC !== undefined) {
            this.currentPC = this.nextPC
            this.nextPC = undefined
          } else {
            const deltaPC = line.statement.getSize() ?? 0
            // *** TODO: if size undefined, mark error? ***
            this.currentPC += deltaPC
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

    this.currentLine = undefined

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

  // assign symbol's full name, possibly before scope changes
  public preprocessSymbol(symExp: SymbolExpression) {
    if (!symExp.fullName) {
      symExp.fullName = this.scopeState.setSymbolExpression(symExp)
    }
  }

  // TODO: get rid of this after switch to real assembly
  // *** maybe pass in expression instead?
  public processSymbolRefs(statement: Statement) {
    statement.forEachExpression((expression) => {
      if (expression instanceof SymbolExpression) {
        const symExp = expression
        if (!symExp.isDefinition && !symExp.isLocalType() && !symExp.isVariableType()) {
          if (!symExp.fullName) {
            // assume caller is in first pass so scope is valid here
            symExp.fullName = this.scopeState.setSymbolExpression(symExp)
          }
          if (symExp.fullName && !symExp.symbol) {
            const foundSym = this.module.symbolMap.get(symExp.fullName)
            if (foundSym) {
                symExp.symbol = foundSym
                symExp.symbolType = foundSym.type
                symExp.fullName = foundSym.fullName
                foundSym.addReference(symExp)
            }
          }
        }
      } else if (expression instanceof exp.PcExpression) {
        expression.setValue(this.currentPC)
      }
    })
  }

  // *** put in module instead? ***
  // *** split out first pass code?
  // *** later, when scanning disabled lines, still process references ***
  private processSymbols(statement: Statement, firstPass: boolean) {
    // *** maybe just stop on error while walking instead of walking twice
    if (!statement.hasAnyError() && !(statement instanceof ContinuedStatement)) {
      statement.forEachExpression((expression) => {
        if (expression instanceof SymbolExpression) {

          const symExp = expression

          if (firstPass && !symExp.isDefinition) {

            const symName = symExp.getString()

            // look for symbol references that are macro parameters
            // *** or struct or union ***
            // *** look at nesting? ***
            if (this.typeDef && !symExp.symbol) {
              let paramName = symName
              if (this.syntaxDef.namedParamPrefixes.includes(symName[0])) {
                paramName = symName.substring(1)
              }
              const foundParam = this.typeDef.getParamMap().get(paramName)
              if (foundParam) {
                symExp.symbol = foundParam
                symExp.symbolType = foundParam.type
                symExp.fullName = foundParam.fullName
                foundParam.addReference(symExp)
              }
            }

            // look for symbol references that should be converted to variables
            // NOTE: if this changes, also change setSymbolExpression
            const foundVar = this.module.variableMap.get(symName)
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
                    if (symExp.symbolFrom != SymbolFrom.Import && !symExp.isWeak) {
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
                if (firstPass && this.inTypeDef()) {
                  // TODO: be smarter about scoping locals
                  if (!symExp.isLocalType()) {
                    symExp.isWeak = true
                  }
                }
                if (!symExp.isWeak) {
                  // TODO: make temporary project check a setting
                  if (symExp.isLocalType() || !this.module.project.isTemporary) {
                    if (symExp.symbolType == SymbolType.TypeName) {
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
