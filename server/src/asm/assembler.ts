
import { SourceFile, Module, LineRecord } from "./project"
import { Parser } from "./parser"
import { ScopeState } from "./symbols"
import { SymbolExpression } from "./expressions"
import { Statement, Conditional, ConditionalStatement, OpStatement } from "./statements"


// *** where are vscode column markers? ***
// *** check my keyboard shortcuts ***


// *** Project class should hold all Modules for entire project, in build order
  // also tracks ENT linkage between them

// *** Module class should hold all files and symbols for one ASM.* module

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

// *** guess syntax by watching keywords? ***
// *** include file step should move outside of parsing pass
  // *** needs to be affected by conditionals ***
// *** if statement parsing fails with general syntax, try again using likelySyntax

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

    const conditional = new Conditional()

    // *** this is ugly ***
    const parser = new Parser(this)
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

          lineRecord.statement = parser.parseStatement(
            lineRecord.sourceFile,
            lineRecord.lineNumber,
            this.fileReader.state.file.lines[lineRecord.lineNumber])

          if (lineRecord.statement instanceof ConditionalStatement) {
            // need symbol references hooked up before resolving conditional expression
            this.processSymbols(lineRecord.statement, true)
            lineRecord.statement.applyConditional(conditional)
          } else {
            if (!conditional.isEnabled()) {
              lineRecord.statement = new Statement()
            } else {
              this.processSymbols(lineRecord.statement, true)
            }
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

    // process all remaining symbols
    for (let i = 0; i < this.module.lineRecords.length; i += 1) {
      const statement = this.module.lineRecords[i].statement
      if (statement) {
        this.processSymbols(statement, false)

        if (statement instanceof OpStatement) {
          statement.postSymbols()
        }
      }
    }

    // *** problems here -- unused ZPAGE turned into constants
    // For all symbols that aren't already marked ZPAGE,
    //  mark any whose resolvable value fits in a byte as a constant
    //
    // TODO: only do this when a project is present
    // for (const symbol of this.module.symbolMap.values()) {
    //   if (!symbol.isZPage) {
    //     const valueExp = symbol.getValue()
    //     if (valueExp) {
    //       const value = valueExp.resolve()
    //       if (value != undefined) {
    //         if (value >= -127 && value <= 255) {
    //           symbol.isConstant = true
    //         }
    //       }
    //     }
    //   }
    // }
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

  includeFile(fileName: string): boolean {
    const sourceFile = this.module.openSourceFile(fileName)
    if (!sourceFile) {
      return false
    }
    this.fileReader.push(sourceFile)
    return true
  }
}

//------------------------------------------------------------------------------
