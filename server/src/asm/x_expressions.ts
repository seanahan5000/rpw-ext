
import { SourceFile } from "./assembler"
import { Token } from "./tokenizer"
import { Op } from "./syntax"
import { Symbol, SymbolType, isLocalType } from "./symbols"

export type TokenExpressionSet = (Token | Expression)[]

//------------------------------------------------------------------------------

export class Expression {

  public children: TokenExpressionSet = []

  constructor(children?: TokenExpressionSet) {
    if (children) {
      this.children = children
    }
  }

  // *** overkill to set same error on every token ***
  setError(message: string) {
    for (let i = 0; i < this.children.length; i += 1) {
      this.children[i].setError(message)
    }
  }

  // get full range of child tokens and expressions
  // *** could add this to Tokens too ***
  getRange(): { sourceLine: string, start: number, end: number } | undefined {
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
        }
      } else {
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

  // pushTokenExp(item: Token | Expression) {
  //   this.children.push(item)
  // }

  // return flat list of tokens for this expression and sub-expressions
  // *** stop using this! ***
  getTokens(): Token[] {
    const result: Token[] = []
    for (let i = 0; i < this.children.length; i += 1) {
      const child = this.children[i]
      if (child instanceof Expression) {
        if (child.children) {
          result.push(...child.getTokens())
        }
      } else {
        result.push(child)
      }
    }
    return result
  }

  // TODO: mechanism to exit early?
  forEachExpression(proc: (expression: Expression) => void) {
    for (let i = 0; i < this.children.length; i += 1) {
      const child = this.children[i]
      if (child instanceof Expression) {
        proc(child)
      }
    }
  }

  // return token containing character position and its parent expression
  getExpressionAt(ch: number): { expression: Expression, token: Token } | undefined {
    for (let i = 0; i < this.children.length; i += 1) {
      const child = this.children[i]
      if (child instanceof Expression) {
        const res = child.getExpressionAt(ch)
        if (res) {
          return res
        }
      } else {
        if (ch < child.start) {
          return
        }
        if (ch < child.end) {
          return { expression: this, token: child }
        }
      }
    }
  }

  // TODO: should this return a token/expression?
  // TODO: somebody should call this
  hasError(): boolean {
    for (let i = 0; i < this.children.length; i += 1) {
      // NOTE: both Expression and Token have hasError method
      if (this.children[i].hasError()) {
        return true
      }
    }
    return false
  }

  // return flat string of all tokens in expression, possibly including whitespace
  // *** return undefined instead? ***
  getString(): string {
    const range = this.getRange()
    return range ? range.sourceLine.substring(range.start, range.end) : ""
  }

  // *** type?
  // canResolve (?)

  // *** make these abstract? ***

  resolve(): number | undefined {
    return
  }

  getSize(): number | undefined {
    return
  }
}

//------------------------------------------------------------------------------

export class BadExpression extends Expression {
  // ***
}

//------------------------------------------------------------------------------

export class NumberExpression extends Expression {
  private value: number
  private force16: boolean

  constructor(children: TokenExpressionSet, value: number, force16: boolean) {
    super(children)
    this.value = value
    this.force16 = force16
  }

  resolve(): number | undefined {
    return this.value
  }

  getSize(): number | undefined {
    return this.force16 || this.value > 255 || this.value < -128 ? 2 : 1
  }
}

//------------------------------------------------------------------------------

export class ParenExpression extends Expression {

  private arg: Expression | undefined

  // [left paren, expression, right paren]
  constructor(children: TokenExpressionSet) {
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

  // TokenExpressionSet contains all segments of the string,
  //  including quotes and escape codes.
  // constructor(children: TokenExpressionSet) {
  //   super(children)
  // }

  // only resolve if string is a single character (string literal)
  resolve(): number | undefined {
    if (!this.children || this.children.length != 3) {
      return
    }
    let str = this.children[0].getString()
    const highFlip = str == '"' ? 0x80 : 0x00
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
  public fullName?: string
  public symbol?: Symbol
  public isZoneStart = false

  constructor(
      children: TokenExpressionSet,
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
      this.symbol = new Symbol(symbolType, this)
    }
  }

  isLocalType(): boolean {
    return isLocalType(this.symbolType)
  }

  resolve(): number | undefined {
    return this.symbol?.resolve()
  }

  getSize(): number | undefined {
    return this.symbol?.getSize()
  }
}

//------------------------------------------------------------------------------

export class UnaryExpression extends Expression {
  private opType: Op
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
          value = value ? 1 : 0
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
    // TODO: use resolved value to determine size? (value * value, for example)
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

  private value: number | undefined

  // TODO: pass in PC address source?
  constructor(token?: Token) {
    super(token ? [token] : undefined)
  }

  resolve(): number | undefined {
    if (this.value === undefined) {
      // TODO: check for and capture actual PC
    }
    return this.value
  }

  getSize() {
    return 2
  }
}

//------------------------------------------------------------------------------

export class VarExpression extends Expression {

  // first token in set is bracket, second is name
  constructor(children: TokenExpressionSet) {
    super(children)
  }

  resolve(): number | undefined {
    // TODO: what should this method do?
    return
  }

  getSize(): number | undefined {
    // TODO: what should this method do?
    return
  }
}

//------------------------------------------------------------------------------

export class AlignExpression extends Expression {

  private value: number | undefined
  private alignment: Expression
  private pc: PcExpression

  // TODO: expression might be different based on syntax
  constructor(alignment: Expression) {
    super([alignment])
    this.alignment = alignment
    this.pc = new PcExpression()
  }

  resolve(): number | undefined {
    if (this.value === undefined) {
      let pc = this.pc.resolve()
      if (pc !== undefined) {
        let align = this.alignment.resolve()
        if (align !== undefined) {
          this.value = pc % align
        }
      }
    }
    return this.value
  }

  getSize(): number | undefined {
    return this.resolve()
  }
}

//------------------------------------------------------------------------------
