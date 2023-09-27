
import { Token } from "./tokenizer"

//------------------------------------------------------------------------------

export class Expression {

  //*** parent: Expression?
  public children: (Token | Expression)[] = []

  constructor(children?: (Token | Expression)[]) {
    if (children) {
      this.children = children
    }
  }

  // return flat list of tokens for this expression and sub-expressions
  getTokens(): Token[] {
    const result: Token[] = []
    // *** don't use forEach ***
    this.children?.forEach((child: Token | Expression) => {
      if (child instanceof Expression) {
        if (child.children) {
          result.push(...child.getTokens())
        }
      } else {
        result.push(child)
      }
    })
    return result
  }

  // return token containing character position
  getTokenAt(ch: number): Token | undefined {
    if (this.children) {
      for (let i = 0; i < this.children.length; i += 1) {
        const child = this.children[i]
        if (child instanceof Expression) {
          const token = child.getTokenAt(ch)
          if (token) {
            return token
          }
        } else {
          if (ch < child.start) {
            return
          }
          if (ch < child.end) {
            return child
          }
        }
      }
    }
  }

  // TODO: should this return a token?
  // TODO: somebody should call this
  hasError(): boolean {
    if (this.children) {
      for (let i = 0; i < this.children.length; i += 1) {
        // NOTE: both Expression and Token have hasError method
        if (this.children[i].hasError()) {
          return true
        }
      }
    }
    return false
  }

  // return flat string of all tokens in expression, possibly including whitespace
  getString(): string {
    const tokens = this.getTokens()
    if (tokens.length == 0) {
      return ""
    }
    const start = tokens[0].start
    const end = tokens[tokens.length - 1].end
    return tokens[0].sourceLine.substring(start, end)
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

//*** maybe just push token directly instead?
export class ErrorExpression extends Expression {
  // ***
}

//------------------------------------------------------------------------------

export class NumberExpression extends Expression {
  private value: number
  private force16: boolean

  constructor(tokens: Token[], value: number, force16: boolean) {
    super(tokens)
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

export class StringExpression extends Expression {

  // Tokens contains all segments of the string,
  //  including quotes and escape codes.
  constructor(tokens: Token[]) {
    super(tokens)
  }

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

// *** assignment versus reference instead?

export class LabelExpression extends Expression {
  // *** put symbol here instead of in token

  // resolve
  // getSize
}

export class SymbolExpression extends Expression {
  // *** put symbol here instead of in token

  // resolve
  // getSize
}

//------------------------------------------------------------------------------

export class UnaryExpression extends Expression {
  private op: string
  private arg: Expression

  constructor(opToken: Token, arg: Expression) {
    super([opToken, arg])

    // for convenience
    this.op = opToken.getString()
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

// TODO: need operator precedence for some syntaxes

export class BinaryExpression extends Expression {
  private arg1: Expression
  private op: string
  private arg2: Expression

  constructor(arg1: Expression, opToken: Token, arg2: Expression) {
    super([arg1, opToken, arg2])

    // TODO: needed convenience?
    this.arg1 = arg1
    this.op = opToken.getString()
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
      } else if (this.op == ".") {    // *** only merlin (already filtered?) ***
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

export class PcExpression extends Expression {

  private value: number | undefined

  // TODO: pass in PC address source?
  constructor(/*token: Token*/) {
    super([/*token*/])
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

  // first token is bracket, second is name
  constructor(children: (Token | Expression)[]) {
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
