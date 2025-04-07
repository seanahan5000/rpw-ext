
import { SourceFile } from "./project"
import { Node, NodeRange, Token } from "./tokenizer"
import { Op, Syntax } from "./syntaxes/syntax_types"
import { Symbol, SymbolType, SymbolFrom, isLocalType } from "./symbols"

//------------------------------------------------------------------------------

export class Expression extends Node {

  public children: Node[] = []
  public name?: string

  constructor(children?: Node[]) {
    super()
    if (children) {
      this.children = children
    }
  }

  // get full range of child tokens and expressions
  getRange(): NodeRange | undefined {
    let start = 9999
    let end = -1
    let sourceLine = ""
    for (let i = 0; i < this.children.length; i += 1) {
      const child = this.children[i]
      if (child instanceof Expression) {
        const range = child.getRange()
        if (range) {
          if (start > range.start) {
            start = range.start
          }
          if (end < range.end) {
            end = range.end
          }
          if (range.sourceLine) {
            sourceLine = range.sourceLine
          }
        }
      } else if (child instanceof Token) {
        sourceLine = child.sourceLine
        if (start > child.start) {
          start = child.start
        }
        if (end < child.end) {
          end = child.end
        }
      }
    }
    return start < end ? { sourceLine, start, end } : undefined
  }

  // return flat string of all tokens in expression, possibly including whitespace
  getString(): string {
    const range = this.getRange()
    return range ? range.sourceLine.substring(range.start, range.end) : ""
  }

  // TODO: mechanism to exit early?
  forEachExpression(proc: (expression: Expression) => void) {
    for (let i = 0; i < this.children.length; i += 1) {
      const child = this.children[i]
      if (child instanceof Expression) {
        proc(child)
        child.forEachExpression(proc)
      }
    }
  }

  public forEachExpressionBack(proc: (expression: Expression) => void) {
    for (let i = this.children.length; --i >= 0; ) {
      const child = this.children[i]
      if (child instanceof Expression) {
        child.forEachExpressionBack(proc)
        proc(child)
      }
    }
  }

  // return token containing character position and its parent expression
  findExpressionAt(ch: number): { expression: Expression, token: Token } | undefined {
    for (let i = 0; i < this.children.length; i += 1) {
      const child = this.children[i]
      if (child instanceof Expression) {
        const res = child.findExpressionAt(ch)
        if (res) {
          return res
        }
      } else if (child instanceof Token) {
        if (ch < child.start) {
          return
        }
        // NOTE: if ch is at end, include it in this token rather than next
        //  (necessary because a selected word reports its position as at the end)
        if (ch <= child.end) {
          return { expression: this, token: child }
        }
      }
    }
  }

  // return true if this expression or any of its children have an error
  // TODO: return Node | undefined instead?
  hasAnyError(includingWeak = true): boolean {
    if (this.hasError(includingWeak)) {
      return true
    }
    for (let i = 0; i < this.children.length; i += 1) {
      const child = this.children[i]
      if (child instanceof Expression) {
        if (child.hasAnyError(includingWeak)) {
          return true
        }
      } else {
        if (child.hasError(includingWeak)) {
          return true
        }
      }
    }
    return false
  }

  // TODO: make these abstract?
  // TODO: or also resolve to number array?
  resolve(): number | undefined {
    return
  }

  getSize(): number | undefined {
    return
  }
}

//------------------------------------------------------------------------------

export class BadExpression extends Expression {
  constructor(children?: Node[]) {
    super(children)

    // TODO: is this necessary to avoid hiding actual error?
    // if (!this.hasAnyError(false)) {
      this.setError("Bad expression")
    // }
  }
}

//------------------------------------------------------------------------------

export class NumberExpression extends Expression {
  private value?: number
  private force16: boolean

  constructor(children: Node[], value: number, force16: boolean) {
    super(children)
    if (Number.isNaN(value)) {
      this.value = undefined
    } else {
      this.value = value
    }
    this.force16 = force16
  }

  resolve(): number | undefined {
    return this.value
  }

  getSize(): number | undefined {
    if (this.value !== undefined) {
      return this.force16 || this.value > 255 || this.value < -128 ? 2 : 1
    }
  }

  // only called when contained by variable symbols
  public setNumber(value: number) {
    this.value = value
  }
}

//------------------------------------------------------------------------------

// '[' <expression> [, <expression> ...] ']'
// *** build array of expressions ***
export class ArrayExpression extends Expression {
  // ***
}

//------------------------------------------------------------------------------

export class ParenExpression extends Expression {

  private arg: Expression | undefined

  // [left paren, expression, right paren]
  constructor(children: Node[]) {
    super(children)

    if (children[1] instanceof Expression) {
      this.arg = children[1]
    }
  }

  resolve(): number | undefined {
    return this.arg?.resolve()
  }

  getSize(): number | undefined {
    return this.arg?.getSize()
  }
}

//------------------------------------------------------------------------------

export class StringExpression extends Expression {

  private syntax: Syntax

  // Node[] contains all segments of the string,
  //  including quotes and escape codes.
  constructor(children: Node[], syntax: Syntax) {
    super(children)
    this.syntax = syntax
  }

  // only resolve if string is a single character (string literal)
  resolve(): number | undefined {
    if (!this.children || this.children.length != 3) {
      return
    }
    let str = this.children[0].getString()

    // CA65 only allows single character string with single quote
    if (this.syntax == Syntax.CA65) {
      if (str != "'") {
        return
      }
    }

    // TODO: DASM forbids(!) closing single quote on character

    let highFlip = 0x00
    if (this.syntax == Syntax.MERLIN) {
      if (str == '"') {
        highFlip = 0x80
      }
    }

    str = this.children[1].getString()
    if (str.length == 1) {
      return str.charCodeAt(0) ^ highFlip
    }
  }

  getSize(): number | undefined {
    if (this.resolve() !== undefined) {
      return 1
    }
  }

  // return a single string containing all segments, without quotes
  // *** getStringContents
}

//------------------------------------------------------------------------------

export class SymbolExpression extends Expression {

  public symbolType: SymbolType
  public isDefinition: boolean
  public sourceFile?: SourceFile
  public lineNumber: number
  public symbol?: Symbol
  private value?: number
  private _isImport?: boolean
  private _isExport?: boolean

  // NOTE: not needed after assembly pass2 is complete
  public fullName?: string

  // no error when not found (used in !ifdef, for example)
  public isWeak: boolean = false

  constructor(
      children: Node[],
      symbolType: SymbolType,
      isDefinition: boolean,
      sourceFile?: SourceFile,
      lineNumber?: number) {
    super(children)
    this.symbolType = symbolType
    this.isDefinition = isDefinition
    this.sourceFile = sourceFile
    this.lineNumber = lineNumber ?? 0
    if (isDefinition) {
      this.symbol = new Symbol(this, SymbolFrom.Unknown)
      if (this.symbolType == SymbolType.Variable) {
        this.symbol.isMutable = true
      }
    }
  }

  get symbolFrom(): SymbolFrom {
    return this.symbol?.from ?? SymbolFrom.Unknown
  }

  setIsDefinition(from: SymbolFrom) {
    if (!this.isDefinition) {
      this.isDefinition = true
      this.symbol = new Symbol(this, from)
    }
  }

  // turn this expression into a reference to a different symbol
  setIsReference(symbol: Symbol) {
    this.symbol = symbol
    this.isDefinition = false
    symbol.addReference(this)
  }

  // TODO: add sizing information?
  setIsImport() {
    // TODO: assume already isDefinition? (weak?)
    this._isImport = true
  }

  isImport(): boolean {
    return this._isImport ?? false
  }

  // TODO: pass in ref/def flag?
  // TODO: pass in sizing information?
  setIsExport() {
    // TODO: assume already isDefinition?
    this._isExport = true
  }

  isExport(): boolean {
    return this._isExport ?? false
  }

  setSymbolType(symbolType: SymbolType) {
    this.symbolType = symbolType
  }

  isVariableType(): boolean {
    return this.symbolType == SymbolType.Variable
  }

  isLocalType(): boolean {
    return isLocalType(this.symbolType)
  }

  resolve(): number | undefined {
    if (this.value !== undefined) {
      return this.value
    }
    return this.symbol?.resolve()
  }

  public setPCValue(pc: number) {
    const pcExpression = this.symbol?.getValue()
    if (pcExpression instanceof PcExpression) {
      pcExpression.setValue(pc)
    }
  }

  public captureValue() {
    if (this.value === undefined) {
      if (this.isVariableType() || this.symbol?.isMutable) {
        this.value = this.symbol?.resolve()
      }
    }
  }

  getSize(): number | undefined {
    return this.symbol?.getSize()
  }

  // Return the name of the symbol, without any
  //  prefixes, trailing ":", or scoping.
  public getSimpleName(): { asToken?: Token, asString: string } {
    for (let i = this.children.length; --i >= 0; ) {
      const token = this.children[i]
      if (token instanceof Token) {
        const str = token.getString()
        // exclude trailing colon and closing brace
        //  of DASM named param
        if (str != ":" && str != "::" && str != "}") {
          return { asToken: token, asString: str }
        }
      }
    }
    return { asString: "" }
  }
}

//------------------------------------------------------------------------------

export class UnaryExpression extends Expression {
  public opType: Op
  private arg: Expression

  constructor(opToken: Token, opType: Op, arg: Expression) {
    super([opToken, arg])
    this.opType = opType
    this.arg = arg
  }

  resolve(): number | undefined {
    let value = this.arg.resolve()
    if (value !== undefined) {
      switch (this.opType) {
        case Op.Neg:
          value = -value
          break
        case Op.Pos:
          // TODO: check that this is correct (maybe absolute value?)
          value = value
          break
        case Op.LogNot:
          value = value ? 0 : 1
          break
        case Op.BitNot:
          value = ~value
          break
        case Op.LowByte:
          value = value & 255
          break
        case Op.HighByte:
          value = (value >> 8) & 255
          break
        case Op.BankByte:
          value = (value >> 16) & 255
          break
      }
    }
    return value
  }

  getSize(): number | undefined {
    switch (this.opType) {
      case Op.Neg:
      case Op.Pos:
      case Op.LogNot:
      case Op.BitNot:
        break
      case Op.LowByte:
      case Op.HighByte:
      case Op.BankByte:
        return 1
    }
    // TODO: use resolved value to determine size (does -value change size?)
    return this.arg.getSize()
  }
}

//------------------------------------------------------------------------------

export class BinaryExpression extends Expression {
  private arg1: Expression
  private opType: Op
  private arg2: Expression

  constructor(arg1: Expression, opToken: Token, opType: Op, arg2: Expression) {
    super([arg1, opToken, arg2])
    this.arg1 = arg1
    this.opType = opType
    this.arg2 = arg2
  }

  resolve(): number | undefined {
    let value: number | undefined
    let value1 = this.arg1.resolve()
    let value2 = this.arg2.resolve()
    if (value1 !== undefined && value2 !== undefined) {
      switch (this.opType) {
        case Op.Pow:
          value = Math.pow(value1, value2)
          break
        case Op.Mul:
          value = value1 * value2
          break
        case Op.FDiv:
          value = value1 / value2
          break
        case Op.IDiv:
          value = Math.floor(value1 / value2)
          break
        case Op.Mod:
          value = value1 % value2
          break
        case Op.Add:
          value = value1 + value2
          break
        case Op.Sub:
          value = value1 - value2
          break
        case Op.ASL:
          value = value1 << value2
          break
        case Op.ASR:
          value = value1 >> value2
          break
        case Op.LSR:
          // TODO: is this the right limit?
          value = (value1 & 0xFFFF) >> value2
          break
        case Op.LT:
          value = value1 < value2 ? 1 : 0
          break
        case Op.LE:
          value = value1 <= value2 ? 1 : 0
          break
        case Op.GT:
          value = value1 > value2 ? 1 : 0
          break
        case Op.GE:
          value = value1 >= value2 ? 1 : 0
          break
        case Op.NE:
          value = value1 != value2 ? 1 : 0
          break
        case Op.EQ:
          value = value1 == value2 ? 1 : 0
          break
        case Op.BitAnd:
          value = value1 & value2
          break
        case Op.BitXor:
          value = value1 ^ value2
          break
        case Op.BitOr:
          value = value1 | value2
          break
        case Op.LogAnd:
          value = value1 && value2 ? 1 : 0
          break
        case Op.LogXor:
          value = (value1 && value2) || (!value1 && !value2) ? 1 : 0
          break
        case Op.LogOr:
          value = value1 || value2 ? 1 : 0
          break
      }
    }
    return value
  }

  getSize(): number | undefined {
    // TODO: use resolved value to determine size? (value1 * value2, for example)
    // *** comparisons and logical ops always drop to 1 byte ***
    let size: number | undefined
    let size1 = this.arg1.getSize()
    if (size1 !== undefined) {
      size = size1
      let size2 = this.arg2.getSize()
      if (size2 !== undefined) {
        if (size2 > size1) {
          size = size2
        }
      }
    }
    return size
  }
}

//------------------------------------------------------------------------------

export class PcExpression extends Expression {

  private pc?: number

  constructor(token?: Token) {
    super(token ? [token] : undefined)
  }

  setValue(pc: number) {
    this.pc = pc
  }

  resolve(): number | undefined {
    return this.pc
  }

  getSize(): number | undefined {
    if (this.pc !== undefined) {
      return this.pc < 0x100 ? 1 : 2
    }
    // *** else return 2???
  }
}

//------------------------------------------------------------------------------

export class FileNameExpression extends Expression {
  constructor(token: Token) {
    super([token])
  }
}

//------------------------------------------------------------------------------

// NOTE: specific to ORCA/M

export class CondefExpression extends Expression {
  constructor(children?: Node[]) {
    super(children)
  }
}

//------------------------------------------------------------------------------
