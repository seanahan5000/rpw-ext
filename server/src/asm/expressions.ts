
import { SourceFile } from "./project"
import { Node, NodeRange, Token } from "./tokenizer"
import { Op } from "./syntax"
import { Symbol, SymbolType, isLocalType } from "./symbols"

//------------------------------------------------------------------------------

export class Expression extends Node {

  public children: Node[] = []

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
  hasAnyError(): boolean {
    if (this.hasError()) {
      return true
    }
    for (let i = 0; i < this.children.length; i += 1) {
      const child = this.children[i]
      if (child instanceof Expression) {
        return child.hasAnyError()
      } else {
        return child.hasError()
      }
    }
    return false
  }

  // TODO: make these abstract?

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

  constructor(children: Node[], value: number, force16: boolean) {
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

  // Node[] contains all segments of the string,
  //  including quotes and escape codes.
  // constructor(children: Node[]) {
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

  // true if symbol was used in an !ifdef, etc. conditional check
  public suppressUnknown = false

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
    if (isDefinition && symbolType) {
      this.symbol = new Symbol(symbolType, this)
    }
  }

  isVariableType(): boolean {
    return this.symbolType == SymbolType.Variable
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

export class FileNameExpression extends Expression {
  constructor(token: Token) {
    super([token])
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
