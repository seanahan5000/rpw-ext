
import { SourceFile } from "./assembler"
import * as exp from "./x_expressions"
import { Token } from "./tokenizer"

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

export function isLocalType(symbolType: SymbolType): boolean {
  return symbolType >= SymbolType.CheapLocal
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

export class Symbol {
  public type: SymbolType
  public from = SymbolFrom.Unknown
  public is = SymbolIs.Unknown

  public definition: exp.SymbolExpression
  public references: exp.SymbolExpression[] = []
  private value?: exp.Expression

  // Name is assigned later, after scope information is processed
  //  and symbol has been added to map.
  public fullName?: string

  constructor(type: SymbolType, definition: exp.SymbolExpression) {
    this.type = type
    this.definition = definition
  }

  addReference(symExp: exp.SymbolExpression) {
    this.references.push(symExp)
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

//------------------------------------------------------------------------------

export class ScopeState {

  private scopePath?: string
  private scopeStack: string[] = []

  private zoneName?: string
  private zoneStack: string[] = []
  private zoneIndex = 0

  private cheapScope = "__d"

  private anonCounts = new Array(20).fill(0)

  setSymbolExpression(symExp: exp.SymbolExpression): string {

    switch (symExp.symbolType) {

      case SymbolType.Simple: {
        const nameToken = symExp.children[0]
        if (nameToken && !(nameToken instanceof Token)) {
          break
        }
        if (!nameToken && !symExp.isZoneStart) {
          break
        }

        let nameStr: string
        if (nameToken) {
          nameStr = nameToken.getString()
        } else {
          nameStr = "__z" + this.zoneIndex.toString()
          this.zoneIndex += 1
        }

        if (this.scopePath) {
          nameStr = this.scopePath + ":" + nameStr
        }
        if (symExp.isDefinition) {
          this.cheapScope = nameStr
          if (symExp.isZoneStart) {
            this.zoneName = nameStr
          }
        }
        return nameStr
      }

      // NOTE: This currently only supports explicit scoping.
      // TODO: support scope searching used by CA65?
      case SymbolType.Scoped: {
        let result = ""
        if (!symExp.isDefinition) {
          for (let i = 0; i < symExp.children.length; i += 1) {
            const child = symExp.children[i]
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
          }
        }
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

  // future possible methods

  private pushScope(scopeName: string) {
    if (this.scopePath) {
      this.scopeStack.push(this.scopePath)
      this.scopePath = this.scopePath + scopeName
    } else {
      this.scopePath = scopeName
    }
  }

  private popScope() {
    this.scopePath = this.scopeStack.pop()
  }

  private pushZone(zoneName?: string) {
    if (this.zoneName) {
      this.zoneStack.push(this.zoneName)
    }
    this.setZone(zoneName)
  }

  private setZone(zoneName?: string) {
    if (!zoneName) {
      zoneName = "__z" + this.zoneIndex.toString()
      this.zoneIndex += 1
    }
    this.zoneName = zoneName
  }

  private popZone() {
    this.zoneName = this.zoneStack.pop()
  }
}

//------------------------------------------------------------------------------
