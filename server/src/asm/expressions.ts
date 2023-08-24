
import { Token } from "./parser"

//------------------------------------------------------------------------------

//*** consider making every expression hold a value and size
//*** consider an unresolve if there's a need to recompute results

// *** maybe not abstract ***
// *** list of tokens? ***
export abstract class Expression {
  public abstract resolve(): number | undefined
  public abstract getSize(): number | undefined
}

// *** class MissingExpression?

//------------------------------------------------------------------------------

export class NumberExpression implements Expression {
  private value: number
  private force16: boolean

  constructor(value: number, force16: boolean) {
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

export class UnaryExpression implements Expression {
  private op: string
  private arg: Expression

  constructor(op: string, arg: Expression) {
    this.op = op
    this.arg = arg
  }

  resolve(): number | undefined {
    let value = this.arg.resolve()
    if (value !== undefined) {
      if (this.op == ">" || this.op == "/") {   //*** "/" LISA-only
        value = (value >> 8) & 255
      } else if (this.op == "<") {
        value = value & 255
      } else if (this.op == "-") {
        value = -value
      }
    }
    return value
  }

  getSize(): number | undefined {
    if (this.op == ">" || this.op == "<" || this.op == "/") {
      return 1
    }
    // TODO: use resolved value to determine size (does -value change size?)
    return this.arg.getSize()
  }
}

//------------------------------------------------------------------------------

export class BinaryExpression implements Expression {
  private arg1: Expression
  private op: string
  private arg2: Expression

  constructor(arg1: Expression, op: string, arg2: Expression) {
    this.arg1 = arg1
    this.op = op
    this.arg2 = arg2
  }

  resolve(): number | undefined {
    let value: number | undefined
    let value1 = this.arg1.resolve()
    let value2 = this.arg1.resolve()
    if (value1 !== undefined && value2 !== undefined) {
      // TODO: handle these differently based on syntax
      if (this.op == "+") {
        value = value1 + value2
      } else if (this.op == "-") {
        value = value1 - value2
      } else if (this.op == "*") {
        value = value1 * value2
      } else if (this.op == "/") {
        value = Math.floor(value1 / value2)
      } else if (this.op == "!") {
        value = value1 ^ value2
      } else if (this.op == ".") {
        value = value1 | value2
      } else if (this.op == "&") {
        value = value1 & value2
      } else if (this.op == "=") {
        value = value1 == value2 ? 1 : 0
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

export class SymbolExpression implements Expression {

  private fullName: string    //*** is this useful for anything?
  private token: Token

  constructor(fullName: string, token: Token) {
    this.fullName = fullName
    this.token = token
  }

  resolve(): number | undefined {
    if (this.token.symbol) {
      return this.token.symbol.resolve()
    }
  }

  getSize(): number | undefined {
    if (this.token.symbol) {
      return this.token.symbol.getSize()
    }
  }
}

//------------------------------------------------------------------------------

export class PcExpression implements Expression {

  private value: number | undefined

  // TODO: pass in PC address source?
  constructor() {
  }

  resolve(): number | undefined {
    if (this.value === undefined) {
      // TODO: check for and capture actual PC
    }
    return this.value
  }

  getSize() {
    // TODO: in theory, this could be 1 if code is running in ZPAGE
    return 2
  }
}

//------------------------------------------------------------------------------

export class VarExpression implements Expression {

  private varName: string

  constructor(varName: string) {
    this.varName = varName
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

export class ParenExpression implements Expression {

  private arg: Expression

  constructor(arg: Expression) {
    this.arg = arg
  }

  resolve(): number | undefined {
    return this.arg.resolve()
  }

  getSize() {
    return this.arg.getSize()
  }
}

//------------------------------------------------------------------------------

export class AlignExpression implements Expression {

  private value: number | undefined
  private alignment: Expression
  private pc: PcExpression

  constructor(alignment: Expression) {
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
