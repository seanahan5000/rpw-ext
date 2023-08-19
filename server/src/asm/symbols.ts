
// *** does this need its own file? ***

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
  // *** fullName (including scope?)
  public lineNumber: number           // *** Statement instead?
  public expression?: exp.Expression

  // *** is this really needed?
  private symbols: Symbols

  // definition source file
  // definition line number
  // or, Statement which has file and line?

  // import-link?
  // symbol type?

  constructor(symbols: Symbols, name: string, lineNumber: number, expression?: exp.Expression) {
    this.symbols = symbols
    this.name = name
    this.lineNumber = lineNumber
    this.expression = expression
  }
}

export class PcSymbol extends Symbol {
  constructor(symbols: Symbols, name: string, lineNumber: number) {
    super(symbols, name, lineNumber, new exp.PcExpression())
  }
}
