
// *** does this need its own file? ***

import * as asm from "./assembler"
import * as exp from "./expressions"

// *** what do generated addresses look like?
  // *** PcExpression?
// *** what about locals? constants?


export class Symbols {
  public map = new Map<string, Symbol>
  private parentScope?: Symbols
  // children scopes?
  // type (global/module/local/import-link?/macro?)

  constructor(parentScope?: Symbols) {
    this.parentScope = parentScope
  }

  add(symbol: Symbol): boolean {
    if (this.map.get(symbol.name)) {
      return false
    }
    this.map.set(symbol.name, symbol)
    return true
  }

  find(name: string): Symbol | undefined {
    let symbol = this.map.get(name)
    // *** should scope walking be here or external? ***
    if (!symbol && this.parentScope) {
      symbol = this.parentScope.find(name)
    }
    return symbol
  }
}

export class Symbol {
  public name: string
  public sourceFile: asm.SourceFile
  // *** fullName (including scope?)
  public lineNumber: number           // *** Statement instead?
  public expression?: exp.Expression
  // *** is entry point ***

  // definition source file
  // definition line number
  // or, Statement which has file and line?

  // import-link?
  // symbol type?

  constructor(name: string, file: asm.SourceFile, lineNumber: number, expression?: exp.Expression) {
    this.name = name
    this.sourceFile = file
    this.lineNumber = lineNumber
    this.expression = expression
  }
}

export class PcSymbol extends Symbol {
  constructor(name: string, file: asm.SourceFile, lineNumber: number) {
    super(name, file, lineNumber, new exp.PcExpression())
  }
}
