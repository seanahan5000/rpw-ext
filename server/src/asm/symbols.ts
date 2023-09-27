
// *** does this need its own file? ***

import * as asm from "./assembler"
// import * as exp from "./expressions"
import * as xxx from "./x_expressions"

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

export enum SymbolType {
  Constant,     // 8-bit only? automatic in DUMMY 0?
  ZPage
  //Absolute/Address?
  //EntryPoint?
}

export class Symbol {
  public name: string
  // *** fullName (including scope?)
  public type?: SymbolType
  public sourceFile: asm.SourceFile
  public lineNumber: number           // *** Statement instead/also?
  public expression?: xxx.Expression
  public isLocal: boolean
  public isEntry: boolean

  constructor(name: string, file: asm.SourceFile, lineNumber: number, expression?: xxx.Expression) {
    this.name = name
    this.sourceFile = file
    this.lineNumber = lineNumber
    this.expression = expression
    this.isLocal = false
    this.isEntry = false
  }

  resolve(): number | undefined {
    return this.expression?.resolve()
  }

  getSize(): number | undefined {
    return this.expression?.getSize()
  }
}

export class PcSymbol extends Symbol {
  constructor(name: string, file: asm.SourceFile, lineNumber: number) {
    super(name, file, lineNumber, new xxx.PcExpression())
  }
}
