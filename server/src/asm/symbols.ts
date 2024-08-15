
import { Token } from "./tokenizer"
import { Expression, SymbolExpression} from "./expressions"

//------------------------------------------------------------------------------

export enum SymbolType {
  Variable    = 0,
  MacroName   = 1,

  Simple      = 2,
  Scoped      = 3,  // explicit scope, fully specified

  CheapLocal  = 4,  // scoped to previous non-local
  ZoneLocal   = 5,  // scoped to SUBROUTINE or !zone
  AnonLocal   = 6,  // ++ or --
  LisaLocal   = 7,  // ^# def, <# or ># ref
  CA65Local   = 8,  // : def, :+ or :- ref
}

export function isLocalType(symbolType: SymbolType): boolean {
  return symbolType >= SymbolType.CheapLocal
}

export enum SymbolFrom {
  Unknown    = 0,
  Org        = 1,   // implicit from current org
  Equate     = 2,   // assigned with "="
  Import     = 3,   // .import statement
  MacroParam = 4    // macro input parameter
}

//------------------------------------------------------------------------------

// TODO: isolate info shared by SymbolExpression and Symbol (SymbolTemplate?)

export class Symbol {
  public from: SymbolFrom

  // NOTE: could pack these into bits
  public isZPage = false
  public isConstant = false     // 8-bit only? automatic in DUMMY 0?
  public isSubroutine = false
  public isData = false
  public isCode = false

  // set by ENT command
  public isEntryPoint = false

  // set by SUBROUTINE and .zone commands
  public isZoneStart = false

  public definition: SymbolExpression
  public references: SymbolExpression[] = []
  private value?: Expression

  // Name is assigned later, after scope information is processed
  //  and symbol has been added to map.
  public fullName?: string

  constructor(definition: SymbolExpression, from: SymbolFrom) {
    this.definition = definition
    this.from = from
  }

  get type(): SymbolType {
    return this.definition.symbolType
  }

  addReference(symExp: SymbolExpression) {
    this.references.push(symExp)
  }

  getValue(): Expression | undefined {
    return this.value
  }

  setValue(value: Expression, from: SymbolFrom) {
    this.value = value
    this.from = from
  }

  resolve(): number | undefined {
    return this.value?.resolve()
  }

  getSize(): number | undefined {
    return this.value?.getSize()
  }

  // get symbol name without scope, local prefix, or trailing ":"
  //  (mainly used to rename symbols)
  getSimpleNameToken(symExp: SymbolExpression): Token {
    let index = symExp.children.length - 1
    let token = symExp.children[index]
    if (index > 0 && token.getString() == "::") {
      token = symExp.children[index - 1]
    }
    return <Token>token
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
  private anonIndex = 0     // CA65-only

  setSymbolExpression(symExp: SymbolExpression): string | undefined {

    switch (symExp.symbolType) {

      case SymbolType.Variable: {
        // TODO: just getSimpleNameToken instead?
        // NOTE: if this changes, also change processSymbols in preprocessor.ts
        return symExp.getString()
      }

      case SymbolType.MacroName: {
        let nameToken = symExp.children[0]
        let nameStr = nameToken?.getString() ?? ""
        if (nameStr == "+") {
          nameToken = symExp.children[1]
          nameStr = nameToken?.getString() ?? ""
        }
        return nameStr
      }

      case SymbolType.Simple: {
        const nameToken = symExp.children[0]
        if (nameToken && !(nameToken instanceof Token)) {
          break
        }
        if (!nameToken && !symExp.symbol?.isZoneStart) {
          break
        }

        let nameStr: string
        if (nameToken) {
          nameStr = nameToken.getString()
        } else {
          nameStr = "__z" + this.zoneIndex.toString()
          this.zoneIndex += 1
        }

        const symFrom = symExp.symbol?.from ?? SymbolFrom.Unknown

        if (this.scopePath) {
          nameStr = this.scopePath + "::" + nameStr
        }

        if (symExp.isDefinition && symExp.symbol) {
          // Only implicit symbols should change local scope,
          //  not assignments or imports.
          if (symFrom == SymbolFrom.Org) {
            this.cheapScope = nameStr
            if (symExp.symbol.isZoneStart) {
              this.zoneName = nameStr
            }
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
              if (str == "::") {
                if (result != "") {
                  result = result + "::"
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
          let result = this.cheapScope + "::" + nameToken.getString()
          if (this.scopePath) {
            result = this.scopePath + "::" + result
          }
          return result
        }
        break
      }

      case SymbolType.ZoneLocal: {
        const nameToken = symExp.children[1]
        if (nameToken instanceof Token) {
          return this.zoneName + "::" + nameToken.getString()
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
          } else if (!symExp.isDefinition) {
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

      case SymbolType.CA65Local: {
        const nameToken = symExp.children[0]
        if (nameToken instanceof Token) {
          let offset = 0
          if (symExp.isDefinition) {
            this.anonIndex += 1
          } else {
            const indexToken = symExp.children[1]
            if (indexToken instanceof Token) {
              const name = indexToken.getString()
              offset = name.length
              if (name[0] == "-") {
                offset = -(offset - 1)
              }
            }
          }
          return `__a${this.anonIndex + offset}`
        }
        break
      }
    }

    return ""
  }

  public pushScope(scopeName: string) {
    if (this.scopePath) {
      this.scopeStack.push(this.scopePath)
      this.scopePath = this.scopePath + "::" + scopeName
    } else {
      this.scopePath = scopeName
    }
  }

  public popScope() {
    this.scopePath = this.scopeStack.pop()
  }

  public pushZone(zoneName?: string) {
    if (this.zoneName) {
      this.zoneStack.push(this.zoneName)
    }
    this.setZone(zoneName)
  }

  public setZone(zoneName?: string) {
    if (!zoneName) {
      zoneName = "__z" + this.zoneIndex.toString()
      this.zoneIndex += 1
    }
    this.zoneName = zoneName
  }

  public popZone() {
    this.zoneName = this.zoneStack.pop()
  }
}

//------------------------------------------------------------------------------
