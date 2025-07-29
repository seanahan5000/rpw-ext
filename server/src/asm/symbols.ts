
import { Token } from "./tokenizer"
import { Expression, SymbolExpression} from "./expressions"

//------------------------------------------------------------------------------

export enum SymbolType {
  Variable    = 0,
  MacroName   = 1,
  TypeName    = 2,  // struct, enum, define, etc.
  NamedParam  = 3,  // named params to macros, structs, enums

  Simple      = 4,
  Scoped      = 5,  // explicit scope, fully specified

  CheapLocal  = 6,  // scoped to previous non-local
  ZoneLocal   = 7,  // scoped to SUBROUTINE or !zone
  AnonLocal   = 8,  // ++ or --
  LisaLocal   = 9,  // ^# def, <# or ># ref
  CA65Local   = 10  // : def, :+ or :- ref
}

export function isLocalType(symbolType: SymbolType): boolean {
  return symbolType >= SymbolType.CheapLocal
}

export enum SymbolFrom {
  Unknown    = 0,
  Org        = 1,   // implicit from current org
  Equate     = 2,   // assigned with "="
  Import     = 3,   // .import statement
  Define     = 4,   // defined from project
}

//------------------------------------------------------------------------------

// TODO: isolate info shared by SymbolExpression and Symbol (SymbolTemplate?)

export class Symbol {
  public from: SymbolFrom

  // NOTE: all booleans are undefined by default, so effectively false

  // NOTE: could pack these into bits
  public isZPage?: boolean      // *** set this using import/export sizing info
  public isConstant?: boolean   // 8-bit only? automatic in DUMMY 0?
  public isSubroutine?: boolean
  public isData?: boolean
  public isCode?: boolean

  // set by SUBROUTINE and .zone commands
  public isZoneStart?: boolean

  // set for Variables and for locals that have had their values set
  // NOTE: This is a way of splitting the overloaded term "variable"
  //  into its scoping rules and its modifiability.
  //  For example, in DASM, it is possible to set the value of a local label,
  //  giving it the scoping of zone local but the modifiability of a variable.
  public isMutable?: boolean

  public definition: SymbolExpression
  public references: SymbolExpression[] = []
  private value?: Expression

  // Name is assigned later, after scope information is processed
  //  and symbol has been added to map.
  public fullName?: string

  // valid if symbol is a structure definition
  public typeDef?: TypeDef

  // valid if this symbol references a location whose type/layout is this typeDef
  public typeRef?: TypeDef

  constructor(definition: SymbolExpression, from: SymbolFrom) {
    this.definition = definition
    this.from = from
  }

  // TODO: make this a call instead of a getter?
  get type(): SymbolType {
    return this.definition.symbolType
  }

  public isImport(): boolean {
    return this.definition.isImport()
  }

  public isExport(): boolean {
    return this.definition.isExport()
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
}

//------------------------------------------------------------------------------

export class ScopeState {

  private caseSensitive: boolean

  private scopeSeparator = "::"
  private scopePathStack: string[] = []

  private zoneName?: string
  private zoneStack: string[] = []
  private zoneIndex = 0

  private cheapScope = "__d"

  private anonCounts = new Array(20).fill(0)
  private anonIndex = 0     // CA65-only

  constructor(caseSensitive: boolean, scopeSeparator: string) {
    this.caseSensitive = caseSensitive
    if (scopeSeparator) {
      this.scopeSeparator = scopeSeparator
    }
  }

  // Return the number of scope levels for a given symbol expression.
  //  Return 1 for types that don't use the scope path.
  public getScopeDepth(symExp: SymbolExpression): number {
    switch (symExp.symbolType) {
      case SymbolType.Variable:
      case SymbolType.ZoneLocal:
      case SymbolType.AnonLocal:
      case SymbolType.LisaLocal:
      case SymbolType.CA65Local:
        return 1

      case SymbolType.MacroName:
      case SymbolType.TypeName:
      case SymbolType.NamedParam:
      case SymbolType.Simple:
      case SymbolType.Scoped:
      case SymbolType.CheapLocal:
        return this.scopePathStack.length + 1
    }
  }

  private addScopePath(nameStr: string, scopeIndex?: number): string {
    if (scopeIndex === undefined) {
      scopeIndex = this.scopePathStack.length
    }
    if (this.scopePathStack.length > 0 && scopeIndex > 0) {
      const subPath = this.scopePathStack[scopeIndex - 1]
      if (subPath) {
        return subPath + this.scopeSeparator + nameStr
      }
    }
    return nameStr
  }

  // *** this should just set fullName directly, if not already present ***
  // NOTE: if scope path usage changes here, getScopeDepth must also be updated
  public setSymbolExpression(symExp: SymbolExpression, scopeIndex?: number): string {

    let result = ""
    switch (symExp.symbolType) {

      case SymbolType.Variable: {
        // TODO: just getSimpleName instead?
        // NOTE: if this changes, also change processSymbols in preprocessor.ts
        result = symExp.getString()
        break
      }

      case SymbolType.MacroName:
      case SymbolType.TypeName: {
        // skip invoke prefix token if present
        const nameToken = symExp.children[symExp.children.length - 1]
        result = nameToken?.getString() ?? ""

        if (symExp.symbolType == SymbolType.MacroName) {
          // TODO: Choose case insensitive macro names by syntax,
          //  separate from symbol sensitivity.
          //  (DASM, for example, is case insensitive for macros, but
          //  case sensitive for symbols)
          // TODO: may need to create/split SymbolType.MacroName
          result = result.toLowerCase()
        }

        result = this.addScopePath(result, scopeIndex)
        break
      }

      case SymbolType.NamedParam: {
        const nameToken = symExp.children[symExp.children.length > 1 ? 1 : 0]
        if (!nameToken || !(nameToken instanceof Token)) {
          break
        }
        result = nameToken.getString()
        result = this.addScopePath(result, scopeIndex)
        break
      }

      case SymbolType.Simple: {
        const nameToken = symExp.children[0]
        if (nameToken && !(nameToken instanceof Token)) {
          break
        }
        if (!nameToken && !symExp.symbol?.isZoneStart) {
          break
        }

        if (nameToken) {
          result = nameToken.getString()
        } else {
          result = "__z" + this.zoneIndex.toString()
          this.zoneIndex += 1
        }
        result = this.addScopePath(result, scopeIndex)

        const symFrom = symExp.symbol?.from ?? SymbolFrom.Unknown
        if (symExp.isDefinition && symExp.symbol) {
          // Only implicit symbols should change local scope,
          //  not assignments or imports.
          if (symFrom == SymbolFrom.Org) {
            this.cheapScope = result
            if (symExp.symbol.isZoneStart) {
              this.zoneName = result
            }
          }
        }

        break
      }

      // NOTE: This currently only supports explicit scoping.
      case SymbolType.Scoped: {
        result = ""
        if (!symExp.isDefinition) {

          let relativeScope = true
          for (let i = 0; i < symExp.children.length; i += 1) {
            const child = symExp.children[i]
            if (child instanceof Token) {
              const str = child.getString()
              if (str == this.scopeSeparator) {
                if (result == "") {
                  relativeScope = false
                } else {
                  result = result + this.scopeSeparator
                }
              } else {
                result = result + str
              }
            }
          }

          if (relativeScope) {
            result = this.addScopePath(result, scopeIndex)
          }
        }
        break
      }

      // TODO: should this be adding scope path?
      case SymbolType.CheapLocal: {
        const nameToken = symExp.children[1]
        if (nameToken instanceof Token) {
          result = this.cheapScope + this.scopeSeparator + nameToken.getString()
          result = this.addScopePath(result, scopeIndex)
        }
        break
      }

      case SymbolType.ZoneLocal: {
        // NOTE: there may only be one token for define locals
        // NOTE: don't just take the last token because that could be a trailing ":"
        const nameToken = symExp.children[Math.min(1, symExp.children.length - 1)]
        if (nameToken instanceof Token) {
          // TODO: this.zoneName could be undefined if no label seen yet
          result = (this.zoneName + this.scopeSeparator + nameToken.getString())
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
          result = `__a${index}_${outIndex}`
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
            result = `__a${index}_${outIndex}`
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
          result = `__a${this.anonIndex + offset}`
        }
        break
      }
    }

    if (!this.caseSensitive) {
      result = result.toLowerCase()
    }
    return result
  }

  public pushScope(scopeName: string) {
    if (this.scopePathStack.length) {
      const parentScope = this.scopePathStack.pop()
      this.scopePathStack.push(parentScope!)
      this.scopePathStack.push(parentScope + this.scopeSeparator + scopeName)
    } else {
      this.scopePathStack.push(scopeName)
    }
  }

  public popScope() {
    this.scopePathStack.pop()
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

export type FieldEntry = {
  name: string,
  offset: number,
  size: number,
  typeName?: string
}

export class TypeDef {

  public endLineIndex: number
  public size?: number
  public fields?: FieldEntry[]

  constructor(
      public fileIndex: number,
      public startLineIndex: number,
      public params: string[]) {
    this.endLineIndex = startLineIndex
  }

  public endDefinition(endLineIndex: number, size: number) {
    this.endLineIndex = endLineIndex
    this.size = size
  }

  public addField(name: string, offset: number, size: number, typeName?: string) {
    if (!this.fields) {
      this.fields = []
    }
    this.fields.push({ name, offset, size, typeName })
  }
}

//------------------------------------------------------------------------------
