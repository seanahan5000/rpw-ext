
import * as asm from "./assembler"
import * as exp from "./x_expressions"
import { Token } from "./tokenizer"

// *** what do generated addresses look like?
  // *** PcExpression?
// *** what about locals? constants?

export enum SymbolType {
  Simple      = 0,
  Scoped      = 1,  // explicit scope, fully specified
  CheapLocal  = 2,  // scoped to previous non-local
  ZoneLocal   = 3,  // scoped to SUBROUTINE or !zone
  AnonLocal   = 4,  // ++ or --
  LisaLocal   = 5,  // ^# def, <# or ># ref

  // Macro          // local inside of macro?
  // Global
  // External
}

export enum SymbolFrom {
  Unknown   = 0,
  Equate    = 1,
  Statement = 2,
  // Structure = 3,
  // Macro
}

export enum SymbolIs {
  Unknown   = 0,
  Constant  = 1,    // 8-bit only? automatic in DUMMY 0?
  ZPage     = 2,
  // Address   = 3,
  // External  = 4,
  // Entry     = 5,
}

//------------------------------------------------------------------------------

// *** is there value in this class anymore? ***
export class Symbols {
  public map = new Map<string, Symbol>

  add(symbol: Symbol): boolean {
    if (!symbol.fullName) {
      return false
    }
    if (this.map.get(symbol.fullName)) {
      return false
    }
    this.map.set(symbol.fullName, symbol)
    return true
  }

  find(fullName: string): Symbol | undefined {
    return this.map.get(fullName)
  }
}

export class Symbol {
  // NOTE: Linking a statment instead is complicated by the fact that the
  //  statement hasn't been created yet at the time of symbol creation.
  public sourceFile: asm.SourceFile
  public lineNumber: number

  // Name is assigned later, after scope information is processed
  //  and symbol has been added to map.
  public fullName?: string
  private value?: exp.Expression

  public type: SymbolType
  public from = SymbolFrom.Unknown
  public is = SymbolIs.Unknown

  constructor(type: SymbolType, file: asm.SourceFile, lineNumber: number) {
    this.type = type
    this.sourceFile = file
    this.lineNumber = lineNumber
  }

  getValue(): exp.Expression | undefined {
    return this.value
  }

  setValue(value: exp.Expression, from: SymbolFrom) {
    this.value = value
    this.from = from
  }

  resolve(): number | undefined {
    return this.value?.resolve()
  }

  getSize(): number | undefined {
    return this.value?.getSize()
  }
}

// export class PcSymbol extends Symbol {
//   // *** name is fullName? ***
//   constructor(name: string, file: asm.SourceFile, lineNumber: number) {
//     super(name, file, lineNumber, new exp.PcExpression())
//   }
// }

//------------------------------------------------------------------------------

export class ScopeState {

  private scopePath?: string
  private scopeStack: string[] = []

  private zoneName?: string
  private zoneStack: string[] = []
  private zoneIndex = 0

  private cheapScope = "__d"

  private anonCounts = new Array(20).fill(0)

  pushScope(scopeName: string) {
    if (this.scopePath) {
      this.scopeStack.push(this.scopePath)
      this.scopePath = this.scopePath + scopeName
    } else {
      this.scopePath = scopeName
    }
  }

  popScope() {
    this.scopePath = this.scopeStack.pop()
  }

  pushZone(zoneName?: string) {
    if (this.zoneName) {
      this.zoneStack.push(this.zoneName)
    }
    this.setZone(zoneName)
  }

  setZone(zoneName?: string) {
    if (!zoneName) {
      zoneName = "__z" + this.zoneIndex.toString()
      this.zoneIndex += 1
    }
    this.zoneName = zoneName
  }

  popZone() {
    this.zoneName = this.zoneStack.pop()
  }

  setCheapScope(cheapScope: string) {
    if (this.scopePath) {
      this.cheapScope = this.scopePath + cheapScope
    } else {
      this.cheapScope = cheapScope
    }
  }

  setSymbolExpression(symExp: exp.SymbolExpression): string {

    switch (symExp.symbolType) {

      case SymbolType.Simple: {
        const nameToken = symExp.children[0]
        if (nameToken instanceof Token) {
          if (this.scopePath) {
            return this.scopePath + ":" + nameToken.getString()
          } else {
            return nameToken.getString()
          }
        }
        break
      }

      // NOTE: This currently only supports explicit scoping.
      // TODO: support scope searching used by CA65?
      case SymbolType.Scoped: {
        let result = ""
        symExp.children.forEach(child => {
          if (child instanceof Token) {
            const str = child.getString()
            if (str[0] == ":") {
              if (result != "") {
                result = result + ":"
              }
            } else {
              result = result + str
            }
          }
        })
        return result
      }

      case SymbolType.CheapLocal: {
        const nameToken = symExp.children[1]
        if (nameToken instanceof Token) {
          let result = this.cheapScope + ":" + nameToken.getString()
          if (this.scopePath) {
            result = this.scopePath + ":" + result
          }
          return result
        }
        break
      }

      case SymbolType.ZoneLocal: {
        const nameToken = symExp.children[1]
        if (nameToken instanceof Token) {
          return this.zoneName + ":" + nameToken.getString()
        }
        break
      }

      case SymbolType.AnonLocal: {
        const nameToken = symExp.children[0]
        if (nameToken instanceof Token) {
          const name = nameToken.getString()
          let index = name.length
          let offset = 0
          if (name[0] == "+") {
            index += 10
          } else {
            offset = -1
          }
          let outIndex = this.anonCounts[index] + offset
          if (symExp.isDefinition) {
            this.anonCounts[index] += 1
          }
          return `__a${index}_${outIndex}`
        }
        break
      }

      case SymbolType.LisaLocal: {
        const nameToken = symExp.children[0]
        if (nameToken instanceof Token) {
          const indexToken = symExp.children[1]
          if (indexToken instanceof Token) {
            const index = parseInt(indexToken.getString())
            const prefix = nameToken.getString()
            let outIndex = this.anonCounts[index]
            if (prefix == "^") {
              this.anonCounts[index] += 1
            } else if (prefix == "<") {
              outIndex -= 1
            }
            return `__a${index}_${outIndex}`
          }
        }
        break
      }
    }

    return ""
  }
}

//------------------------------------------------------------------------------
